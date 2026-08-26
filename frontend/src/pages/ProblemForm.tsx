import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { createProblem, extractError, getProblem, updateProblem } from '../api'
import Markdown from '../components/Markdown'
import type { ProblemType, Sample } from '../types'
import { DIFFICULTIES } from '../utils/difficulty'

const emptySample = (): Sample => ({ input: '', output: '', note: '' })

const TYPE_LABELS: Record<ProblemType, string> = {
  standard: '标准（输出比对）',
  spj: 'Special Judge（自定义判定/部分分）',
  interactive: '交互题（与交互器通信）',
  output_only: '输出题（仅提交答案）',
}

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
  type: ProblemType
  status: string
  spj_source: string
  interactor_source: string
}

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
  type: 'standard',
  status: 'draft',
  spj_source: '',
  interactor_source: '',
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
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [preview, setPreview] = useState(false)
  const dirtyRef = useRef(false)

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
          type: p.type ?? 'standard',
          status: p.status ?? 'published',
          spj_source: p.spj_source ?? '',
          interactor_source: p.interactor_source ?? '',
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

  // 未保存离开提醒
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (dirtyRef.current) {
        e.preventDefault()
      }
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [])

  const markDirty = () => {
    dirtyRef.current = true
    setSavedAt(null)
  }

  const setField = (field: keyof FormState, value: string) => {
    markDirty()
    setForm((f) => ({ ...f, [field]: value }))
  }

  const updateSample = (i: number, field: keyof Sample, value: string) => {
    markDirty()
    setSamples((prev) => prev.map((s, idx) => (idx === i ? { ...s, [field]: value } : s)))
  }

  const addSample = () => {
    markDirty()
    setSamples((prev) => [...prev, emptySample()])
  }

  const removeSample = (i: number) => {
    markDirty()
    setSamples((prev) => prev.filter((_, idx) => idx !== i))
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!form.title.trim()) {
      setError('请填写标题')
      return
    }
    const difficulty = Number(form.difficulty)
    if (!Number.isInteger(difficulty) || difficulty < 1 || difficulty > 9) {
      setError('请选择有效的题目难度')
      return
    }
    const time = Number(form.time_limit_ms)
    if (!Number.isInteger(time) || time < 100 || time > 30000) {
      setError('时间限制需在 100-30000 ms 之间')
      return
    }
    const memory = Number(form.memory_limit_kb)
    if (!Number.isInteger(memory) || memory < 16384 || memory > 1048576) {
      setError('内存限制需在 16MB-1GB 之间（KB）')
      return
    }
    if (form.type === 'spj' && !form.spj_source.trim()) {
      setError('SPJ 题目必须提供评测器源码')
      return
    }
    if (form.type === 'interactive' && !form.interactor_source.trim()) {
      setError('交互题必须提供交互器源码')
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
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
      type: form.type,
      spj_source: form.spj_source,
      interactor_source: form.interactor_source,
      testcase_scores: [] as number[],
      submission_limit: 0,
      status: form.status,
    }

    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await updateProblem(id!, payload)
        dirtyRef.current = false
        setSavedAt(Date.now())
        navigate(`/problem/${id}`)
      } else {
        const created = await createProblem(payload)
        dirtyRef.current = false
        navigate(`/admin/problems/${created.id}/tests`)
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
          <div style={{ display: 'flex', gap: 8 }}>
            <Link to={`/problem/${id}`} className="button button-secondary">返回题目</Link>
            <Link to={`/admin/problems/${id}/tests`} className="button button-secondary">测试点管理</Link>
          </div>
        )}
      </div>

      <form onSubmit={submit} className="problem-form">
        <div className="form-row">
          <div className="form-group" style={{ flex: 2 }}>
            <label htmlFor="p-title">标题</label>
            <input
              id="p-title"
              type="text"
              value={form.title}
              onChange={(e) => setField('title', e.target.value)}
              placeholder="题目标题"
            />
          </div>
          <div className="form-group">
            <label htmlFor="p-status">状态</label>
            <select id="p-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
              <option value="draft">草稿（不可公共访问）</option>
              <option value="published">已发布</option>
              <option value="disabled">已停用</option>
            </select>
            <p className="field-hint">
              发布标准/SPJ/交互题需要测试点总分恰好 100；输出题无需测试点。
            </p>
          </div>
        </div>

        <div className="form-group">
          <label>题型</label>
          <div className="template-grid">
            {(Object.keys(TYPE_LABELS) as ProblemType[]).map((t) => (
              <button
                key={t}
                type="button"
                className={`template-card ${form.type === t ? 'template-card-active' : ''}`}
                onClick={() => {
                  markDirty()
                  setForm((f) => ({ ...f, type: t }))
                }}
              >
                <span className="template-card-label">{t}</span>
                <span className="template-card-desc">{TYPE_LABELS[t]}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="p-difficulty">难度</label>
            <select
              id="p-difficulty"
              value={form.difficulty}
              onChange={(e) => setField('difficulty', e.target.value)}
            >
              {DIFFICULTIES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}（权重 {item.weight.toFixed(1)}）
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="p-time">时间限制（ms）</label>
            <input
              id="p-time"
              type="number"
              min={100}
              value={form.time_limit_ms}
              onChange={(e) => setField('time_limit_ms', e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="p-memory">内存限制（KB）</label>
            <input
              id="p-memory"
              type="number"
              min={16384}
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

        {form.type === 'spj' && (
          <div className="form-group">
            <label htmlFor="p-spj">SPJ 评测器源码（C++，在沙箱内编译）</label>
            <textarea
              id="p-spj"
              className="code-editor-textarea"
              value={form.spj_source}
              onChange={(e) => setField('spj_source', e.target.value)}
              placeholder={'协议：./spj <输入文件> <选手输出> <答案文件>\n退出码 0=AC 1=WA 2=PE；可选 stdout 第一行输出 0-100 部分分'}
            />
          </div>
        )}
        {form.type === 'interactive' && (
          <div className="form-group">
            <label htmlFor="p-interactor">交互器源码（C++，在沙箱内编译）</label>
            <textarea
              id="p-interactor"
              className="code-editor-textarea"
              value={form.interactor_source}
              onChange={(e) => setField('interactor_source', e.target.value)}
              placeholder={'协议：argv[1] 为输入文件；stdin 读选手输出，stdout 写给选手（每次必须 flush）\n退出码 0=AC 1=WA 2=SE'}
            />
          </div>
        )}
        {form.type === 'output_only' && (
          <div className="notice-card">输出题：选手仅提交答案文件，不使用测试点。限制与样例照常展示。</div>
        )}

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="p-statement">题目描述（Markdown，支持 KaTeX）</label>
            <label className="checkbox-label">
              <input type="checkbox" checked={preview} onChange={(e) => setPreview(e.target.checked)} />
              预览
            </label>
          </div>
          {preview ? (
            <div className="markdown-preview card">
              <Markdown>{form.statement || '*（空）*'}</Markdown>
            </div>
          ) : (
            <textarea
              id="p-statement"
              className="markdown-editor"
              value={form.statement}
              onChange={(e) => setField('statement', e.target.value)}
            />
          )}
        </div>

        <div className="form-group">
          <label htmlFor="p-input-format">输入格式（Markdown）</label>
          <textarea
            id="p-input-format"
            className="markdown-editor small"
            value={form.input_format}
            onChange={(e) => setField('input_format', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-output-format">输出格式（Markdown）</label>
          <textarea
            id="p-output-format"
            className="markdown-editor small"
            value={form.output_format}
            onChange={(e) => setField('output_format', e.target.value)}
          />
        </div>

        <div className="form-group">
          <label htmlFor="p-hint">提示（Markdown，可选）</label>
          <textarea
            id="p-hint"
            className="markdown-editor small"
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
            {saving ? '保存中…' : isEdit ? '保存修改' : '创建并配置测试点'}
          </button>
          {savedAt !== null && <span className="success-message">已保存</span>}
          {dirtyRef.current && !saving && <span className="muted">有未保存的修改</span>}
        </div>
      </form>
    </div>
  )
}
