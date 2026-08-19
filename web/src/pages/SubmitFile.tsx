import { useEffect, useRef, useState } from 'react'
import type { DragEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { createSubmission, extractError, getLanguages, getProblem } from '../api'
import { useAuth } from '../context/AuthContext'
import type { Language, ProblemDetail } from '../types'

const MAX_FILE_BYTES = 64 * 1024 // 与后端一致

// 根据文件扩展名推断语言
function detectLanguage(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['cpp', 'cc', 'cxx', 'c++'].includes(ext)) return 'cpp'
  if (ext === 'c') return 'c'
  if (['py', 'py3'].includes(ext)) return 'python'
  return ''
}

export default function SubmitFile() {
  const { id } = useParams()
  const { user } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)

  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [languages, setLanguages] = useState<Language[]>([])
  const [language, setLanguage] = useState('')
  const [fileName, setFileName] = useState('')
  const [code, setCode] = useState('')
  const [dragging, setDragging] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')
  const [submittedId, setSubmittedId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getProblem(id!)
      .then((p) => {
        if (!cancelled) setProblem(p)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
    getLanguages()
      .then((ls) => {
        if (cancelled) return
        setLanguages(ls)
        setLanguage((prev) => prev || ls[0]?.key || '')
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  const readFile = (file: File) => {
    setError('')
    setSubmittedId(null)
    if (file.size > MAX_FILE_BYTES) {
      setFileName('')
      setCode('')
      setError('文件过大（最大 64KB）')
      return
    }
    setFileName(file.name)
    const detected = detectLanguage(file.name)
    if (detected) setLanguage(detected)
    const reader = new FileReader()
    reader.onload = () => setCode(String(reader.result ?? ''))
    reader.onerror = () => setError('读取文件失败')
    reader.readAsText(file)
  }

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) readFile(file)
  }

  const submit = async () => {
    if (!user) {
      setError('请先登录后再提交')
      return
    }
    if (!fileName || !code) {
      setError('请先选择代码文件')
      return
    }
    if (!language) {
      setError('请选择语言')
      return
    }
    setSubmitting(true)
    setError('')
    setSubmittedId(null)
    try {
      const res = await createSubmission(Number(id), language, code)
      setSubmittedId(res.id)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div className="problem-header">
        <h1 className="problem-title">
          {problem ? (
            <>
              <Link to={`/problem/${problem.id}`} className="muted" style={{ marginRight: 8 }}>
                ← 返回
              </Link>
              提交文件：{problem.id}. {problem.title}
            </>
          ) : (
            '提交文件'
          )}
        </h1>
      </div>

      <div className="section">
        <h2 className="section-title">选择代码文件</h2>
        <div
          className={dragging ? 'file-drop-zone dragging' : 'file-drop-zone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".c,.cpp,.cc,.cxx,.py"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f)
              e.target.value = ''
            }}
          />
          <div className="file-drop-text">
            <p>将代码文件拖拽到此处，或</p>
            <button
              type="button"
              className="button button-primary"
              onClick={() => inputRef.current?.click()}
            >
              选择文件
            </button>
            <p className="muted">支持 .c / .cpp / .cc / .cxx / .py，最大 64KB</p>
          </div>
        </div>
        {fileName && (
          <div className="info-message">
            已选择 <span className="mono">{fileName}</span>（{code.length} 字节）
          </div>
        )}
      </div>

      <div className="section">
        <h2 className="section-title">语言</h2>
        <select
          className="select-input"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {languages.length === 0 && <option value="">加载语言中…</option>}
          {languages.map((l) => (
            <option key={l.key} value={l.key}>
              {l.name} ({l.version})
            </option>
          ))}
        </select>
        <p className="muted">根据文件扩展名自动识别，可手动修改</p>
      </div>

      {code && (
        <div className="section">
          <h2 className="section-title">代码预览</h2>
          <pre className="code-block file-preview">{code}</pre>
        </div>
      )}

      <div className="submit-footer">
        <button
          type="button"
          className="button button-primary"
          onClick={submit}
          disabled={submitting || !fileName}
        >
          {submitting ? '提交中…' : '提交代码'}
        </button>
      </div>
      {error && <div className="error-message">{error}</div>}
      {submittedId !== null && (
        <div className="success-message">
          提交成功 <Link to={`/submission/${submittedId}`}>#{submittedId}</Link>，
          <Link to={`/status`}> 查看状态</Link>
        </div>
      )}
    </div>
  )
}
