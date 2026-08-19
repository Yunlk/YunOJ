import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createProblem, extractError, getProblem, updateProblem } from '../api'
import type { Sample } from '../types'

interface FormState {
  title: string
  difficulty: string
  tags: string
  time_limit_ms: string
  memory_limit_kb: string
  statement: string
  input_format: string
  output_format: string
  hint: string
}

const emptySample = (): Sample => ({ input: '', output: '', note: '' })

const DEFAULT_FORM: FormState = {
  title: '',
  difficulty: '1',
  tags: '',
  time_limit_ms: '1000',
  memory_limit_kb: '262144',
  statement: '',
  input_format: '',
  output_format: '',
  hint: '',
}

export default function ProblemForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()

  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [samples, setSamples] = useState<Sample[]>([emptySample()])
  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    setLoading(true)
    getProblem(id!)
      .then((p) => {
        if (cancelled) return
        setForm({
          title: p.title,
          difficulty: String(p.difficulty),
          tags: p.tags.join(', '),
          time_limit_ms: String(p.time_limit_ms),
          memory_limit_kb: String(p.memory_limit_kb),
          statement: p.statement,
          input_format: p.input_format,
          output_format: p.output_format,
          hint: p.hint,
        })
        setSamples(p.samples.length > 0 ? p.samples.map((s) => ({ ...s })) : [emptySample()])
      })
      .catch((err) => setError(extractError(err)))
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [id, isEdit])

  const setField = (field: keyof FormState, value: string) => {
    setForm((f) => ({ ...f, [field]: value }))
  }

  const updateSample = (i: number, field: keyof Sample, value: string) => {
    setSamples((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
  }

  const addSample = () => setSamples((prev) => [...prev, emptySample()])

  const removeSample = (i: number) => setSamples((prev) => prev.filter((_, idx) => idx !== i))

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('请填写标题')
      return
    }
    const difficulty = Number(form.difficulty)
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 10) {
      setError('难度需为 1-10 的整数')
      return
    }
    const time = Number(form.time_limit_ms)
    if (!Number.isInteger(time) || time <= 0) {
      setError('时间限制需为正整数（毫秒）')
      return
    }
    const memory = Number(form.memory_limit_kb)
    if (!Number.isInteger(memory) || memory <= 0) {
      setError('内存限制需为正整数（KB）')
      return
    }

    const payload = {
      title: form.title.trim(),
      statement: form.statement,
      input_format: form.input_format,
      output_format: form.output_format,
      hint: form.hint,
      samples,
      time_limit_ms: time,
      memory_limit_kb: memory,
      difficulty,
      tags: form.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean),
    }

    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await updateProblem(id!, payload)
        navigate(`/problem/${id}`)
      } else {
        const created = await createProblem(payload)
        navigate(`/problem/${created.id}`)
      }
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <div className="page-loading">加载中…</div>
  }

  return (
    <div className="form-page">
      <div className="page-header">
        <h1 className="page-title">{isEdit ? '编辑题目' : '新建题目'}</h1>
        {isEdit && (
          <Link to={`/problem/${id}`} className="button button-secondary">
            返回题目
          </Link>
        )}
      </div>

      <form onSubmit={submit} className="problem-form">
        <div className="form-group">
          <label htmlFor="p-title">标题</label>
          <input
            id="p-title"
            type="text"
            value={form.title}
            onChange={(e) => setField('title', e.target.value)}
            placeholder="题目标题"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="p-difficulty">难度（1-10）</label>
            <input
              id="p-difficulty"
              type="number"
              min={1}
              max={10}
              value={form.difficulty}
              onChange={(e) => setField('difficulty', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="p-time">时间限制（ms）</label>
            <input
              id="p-time"
              type="number"
              min={1}
              value={form.time_limit_ms}
              onChange={(e) => setField('time_limit_ms', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="p-memory">内存限制（KB）</label>
            <input
              id="p-memory"
              type="number"
              min={1}
              value={form.memory_limit_kb}
              onChange={(e) => setField('memory_limit_kb', e.target.value)}
            />
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="p-tags">标签（逗号分隔）</label>
          <input
            id="p-tags"
            type="text"
            value={form.tags}
            onChange={(e) => setField('tags', e.target.value)}
            placeholder="例如：动态规划, 图论"
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-statement">题目描述（Markdown，支持 KaTeX）</label>
          <textarea
            id="p-statement"
            className="markdown-editor"
            value={form.statement}
            onChange={(e) => setField('statement', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-input-format">输入格式（Markdown）</label>
          <textarea
            id="p-input-format"
            className="markdown-editor"
            value={form.input_format}
            onChange={(e) => setField('input_format', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-output-format">输出格式（Markdown）</label>
          <textarea
            id="p-output-format"
            className="markdown-editor"
            value={form.output_format}
            onChange={(e) => setField('output_format', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-hint">提示（Markdown，可选）</label>
          <textarea
            id="p-hint"
            className="markdown-editor"
            value={form.hint}
            onChange={(e) => setField('hint', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label>样例</label>
          {samples.map((s, i) => (
            <div key={i} className="sample-editor">
              <div className="sample-editor-header">
                <span>样例 #{i + 1}</span>
                <button
                  type="button"
                  className="small-button button-danger"
                  onClick={() => removeSample(i)}
                  disabled={samples.length <= 1}
                >
                  删除
                </button>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>输入</label>
                  <textarea
                    className="markdown-editor"
                    value={s.input}
                    onChange={(e) => updateSample(i, 'input', e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>输出</label>
                  <textarea
                    className="markdown-editor"
                    value={s.output}
                    onChange={(e) => updateSample(i, 'output', e.target.value)}
                  />
                </div>
              </div>
              <div className="form-group">
                <label>说明（可选）</label>
                <textarea
                  className="markdown-editor"
                  value={s.note}
                  onChange={(e) => updateSample(i, 'note', e.target.value)}
                />
              </div>
            </div>
          ))}
          <button type="button" className="button button-secondary" onClick={addSample}>
            添加样例
          </button>
        </div>

        {error && <div className="error-message">{error}</div>}

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={saving}>
            {saving ? '保存中…' : isEdit ? '保存修改' : '创建题目'}
          </button>
        </div>
      </form>
    </div>
  )
}
