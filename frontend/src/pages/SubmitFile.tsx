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
      <nav className="breadcrumb" aria-label="当前位置">
        <Link to="/problems">题库</Link>
        <span className="breadcrumb-sep">/</span>
        {problem ? (
          <Link to={`/problem/${problem.id}`}>{problem.id}. {problem.title}</Link>
        ) : (
          <span>题目</span>
        )}
        <span className="breadcrumb-sep">/</span>
        <span>提交文件</span>
      </nav>

      <header className="page-header page-header-standard">
        <div className="page-heading">
          <h1 className="page-title">
            {problem ? `提交文件：${problem.id}. ${problem.title}` : '提交文件'}
          </h1>
        </div>
        <div className="page-actions">
          <Link to={problem ? `/problem/${problem.id}` : '/problems'} className="button button-secondary">
            返回题目
          </Link>
        </div>
      </header>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">选择代码文件</h2>
        </div>
        <div
          className="empty-state"
          data-dragging={dragging || undefined}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
        >
          <span className="empty-state-title">将代码文件拖拽到此处</span>
          <span className="empty-state-hint">支持 .c / .cpp / .cc / .cxx / .py，最大 64KB</span>
          <input
            ref={inputRef}
            type="file"
            hidden
            accept=".c,.cpp,.cc,.cxx,.py"
            aria-label="选择代码文件"
            onChange={(e) => {
              const f = e.target.files?.[0]
              if (f) readFile(f)
              e.target.value = ''
            }}
          />
          <button
            type="button"
            className="button button-primary"
            onClick={() => inputRef.current?.click()}
          >
            选择文件
          </button>
        </div>
        {fileName && (
          <div className="info-message">
            已选择 <code>{fileName}</code>（{code.length} 字节）
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">语言</h2>
          <span className="section-hint">根据文件扩展名自动识别，可手动修改</span>
        </div>
        <div className="toolbar toolbar-plain">
          <label className="toolbar-label" htmlFor="submit-language">评测语言</label>
          <select
            id="submit-language"
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
        </div>
      </section>

      {code && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">代码预览</h2>
            <span className="section-hint">{code.length} 字节</span>
          </div>
          <pre className="card admin-code-preview">{code}</pre>
        </section>
      )}

      <div className="toolbar">
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
          <Link to={`/status`}> 查看提交记录</Link>
        </div>
      )}
    </div>
  )
}
