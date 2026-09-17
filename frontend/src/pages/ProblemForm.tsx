import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { createProblem, extractError, getProblem, updateProblem } from '../api'
import Markdown from '../components/Markdown'
import PageHeader from '../components/PageHeader'
import ProblemAdminTabs from '../components/ProblemAdminTabs'
import ProblemAttachments from '../components/ProblemAttachments'
import type { CheckerMode, ProblemType, Sample } from '../types'
import { DIFFICULTIES } from '../utils/difficulty'

const emptySample = (): Sample => ({ input: '', output: '', note: '' })

const TYPE_LABELS: Record<ProblemType, string> = {
  standard: '标准（输出比对）',
  hack: 'Hack（攻击目标程序）',
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
  checker_mode: CheckerMode
  status: string
  provider: string
  show_score: boolean
  spj_source: string
  interactor_source: string
  hack_generator_source: string
  hack_reference_source: string
  hack_target_source: string
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
  checker_mode: 'token',
  status: 'draft',
  provider: '',
  show_score: true,
  spj_source: '',
  interactor_source: '',
  hack_generator_source: '',
  hack_reference_source: '',
  hack_target_source: '',
}

export default function ProblemForm() {
  const { id } = useParams()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  // 题面设置 / 题目设置共用同一份表单状态，只切换显示哪一组字段（?tab=settings）
  const tab = searchParams.get('tab') === 'settings' ? 'settings' : 'statement'

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
          checker_mode: p.checker_mode ?? 'token',
          status: p.status ?? 'published',
          provider: p.provider ?? '',
          show_score: p.show_score ?? true,
          spj_source: p.spj_source ?? '',
          interactor_source: p.interactor_source ?? '',
          hack_generator_source: p.hack_generator_source ?? '',
          hack_reference_source: p.hack_reference_source ?? '',
          hack_target_source: p.hack_target_source ?? '',
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

  const setField = (field: keyof FormState, value: string | boolean) => {
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

  // intent='tests'：保存后直接进数据设置（主按钮）；intent='stay'：只保存并留在本页
  const submit = async (intent: 'stay' | 'tests') => {
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
    if (form.type === 'hack' && !form.hack_target_source.trim()) {
      setError('Hack 题必须提供待攻击的目标程序源码')
      return
    }
    if (form.type === 'hack' && !form.hack_reference_source.trim()) {
      setError('Hack 题必须提供判题参考解源码')
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
      checker_mode: form.type === 'standard' ? form.checker_mode : 'token',
      spj_source: form.spj_source,
      interactor_source: form.interactor_source,
      hack_generator_source: form.hack_generator_source,
      hack_reference_source: form.hack_reference_source,
      hack_target_source: form.hack_target_source,
      testcase_scores: [] as number[],
      submission_limit: 0,
      status: form.status,
      provider: form.provider.trim(),
      show_score: form.show_score,
    }

    setSaving(true)
    setError('')
    try {
      if (isEdit) {
        await updateProblem(id!, payload)
        dirtyRef.current = false
        if (intent === 'tests') {
          navigate(`/admin/problems/${id}/tests`)
        } else {
          setSavedAt(Date.now())
        }
      } else {
        const created = await createProblem(payload)
        dirtyRef.current = false
        navigate(intent === 'tests' ? `/admin/problems/${created.id}/tests` : `/problem/${created.id}/edit?tab=settings`)
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
    <div className="admin-form-page">
      <PageHeader
        eyebrow="题目管理"
        title={isEdit ? '编辑题目' : '新建题目'}
        description={isEdit
          ? '题面设置管题面与样例；题目设置管提供者、难度、标签、分数与评测器；数据设置管测试点。'
          : '先填题面与题目设置，保存后即可配置测试点与附件。'}
        actions={isEdit ? (
          <div className="page-actions">
            <Link to={`/problem/${id}`} className="button button-secondary">返回题目</Link>
          </div>
        ) : undefined}
      />

      <ProblemAdminTabs problemId={isEdit ? id : undefined} active={tab} />

      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit('stay')
        }}
        className="problem-form"
      >
        {tab === 'statement' ? (
          <>
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

            <div className="form-group">
              <div className="label-row">
                <label htmlFor="p-statement">题目描述（Markdown，支持 KaTeX）</label>
                <label className="check-row">
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

            <fieldset className="form-group admin-fieldset">
              <legend className="field-label">样例</legend>
              {samples.map((s, i) => (
                <div key={i} className="sample-editor">
                  <div className="sample-editor-header">
                    <span>样例 #{i + 1}</span>
                    <button
                      type="button"
                      className="button button-ghost button-sm danger"
                      onClick={() => removeSample(i)}
                      disabled={samples.length <= 1}
                    >
                      删除
                    </button>
                  </div>
                  <div className="layout-split">
                    <div className="form-group">
                      <label htmlFor={`p-sample-in-${i}`}>输入</label>
                      <textarea
                        id={`p-sample-in-${i}`}
                        className="markdown-editor"
                        value={s.input}
                        onChange={(e) => updateSample(i, 'input', e.target.value)}
                      />
                    </div>
                    <div className="form-group">
                      <label htmlFor={`p-sample-out-${i}`}>输出</label>
                      <textarea
                        id={`p-sample-out-${i}`}
                        className="markdown-editor"
                        value={s.output}
                        onChange={(e) => updateSample(i, 'output', e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="form-group">
                    <label htmlFor={`p-sample-note-${i}`}>说明（可选）</label>
                    <textarea
                      id={`p-sample-note-${i}`}
                      className="markdown-editor"
                      value={s.note}
                      onChange={(e) => updateSample(i, 'note', e.target.value)}
                    />
                  </div>
                </div>
              ))}
              <div className="admin-form-actions">
                <button type="button" className="button button-secondary" onClick={addSample}>
                  添加样例
                </button>
              </div>
            </fieldset>
          </>
        ) : (
          <>
            <div className="admin-form-cols">
              <div className="form-group">
                <label htmlFor="p-provider">提供者 / 来源</label>
                <input
                  id="p-provider"
                  type="text"
                  value={form.provider}
                  onChange={(e) => setField('provider', e.target.value)}
                  placeholder="例如：Codeforces 1900E、2024 校赛"
                />
                <p className="field-hint">展现在题目页，用来说明题目出处；可留空。</p>
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
            </div>

            <div className="admin-form-row-3">
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

            <div className="admin-form-cols">
              <div className="form-group">
                <label htmlFor="p-status">题目状态</label>
                <select id="p-status" value={form.status} onChange={(e) => setField('status', e.target.value)}>
                  <option value="draft">草稿（不可公共访问）</option>
                  <option value="published">已发布</option>
                  <option value="disabled">已停用</option>
                </select>
                <p className="field-hint">
                  发布标准/Hack/SPJ/交互题需要测试点总分恰好 100；输出题无需测试点。
                </p>
              </div>
              <div className="form-group">
                <label htmlFor="p-show-score">显示分数</label>
                <label className="check-row">
                  <input
                    id="p-show-score"
                    type="checkbox"
                    checked={form.show_score}
                    onChange={(e) => setField('show_score', e.target.checked)}
                  />
                  在提交结果里展示该题得分
                </label>
                <p className="field-hint">
                  关掉后选手只看到结论与耗时/内存，看不到得分与逐点得分（管理员始终可见）。
                </p>
              </div>
            </div>

            <fieldset className="form-group admin-fieldset">
              <legend className="field-label">题型</legend>
              <div className="template-grid">
                {(Object.keys(TYPE_LABELS) as ProblemType[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    aria-pressed={form.type === t}
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
            </fieldset>

            {form.type === 'standard' && (
              <div className="form-group">
                <label htmlFor="p-checker-mode">输出判定</label>
                <select
                  id="p-checker-mode"
                  value={form.checker_mode}
                  onChange={(e) => setField('checker_mode', e.target.value)}
                >
                  <option value="token">Token：忽略空格、换行与制表符差异</option>
                  <option value="exact">Exact：格式必须一致，纯格式差异判为 PE</option>
                </select>
                <p className="field-hint">
                  两种模式均区分大小写；Exact 仅统一 Windows / Linux 换行符。
                </p>
              </div>
            )}

            {form.type === 'hack' && (
              <div className="info-message">
                Hack 题由管理员提供待攻击的目标程序。题面会公开这段代码，选手提交符合输入格式的攻击数据；目标程序在沙箱中运行，若出现 WA、TLE、MLE 或 RE，则本次 Hack 成功。
              </div>
            )}

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
            {form.type === 'hack' && (
              <>
                <div className="form-group">
                  <label htmlFor="p-hack-target">待攻击程序源码（C++，会展示在题面）</label>
                  <textarea
                    id="p-hack-target"
                    className="code-editor-textarea"
                    value={form.hack_target_source}
                    onChange={(e) => setField('hack_target_source', e.target.value)}
                    placeholder={'填写需要被攻击的错误程序。选手提交的内容会作为 stdin 传给这段程序。'}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="p-hack-reference">判题参考解源码（C++，管理员维护，不会展示给选手）</label>
                  <textarea
                    id="p-hack-reference"
                    className="code-editor-textarea"
                    value={form.hack_reference_source}
                    onChange={(e) => setField('hack_reference_source', e.target.value)}
                    placeholder={'读取 stdin 中的 Hack 输入数据并输出标准答案。参考解仅在评测沙箱内运行，不会展示给选手。'}
                  />
                </div>
                <details className="form-advanced">
                  <summary>兼容旧版：测试生成器</summary>
                  <div className="form-group">
                    <label htmlFor="p-hack-generator">Hack 测试生成器源码（C++，管理员维护）</label>
                    <textarea
                      id="p-hack-generator"
                      className="code-editor-textarea"
                      value={form.hack_generator_source}
                      onChange={(e) => setField('hack_generator_source', e.target.value)}
                      placeholder={'从 stdin 读取测试种子并向 stdout 输出一组完整测试输入。每个测试点种子会单独运行一次。'}
                    />
                  </div>
                </details>
              </>
            )}
            {form.type === 'output_only' && (
              <div className="info-message">输出题：选手仅提交答案文件，不使用测试点。限制与样例照常展示。</div>
            )}

            <ProblemAttachments problemId={isEdit ? id : undefined} />
          </>
        )}

        {error && <div className="error-message">{error}</div>}

        <div className="admin-form-actions">
          <button type="submit" className="button button-secondary" disabled={saving}>
            {isEdit ? '保存' : '仅创建'}
          </button>
          <button
            type="button"
            className="button button-primary"
            disabled={saving}
            onClick={() => void submit('tests')}
          >
            {saving ? '保存中…' : isEdit ? '保存并去配置数据' : '创建并去配置数据'}
          </button>
          {savedAt !== null && <span className="success-message">已保存</span>}
          {dirtyRef.current && !saving && <span className="field-hint">有未保存的修改</span>}
        </div>
      </form>
    </div>
  )
}
