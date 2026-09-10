import { useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { contestCoverUrl, createContest, extractError, getContest, updateContest, uploadContestCover } from '../api'
import MarkdownEditor from '../components/MarkdownEditor'
import PageHeader from '../components/PageHeader'
import { ProblemManager } from './ContestProblemManagerPage'
import type { Contest, ContestInput, ContestMode, ContestProblem } from '../types'
import { fromLocalInput, toLocalInput } from '../utils/contest'

// ---------- 赛制模板 ----------
// 模板 = 一组预设参数的快捷方式。每张卡片显式列出"会设置什么"，
// 避免用户点一下之后下面控件悄悄变化却无从判断。
type Template = 'acm' | 'icpc' | 'cf' | 'oi' | 'ioi' | 'practice' | 'custom'

type Engine = ContestMode
type Feedback = 'realtime' | 'blind'
type ScoreMode = 'all_or_nothing' | 'partial'

interface TemplatePreset {
  engine: Engine
  feedback: Feedback
  freeze: boolean
  scoreMode: ScoreMode
  submissionLimit?: string
}

const TEMPLATES: { key: Template; label: string; desc: string; preset: TemplatePreset | null }[] = [
  {
    key: 'acm', label: 'ACM 标准',
    desc: '通过题数优先，罚时 = 通过用时 + 错误次数 × 罚时',
    preset: { engine: 'ACM', feedback: 'realtime', freeze: false, scoreMode: 'all_or_nothing' },
  },
  {
    key: 'icpc', label: 'ICPC 滚榜',
    desc: 'ACM 规则 + 最后一段时间封榜，赛后在动态榜单逐条揭晓',
    preset: { engine: 'ACM', feedback: 'realtime', freeze: true, scoreMode: 'all_or_nothing' },
  },
  {
    key: 'cf', label: 'Codeforces',
    desc: '单题分值随时间线性衰减（结束降到 30%），按总分排名，错误提交罚 10 分钟',
    preset: { engine: 'CF', feedback: 'realtime', freeze: false, scoreMode: 'all_or_nothing' },
  },
  {
    key: 'oi', label: 'OI',
    desc: '按总分排名，每题取最后一次提交的得分',
    preset: { engine: 'OI', feedback: 'realtime', freeze: false, scoreMode: 'partial' },
  },
  {
    key: 'ioi', label: 'IOI',
    desc: '按总分排名，每题取各次提交的最优得分',
    preset: { engine: 'IOI', feedback: 'realtime', freeze: false, scoreMode: 'partial' },
  },
  {
    key: 'practice', label: '练习赛',
    desc: '实时反馈、按总分部分分、不限提交次数，适合课堂练习',
    preset: { engine: 'IOI', feedback: 'realtime', freeze: false, scoreMode: 'partial', submissionLimit: '0' },
  },
  {
    key: 'custom', label: '自定义',
    desc: '手动指定评分引擎与全部参数',
    preset: null,
  },
]

const ENGINE_LABELS: Record<Engine, string> = {
  ACM: 'ACM（通过题数 + 罚时）',
  OI: 'OI（总分，每题取最后一次）',
  IOI: 'IOI（总分，每题取最优）',
  CF: 'Codeforces（总分 + 分值随时间衰减）',
}

const FEEDBACK_LABELS: Record<Feedback, string> = {
  realtime: '实时反馈',
  blind: '盲评（比赛进行中隐藏结果与榜单）',
}

const SCORE_MODE_LABELS: Record<ScoreMode, string> = {
  all_or_nothing: '整题通过才计分',
  partial: '按测试点部分计分',
}

/** 由已有比赛的实际字段反推模板；与任何预置都不一致时为"自定义"。 */
function deriveTemplate(c: Contest): Template {
  const freeze = c.freeze_duration_minutes > 0
  if (c.feedback !== 'realtime') return 'custom'
  if (c.mode === 'ACM') return freeze ? 'icpc' : 'acm'
  if (c.mode === 'CF') return freeze ? 'custom' : 'cf'
  if (c.mode === 'OI') return freeze ? 'custom' : 'oi'
  if (c.mode === 'IOI') return freeze ? 'custom' : 'ioi'
  return 'custom'
}

function templateSummary(preset: TemplatePreset): string {
  return [
    ENGINE_LABELS[preset.engine].split('（')[0],
    preset.freeze ? '封榜' : '不封榜',
    preset.feedback === 'blind' ? '盲评' : '实时',
    SCORE_MODE_LABELS[preset.scoreMode],
  ].join(' · ')
}

/** 两个 datetime-local 值之间的分钟差（无效或倒序时返回 null）。 */
function diffMinutes(start: string, end: string): number | null {
  if (!start || !end) return null
  const s = new Date(start).getTime()
  const e = new Date(end).getTime()
  if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null
  return Math.round((e - s) / 60000)
}

function formatDuration(minutes: number): string {
  const d = Math.floor(minutes / 1440)
  const h = Math.floor((minutes % 1440) / 60)
  const m = minutes % 60
  const parts: string[] = []
  if (d > 0) parts.push(`${d} 天`)
  if (h > 0) parts.push(`${h} 小时`)
  if (m > 0 || parts.length === 0) parts.push(`${m} 分钟`)
  return parts.join(' ')
}

interface FieldError {
  /** 出错字段的 DOM id，用于定位滚动 */
  field: string
  message: string
}

export default function ContestForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const isEdit = Boolean(id)
  const contestId = Number(id)
  const justCreated = Boolean((location.state as { created?: boolean } | null)?.created)

  // 基本信息
  const [title, setTitle] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [description, setDescription] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')

  // 赛制与计分
  const [template, setTemplate] = useState<Template>('acm')
  const [engine, setEngine] = useState<Engine>('ACM')
  const [feedback, setFeedback] = useState<Feedback>('realtime')
  const [scoreMode, setScoreMode] = useState<ScoreMode>('all_or_nothing')
  const [penaltyMinutes, setPenaltyMinutes] = useState('20')

  // 时间安排
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [freezeEnabled, setFreezeEnabled] = useState(false)
  const [freezeMinutes, setFreezeMinutes] = useState('60')
  const [regWindowMode, setRegWindowMode] = useState<'follow' | 'custom'>('follow')
  const [regStart, setRegStart] = useState('')
  const [regEnd, setRegEnd] = useState('')

  // 参赛与提交
  const [registrationMode, setRegistrationMode] = useState<'individual' | 'team' | 'both'>('both')
  const [maxTeamSize, setMaxTeamSize] = useState('1')
  const [allowTeamEdit, setAllowTeamEdit] = useState(true)
  const [submissionLimit, setSubmissionLimit] = useState('0')

  // 榜单与展示
  const [dynamicDelayMinutes, setDynamicDelayMinutes] = useState('0')
  const [rankKeys, setRankKeys] = useState('')
  // CF 专属：预测试模式（赛中只跑预测试，赛后系统测试）与开放 Hack
  const [pretestOnly, setPretestOnly] = useState(false)
  const [hackingEnabled, setHackingEnabled] = useState(false)

  const [contestProblems, setContestProblems] = useState<ContestProblem[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([])
  const [error, setError] = useState('')
  const [savedNotice, setSavedNotice] = useState('')
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    getContest(contestId)
      .then((data) => {
        if (cancelled) return
        const c = data.contest
        setTitle(c.title)
        setEngine(c.mode)
        // 按实际字段反推模板，避免"ACM+盲评"被高亮成"ACM 标准"
        setTemplate(deriveTemplate(c))
        setFeedback(c.feedback)
        setScoreMode(c.score_mode)
        setPenaltyMinutes(String(c.penalty_minutes))
        setFreezeEnabled(c.freeze_duration_minutes > 0)
        setFreezeMinutes(String(c.freeze_duration_minutes > 0 ? c.freeze_duration_minutes : 60))
        setDynamicDelayMinutes(String(c.dynamic_delay_minutes ?? 0))
        setPretestOnly(c.pretest_only ?? false)
        setHackingEnabled(c.hacking_enabled ?? false)
        setRankKeys(c.rank_keys.join(', '))
        setStartTime(toLocalInput(c.start_time))
        setEndTime(toLocalInput(c.end_time))
        setDescription(c.description ?? '')
        setCoverPreview(contestCoverUrl(c.id, c.cover_image))
        setVisibility(c.visibility ?? 'public')
        setRegWindowMode(c.reg_start_time || c.reg_end_time ? 'custom' : 'follow')
        setRegStart(c.reg_start_time ? toLocalInput(c.reg_start_time) : '')
        setRegEnd(c.reg_end_time ? toLocalInput(c.reg_end_time) : '')
        setSubmissionLimit(String(c.submission_limit ?? 0))
        setRegistrationMode(c.registration_mode ?? 'both')
        setMaxTeamSize(String(c.max_team_size ?? 1))
        setAllowTeamEdit(c.allow_team_edit ?? true)
        setContestProblems(data.problems)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isEdit, contestId])

  const reloadContestProblems = () => {
    if (!isEdit) return
    getContest(contestId)
      .then((data) => setContestProblems(data.problems))
      .catch((err) => setError(extractError(err)))
  }

  const markDirty = () => {
    setDirty(true)
    setSavedNotice('')
  }

  const applyTemplate = (key: Template) => {
    markDirty()
    setTemplate(key)
    const preset = TEMPLATES.find((t) => t.key === key)?.preset
    if (!preset) return // 自定义：保留现有参数
    setEngine(preset.engine)
    setFeedback(preset.feedback)
    setScoreMode(preset.scoreMode)
    if (preset.engine === 'ACM') setPenaltyMinutes((p) => p || '20')
    if (preset.engine === 'CF') setPenaltyMinutes('10') // CF 惯例：每次错误提交罚 10 分钟
    if (preset.freeze) {
      setFreezeEnabled(true)
      setFreezeMinutes((m) => (Number(m) > 0 ? m : '60'))
    } else {
      setFreezeEnabled(false)
    }
    if (preset.submissionLimit !== undefined) setSubmissionLimit(preset.submissionLimit)
  }

  // ---------- 派生状态 ----------
  const isACMEngine = engine === 'ACM'
  // CF 与 ACM 都使用「罚时」参数（CF 惯例 10 分钟）
  const usesPenalty = engine === 'ACM' || engine === 'CF'
  const isCFEngine = engine === 'CF'
  const durationMinutes = useMemo(() => diffMinutes(startTime, endTime), [startTime, endTime])
  const freezeMinutesNum = Math.max(0, Number(freezeMinutes) || 0)
  const effectiveFreeze = freezeEnabled && isACMEngine ? freezeMinutesNum : 0
  const freezeExceedsDuration =
    effectiveFreeze > 0 && durationMinutes !== null && effectiveFreeze >= durationMinutes

  const configChips = [
    ENGINE_LABELS[engine].split('（')[0],
    FEEDBACK_LABELS[feedback].split('（')[0],
    usesPenalty ? `罚时 ${Number(penaltyMinutes) || 0} 分钟` : SCORE_MODE_LABELS[scoreMode],
    isCFEngine ? '分值随时间衰减至 30%' : effectiveFreeze > 0 ? `封榜 ${effectiveFreeze} 分钟` : '不封榜',
    Number(submissionLimit) > 0 ? `单题最多 ${Number(submissionLimit)} 次提交` : '提交次数不限',
    visibility === 'private' ? '私有比赛' : '公开比赛',
  ]

  // ---------- 校验 ----------
  const validate = (): FieldError[] => {
    const errors: FieldError[] = []
    if (!title.trim()) errors.push({ field: 'contest-title', message: '请填写比赛标题' })
    if (!startTime) errors.push({ field: 'contest-start-date', message: '请选择开始日期' })
    if (!endTime) errors.push({ field: 'contest-end-date', message: '请选择结束日期' })
    if (startTime && endTime && diffMinutes(startTime, endTime) === null) {
      errors.push({ field: 'contest-end-date', message: '结束时间必须晚于开始时间' })
    }
    if (!isACMEngine && freezeEnabled) {
      errors.push({ field: 'contest-freeze-toggle', message: '封榜仅 ACM 赛制支持，请切换赛制或关闭封榜' })
    }
    if (isACMEngine && freezeEnabled && freezeMinutesNum <= 0) {
      errors.push({ field: 'contest-freeze', message: '封榜时长需大于 0 分钟' })
    }
    if (isACMEngine && freezeEnabled && freezeExceedsDuration) {
      errors.push({
        field: 'contest-freeze',
        message: `封榜时长（${freezeMinutesNum} 分钟）不能达到或超过比赛时长（${formatDuration(durationMinutes!)}）`,
      })
    }
    if (regWindowMode === 'custom') {
      if (!regStart) errors.push({ field: 'reg-start-date', message: '请选择报名开始时间' })
      if (!regEnd) errors.push({ field: 'reg-end-date', message: '请选择报名截止时间' })
      if (regStart && regEnd && diffMinutes(regStart, regEnd) === null) {
        errors.push({ field: 'reg-end-date', message: '报名截止必须晚于报名开始' })
      }
    }
    return errors
  }

  const focusFirstError = (errors: FieldError[]) => {
    if (errors.length === 0) return
    const el = document.getElementById(errors[0].field)
    if (el) {
      el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      ;(el as HTMLInputElement).focus?.()
    }
  }

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSavedNotice('')
    const errors = validate()
    setFieldErrors(errors)
    if (errors.length > 0) {
      setError(`还有 ${errors.length} 项需要修正：${errors.map((item) => item.message).join('；')}`)
      focusFirstError(errors)
      return
    }
    setError('')

    const start = new Date(startTime).getTime()
    // 比赛已开始后修改关键配置：明确列出风险
    if (isEdit && Date.now() >= start) {
      const risk = [
        '比赛已经开始，修改赛制、罚时、封榜或时间会影响已产生的排行榜与判定结果。',
        '已封榜的比赛修改配置可能导致动态揭晓数据与固定榜单不一致。',
        '题目的增删改在下方"比赛题目"区即时生效，不随本次保存回滚。',
      ].join('\n')
      if (!window.confirm(`${risk}\n\n确定继续保存？`)) return
    }

    const payload: ContestInput = {
      title: title.trim(),
      mode: engine,
      feedback,
      score_mode: scoreMode,
      penalty_minutes: Math.max(0, Number(penaltyMinutes) || 0),
      freeze_duration_minutes: effectiveFreeze,
      dynamic_delay_minutes: isACMEngine ? Math.max(0, Math.min(720, Number(dynamicDelayMinutes) || 0)) : 0,
      rank_keys: rankKeys
        .split(/[,，\s]+/)
        .map((s) => s.trim())
        .filter(Boolean),
      start_time: fromLocalInput(startTime),
      end_time: fromLocalInput(endTime),
      description,
      visibility,
      submission_limit: Math.max(0, Number(submissionLimit) || 0),
      registration_mode: registrationMode,
      max_team_size: registrationMode === 'individual' ? 1 : Math.max(1, Number(maxTeamSize) || 1),
      allow_team_edit: allowTeamEdit,
      // 预测试与开放 Hack 只对 CF 赛制生效
      pretest_only: isCFEngine ? pretestOnly : false,
      hacking_enabled: isCFEngine ? hackingEnabled : false,
      ...(regWindowMode === 'custom' && regStart && regEnd
        ? { reg_start_time: fromLocalInput(regStart), reg_end_time: fromLocalInput(regEnd) }
        : {}),
    }
    setBusy(true)
    try {
      if (isEdit) {
        await updateContest(contestId, payload)
        if (coverFile) await uploadContestCover(contestId, coverFile)
        setDirty(false)
        setSavedNotice('比赛设置已保存')
        window.scrollTo({ top: 0, behavior: 'smooth' })
      } else {
        const c = await createContest(payload)
        if (coverFile) await uploadContestCover(c.id, coverFile)
        setDirty(false)
        // 创建后留在"设置"页：下一步就是添加题目（页面下方即时生效）
        navigate(`/contest/${c.id}/edit`, { state: { created: true } })
      }
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="page-loading">加载中…</div>

  const errorOf = (field: string) => fieldErrors.find((item) => item.field === field)?.message

  return (
    <div className="contest-form-page">
      <PageHeader
        eyebrow="比赛管理"
        title={isEdit ? '比赛设置' : '新建比赛'}
        description={isEdit
          ? '上方表单配置比赛规则（需点"保存"生效）；下方"比赛题目"即时生效。'
          : '按分区填写：基本信息 → 赛制与计分 → 时间安排 → 参赛与提交 → 榜单与展示。创建后即可添加题目。'}
        actions={isEdit ? (
          <>
            <Link to={`/contest/${contestId}/participants`} className="button button-secondary">参赛者</Link>
            <Link to={`/contest/${contestId}/messages`} className="button button-secondary">消息管理</Link>
            <Link to={`/contest/${contestId}`} className="button button-secondary">返回比赛总览</Link>
          </>
        ) : undefined}
      />

      {isEdit && (
        <nav className="tabs contest-manage-nav" aria-label="比赛管理导航">
          <span className="tab active" aria-current="page">比赛设置与题目</span>
          <Link className="tab" to={`/contest/${contestId}/messages`}>消息管理</Link>
          <Link className="tab" to={`/contest/${contestId}/participants`}>参赛者</Link>
        </nav>
      )}

      {justCreated && (
        <div className="info-message" role="status">
          <strong>比赛已创建。</strong>
          下一步：在页面下方「比赛题目」区搜索题库添加题目，并确认题号与顺序；随后核对开始/结束时间即可开放报名。
        </div>
      )}

      <form className="card form-card" onSubmit={submit}>
        {/* ---------- ① 基本信息 ---------- */}
        <section className="form-section">
          <div className="section-head">
            <h2 className="section-title">① 基本信息</h2>
            <span className="section-hint">比赛列表与总览页上展示的内容。</span>
          </div>

          <div className="form-group">
            <label htmlFor="contest-title">比赛标题</label>
            <input
              id="contest-title"
              type="text"
              value={title}
              maxLength={128}
              onChange={(e) => { markDirty(); setTitle(e.target.value) }}
              placeholder="例如：2026 春季新生赛"
            />
            {errorOf('contest-title') && <p className="field-error">{errorOf('contest-title')}</p>}
          </div>

          <div className="toolbar toolbar-plain">
            <div className="form-group">
              <label htmlFor="contest-visibility">可见性</label>
              <select
                id="contest-visibility"
                value={visibility}
                onChange={(e) => { markDirty(); setVisibility(e.target.value as 'public' | 'private') }}
              >
                <option value="public">公开（出现在比赛列表）</option>
                <option value="private">私有（仅管理员与已报名用户可见）</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="contest-cover-file">比赛封面（可选）</label>
              <input
                id="contest-cover-file"
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (!file) return
                  if (file.size > 8 * 1024 * 1024) { setError('封面不能超过 8MB'); return }
                  markDirty()
                  setCoverFile(file)
                  setCoverPreview(URL.createObjectURL(file))
                }} />
              <p className="field-hint">JPG / PNG / GIF / WebP，最大 8MB。</p>
            </div>
          </div>
          {coverPreview && <img className="contest-cover-preview" src={coverPreview} alt="比赛封面预览" />}

          <div className="form-group">
            <label htmlFor="contest-desc">比赛说明 / 公告（Markdown，显示在总览顶部）</label>
            <MarkdownEditor
              id="contest-desc"
              value={description}
              onChange={(value) => { markDirty(); setDescription(value) }}
              placeholder="比赛规则、注意事项、公告…"
            />
          </div>
        </section>

        {/* ---------- ② 赛制与计分 ---------- */}
        <section className="form-section">
          <div className="section-head">
            <h2 className="section-title">② 赛制与计分</h2>
            <span className="section-hint">先用模板一键套用常见赛制，需要时再在下方逐项微调。</span>
          </div>
          <p className="section-hint">
            模板只影响下面这几个参数，点选后可以直接看到变化。
          </p>

          <div className="template-grid">
            {TEMPLATES.map((t) => (
              <button
                key={t.key}
                type="button"
                className={`template-card ${template === t.key ? 'template-card-active' : ''}`}
                onClick={() => applyTemplate(t.key)}
              >
                <span className="template-card-label">{t.label}</span>
                <span className="template-card-desc">{t.desc}</span>
                {t.preset && <span className="template-card-applies">将设置：{templateSummary(t.preset)}</span>}
              </button>
            ))}
          </div>

          <div className="config-summary">
            <span className="config-summary-label">当前配置</span>
            {configChips.map((chip) => <span key={chip} className="tag-chip">{chip}</span>)}
          </div>

          <div className="toolbar toolbar-plain">
            <div className="form-group">
              <label htmlFor="contest-engine">评分引擎</label>
              <select id="contest-engine" value={engine} onChange={(e) => {
                const next = e.target.value as Engine
                markDirty()
                setEngine(next)
                setTemplate('custom')
                // 切换到非 ACM 引擎时封榜不再适用，直接关掉避免提交被校验拦下
                if (next !== 'ACM') setFreezeEnabled(false)
              }}>
                {(Object.keys(ENGINE_LABELS) as Engine[]).map((key) => (
                  <option key={key} value={key}>{ENGINE_LABELS[key]}</option>
                ))}
              </select>
              <p className="field-hint">
                决定排行榜如何计算：ACM 比通过题数与罚时；OI / IOI 按总分。
                {template !== 'custom' && ' 手改此项会自动切换为「自定义」模板。'}
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="contest-feedback">反馈方式</label>
              <select id="contest-feedback" value={feedback} onChange={(e) => { markDirty(); setFeedback(e.target.value as Feedback); setTemplate('custom') }}>
                <option value="realtime">实时：提交后立即看到评测结果与排行榜</option>
                <option value="blind">盲评：比赛进行中隐藏结果与排行榜，赛后统一可见</option>
              </select>
              <p className="field-hint">盲评与封榜不同：盲评隐藏"结果"，封榜只冻结"榜单"。</p>
            </div>
          </div>

          <div className="toolbar toolbar-plain">
            {usesPenalty ? (
              <div className="form-group">
                <label htmlFor="contest-penalty">罚时（分钟 / 每次错误提交）</label>
                <input
                  id="contest-penalty"
                  type="number"
                  min={0}
                  max={600}
                  value={penaltyMinutes}
                  onChange={(e) => { markDirty(); setPenaltyMinutes(e.target.value) }}
                />
                <p className="field-hint">
                  {isCFEngine
                    ? 'Codeforces 惯例为 10 分钟：罚时 = 通过该题用时 + 通过前错误提交次数 × 10。'
                    : '仅统计"最终通过"的题目上的错误提交；未通过的题目不计罚时。'}
                </p>
              </div>
            ) : (
              <div className="form-group">
                <label htmlFor="contest-score-mode">计分粒度</label>
                <select id="contest-score-mode" value={scoreMode} onChange={(e) => { markDirty(); setScoreMode(e.target.value as ScoreMode) }}>
                  {(Object.keys(SCORE_MODE_LABELS) as ScoreMode[]).map((key) => (
                    <option key={key} value={key}>{SCORE_MODE_LABELS[key]}</option>
                  ))}
                </select>
                <p className="field-hint">按测试点部分计分时，选手可得部分分；整题通过才计分则只认全对。</p>
              </div>
            )}
          </div>
          {isCFEngine && (
            <>
              <p className="field-hint">
                CF 赛制：题目的「单题分值」即初始满分（可在下方「比赛题目」区设置，如 500 / 1000 / 1500），
                提交得分按提交时刻线性衰减，比赛结束时降到初始分的 30%。排名按总分降序，同分比罚时。
              </p>
              <div className="form-subsection">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={pretestOnly}
                    onChange={(e) => { markDirty(); setPretestOnly(e.target.checked) }}
                  />
                  <span>两阶段判定：比赛中只评测预测试点，赛后自动系统测试</span>
                </label>
                <p className="field-hint">
                  开启后比赛期间只跑「预测试」点（在题目测试点管理页勾选标记，未标记时默认用第 1 个点），
                  赛后评测机自动用完整数据重判全部提交，系统测试失败的提交会失去分数。
                </p>
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={hackingEnabled}
                    onChange={(e) => { markDirty(); setHackingEnabled(e.target.checked) }}
                  />
                  <span>开放 Hack：通过题目后可锁定并攻击他人提交</span>
                </label>
                <p className="field-hint">
                  锁定后不能再向该题提交，但可查看他人该题的通过代码并发起 Hack。
                  成功 +100 分、失败 −50 分；被 Hack 的提交判定降级、分数作废。
                </p>
              </div>
            </>
          )}
        </section>

        {/* ---------- ③ 时间安排 ---------- */}
        <section className="form-section">
          <div className="section-head">
            <h2 className="section-title">③ 时间安排</h2>
            <span className="section-hint">结束时刻起不再接受提交；报名时间默认跟随比赛时间窗。</span>
          </div>
          <p className="section-hint">
            比赛时间窗为 <code>[开始, 结束)</code>。
          </p>

          <div className="toolbar toolbar-plain">
            <div className="field">
              <div className="datetime-picker-row">
                <label htmlFor="contest-start-date" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <span className="field-label">比赛开始 · 日期</span>
                  <input
                    id="contest-start-date"
                    type="date"
                    value={startTime.slice(0, 10)}
                    onChange={(e) => { markDirty(); setStartTime(`${e.target.value}T${startTime.slice(11, 16) || '00:00'}`) }}
                  />
                </label>
                <label htmlFor="contest-start-time" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <span className="field-label">比赛开始 · 时间</span>
                  <input
                    id="contest-start-time"
                    type="time"
                    value={startTime.slice(11, 16)}
                    onChange={(e) => { markDirty(); setStartTime(`${startTime.slice(0, 10)}T${e.target.value}`) }}
                  />
                </label>
              </div>
              {errorOf('contest-start-date') && <p className="field-error">{errorOf('contest-start-date')}</p>}
            </div>
            <div className="field">
              <div className="datetime-picker-row">
                <label htmlFor="contest-end-date" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <span className="field-label">比赛结束 · 日期</span>
                  <input
                    id="contest-end-date"
                    type="date"
                    value={endTime.slice(0, 10)}
                    onChange={(e) => { markDirty(); setEndTime(`${e.target.value}T${endTime.slice(11, 16) || '00:00'}`) }}
                  />
                </label>
                <label htmlFor="contest-end-time" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                  <span className="field-label">比赛结束 · 时间</span>
                  <input
                    id="contest-end-time"
                    type="time"
                    value={endTime.slice(11, 16)}
                    onChange={(e) => { markDirty(); setEndTime(`${endTime.slice(0, 10)}T${e.target.value}`) }}
                  />
                </label>
              </div>
              {errorOf('contest-end-date') && <p className="field-error">{errorOf('contest-end-date')}</p>}
            </div>
          </div>
          <p className="field-hint">
            比赛时长：{durationMinutes !== null ? formatDuration(durationMinutes) : '（选择起止时间后显示）'}
          </p>

          <div className="form-subsection">
            <label className="check-row">
              <input
                id="contest-freeze-toggle"
                type="checkbox"
                checked={freezeEnabled && isACMEngine}
                disabled={!isACMEngine}
                onChange={(e) => { markDirty(); setFreezeEnabled(e.target.checked) }}
              />
              <span>启用封榜（比赛最后一段时间冻结榜单）</span>
            </label>
            {isACMEngine ? (
              <>
                <div className="field freeze-minutes">
                  <label htmlFor="contest-freeze">封榜时长（分钟）</label>
                  <input
                    id="contest-freeze"
                    type="number"
                    min={1}
                    max={720}
                    value={freezeMinutes}
                    disabled={!freezeEnabled}
                    onChange={(e) => { markDirty(); setFreezeMinutes(e.target.value) }}
                  />
                </div>
                <p className="field-hint">
                  封榜后新提交不再更新固定榜单（动态大屏会照常推进）；比赛结束后在动态榜单逐条揭晓。
                  {errorOf('contest-freeze') ? ` ${errorOf('contest-freeze')}` : ''}
                </p>
              </>
            ) : (
              <p className="field-hint">当前评分引擎不是 ACM，不支持封榜。若需要封榜猜榜效果，请把评分引擎切换为 ACM。</p>
            )}
            {errorOf('contest-freeze-toggle') && <p className="field-error">{errorOf('contest-freeze-toggle')}</p>}
          </div>

          <div className="form-subsection">
            <div className="form-group">
              <label htmlFor="contest-reg-window">报名时间窗</label>
              <select id="contest-reg-window" value={regWindowMode} onChange={(e) => { markDirty(); setRegWindowMode(e.target.value as 'follow' | 'custom') }}>
                <option value="follow">跟随比赛时间窗（开始即可报名，比赛结束截止）</option>
                <option value="custom">自定义报名时间</option>
              </select>
            </div>
            {regWindowMode === 'custom' && (
              <div className="toolbar toolbar-plain">
                <div className="field">
                  <div className="datetime-picker-row">
                    <label htmlFor="reg-start-date" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <span className="field-label">报名开始 · 日期</span>
                      <input
                        id="reg-start-date"
                        type="date"
                        value={regStart.slice(0, 10)}
                        onChange={(e) => { markDirty(); setRegStart(`${e.target.value}T${regStart.slice(11, 16) || '00:00'}`) }}
                      />
                    </label>
                    <label htmlFor="reg-start-time" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <span className="field-label">报名开始 · 时间</span>
                      <input
                        id="reg-start-time"
                        type="time"
                        value={regStart.slice(11, 16)}
                        onChange={(e) => { markDirty(); setRegStart(`${regStart.slice(0, 10)}T${e.target.value}`) }}
                      />
                    </label>
                  </div>
                  {errorOf('reg-start-date') && <p className="field-error">{errorOf('reg-start-date')}</p>}
                </div>
                <div className="field">
                  <div className="datetime-picker-row">
                    <label htmlFor="reg-end-date" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <span className="field-label">报名截止 · 日期</span>
                      <input
                        id="reg-end-date"
                        type="date"
                        value={regEnd.slice(0, 10)}
                        onChange={(e) => { markDirty(); setRegEnd(`${e.target.value}T${regEnd.slice(11, 16) || '00:00'}`) }}
                      />
                    </label>
                    <label htmlFor="reg-end-time" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                      <span className="field-label">报名截止 · 时间</span>
                      <input
                        id="reg-end-time"
                        type="time"
                        value={regEnd.slice(11, 16)}
                        onChange={(e) => { markDirty(); setRegEnd(`${regEnd.slice(0, 10)}T${e.target.value}`) }}
                      />
                    </label>
                  </div>
                  {errorOf('reg-end-date') && <p className="field-error">{errorOf('reg-end-date')}</p>}
                </div>
              </div>
            )}
            <p className="field-hint">报名时间可以与比赛时间不同：例如赛前一周开放报名、比赛开始后截止。</p>
          </div>
        </section>

        {/* ---------- ④ 参赛与提交 ---------- */}
        <section className="form-section">
          <div className="section-head">
            <h2 className="section-title">④ 参赛与提交</h2>
            <span className="section-hint">报名方式与提交次数限制；单题的上限与分值可在下方「比赛题目」区单独覆盖。</span>
          </div>

          <div className="toolbar toolbar-plain">
            <div className="form-group">
              <label htmlFor="contest-registration-mode">报名方式</label>
              <select
                id="contest-registration-mode"
                value={registrationMode}
                onChange={(e) => { markDirty(); setRegistrationMode(e.target.value as typeof registrationMode) }}
              >
                <option value="both">个人或队伍报名</option>
                <option value="individual">仅允许个人报名</option>
                <option value="team">仅允许队伍报名</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="contest-max-team-size">队伍人数上限</label>
              <input
                id="contest-max-team-size"
                type="number"
                min={1}
                max={20}
                value={registrationMode === 'individual' ? 1 : maxTeamSize}
                disabled={registrationMode === 'individual'}
                onChange={(e) => { markDirty(); setMaxTeamSize(e.target.value) }}
              />
            </div>
            <div className="form-group">
              <label htmlFor="contest-default-limit">默认单题提交上限</label>
              <input
                id="contest-default-limit"
                type="number"
                min={0}
                max={1000}
                value={submissionLimit}
                onChange={(e) => { markDirty(); setSubmissionLimit(e.target.value) }}
              />
              <p className="field-hint">0 = 不限。可按题覆盖。</p>
            </div>
          </div>

          <label className="check-row">
            <input type="checkbox" checked={allowTeamEdit} onChange={(e) => { markDirty(); setAllowTeamEdit(e.target.checked) }} />
            <span>报名截止前允许队长调整队伍成员</span>
          </label>
        </section>

        {/* ---------- ⑤ 榜单与展示 ---------- */}
        <section className="form-section">
          <div className="section-head">
            <h2 className="section-title">⑤ 榜单与展示</h2>
            <span className="section-hint">只影响榜单/大屏的呈现方式，不改变判定与计分。</span>
          </div>

          <div className="toolbar toolbar-plain">
            <div className="form-group">
              <label htmlFor="contest-dynamic-delay">动态大屏延迟开启（分钟）</label>
              <input
                id="contest-dynamic-delay"
                type="number"
                min={0}
                max={720}
                value={dynamicDelayMinutes}
                disabled={!isACMEngine}
                onChange={(e) => { markDirty(); setDynamicDelayMinutes(e.target.value) }}
              />
              <p className="field-hint">
                0 = 按比赛时长的 20% 自动开启。动态大屏用于现场投影（滚动揭晓），不影响固定榜单。
                {!isACMEngine && ' 仅 ACM 赛制可用。'}
              </p>
            </div>
            <div className="form-group">
              <label htmlFor="contest-rank-keys">排名附加关键字（可选）</label>
              <input
                id="contest-rank-keys"
                type="text"
                value={rankKeys}
                onChange={(e) => { markDirty(); setRankKeys(e.target.value) }}
                placeholder="如：打星, 出题人"
              />
              <p className="field-hint">
                名称包含这些关键字的队伍会排在最前面，用于打星队或出题人自测队；普通比赛留空。
              </p>
            </div>
          </div>
        </section>

        {/* ---------- 保存 ---------- */}
        <div className="form-submit-bar">
          {error && <div className="error-message">{error}</div>}
          {savedNotice && <div className="success-message" role="status">{savedNotice}</div>}
          <div className="toolbar toolbar-plain">
            <button type="submit" className="button button-primary" disabled={busy}>
              {busy ? '保存中…' : isEdit ? '保存设置' : '创建比赛'}
            </button>
            <button type="button" className="button button-secondary" onClick={() => navigate(-1)}>取消</button>
            {isEdit && dirty && <span className="section-hint">有未保存的修改（比赛题目不受影响）</span>}
            {fieldErrors.length > 0 && (
              <button type="button" className="button button-ghost button-sm" onClick={() => focusFirstError(fieldErrors)}>
                定位第 1 处问题
              </button>
            )}
          </div>
        </div>
      </form>

      {isEdit && (
        <div className="contest-problems-section">
          <div className="warning-message">
            以下题目操作<b>即时生效</b>（无需点击上方「保存设置」）：添加/移除、题号、分值、提交上限、主题色与顺序都会立刻写入比赛。
          </div>
          <ProblemManager
            contestId={contestId}
            problems={contestProblems}
            onChanged={reloadContestProblems}
          />
        </div>
      )}
    </div>
  )
}
