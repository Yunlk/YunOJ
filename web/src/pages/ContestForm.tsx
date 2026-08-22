import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { contestCoverUrl, createContest, extractError, getContest, updateContest, uploadContestCover } from '../api'
import { ProblemManager } from './ContestProblemManagerPage'
import type { ContestInput, ContestMode, ContestProblem } from '../types'
import { fromLocalInput, toLocalInput } from '../utils/contest'

/** 赛制模板：三个预置 + 自定义并列 */
type Template = 'acm' | 'icpc' | 'oi' | 'ioi' | 'practice' | 'custom'

const TEMPLATES: { key: Template; label: string; desc: string }[] = [
  { key: 'acm', label: 'ACM 标准', desc: '按通过题数排名，罚时 = 分钟 + 错误次数 × 罚时' },
  { key: 'icpc', label: 'ICPC 滚榜', desc: 'ACM 规则，启用封榜并在赛后逐条揭晓' },
  { key: 'oi', label: 'OI', desc: '按总分排名，每道题取最后一次提交得分' },
  { key: 'ioi', label: 'IOI', desc: '按总分排名，每道题取各次提交最优得分' },
  { key: 'practice', label: '练习赛', desc: '实时反馈、无封榜、按总分统计，适合课堂练习' },
  { key: 'custom', label: '自定义', desc: '自由组合评分引擎与全部参数' },
]

const ENGINES: { key: ContestMode; label: string; desc: string }[] = [
  { key: 'ACM', label: 'ACM 罚时', desc: '通过题数 + 罚时排名' },
  { key: 'OI', label: 'OI 总分（取最后一次）', desc: '总分排名，每题取最后一次提交' },
  { key: 'IOI', label: 'IOI 总分（取最优）', desc: '总分排名，每题取最优一次提交' },
]

export default function ContestForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const contestId = Number(id)

  const [title, setTitle] = useState('')
  const [template, setTemplate] = useState<Template>('acm')
  const [engine, setEngine] = useState<ContestMode>('ACM')
  const [feedback, setFeedback] = useState<'realtime' | 'blind'>('realtime')
  const [scoreMode, setScoreMode] = useState<'all_or_nothing' | 'partial'>('all_or_nothing')
  const [penaltyMinutes, setPenaltyMinutes] = useState('20')
  const [freezeEnabled, setFreezeEnabled] = useState(false)
  const [freezeMinutes, setFreezeMinutes] = useState('60')
  const [rankKeys, setRankKeys] = useState('')
  const [startTime, setStartTime] = useState('')
  const [endTime, setEndTime] = useState('')
  const [description, setDescription] = useState('')
  const [coverFile, setCoverFile] = useState<File | null>(null)
  const [coverPreview, setCoverPreview] = useState('')
  const [visibility, setVisibility] = useState<'public' | 'private'>('public')
  const [regEnabled, setRegEnabled] = useState(false)
  const [regStart, setRegStart] = useState('')
  const [regEnd, setRegEnd] = useState('')
  const [submissionLimit, setSubmissionLimit] = useState('0')
  const [registrationMode, setRegistrationMode] = useState<'individual' | 'team' | 'both'>('both')
  const [maxTeamSize, setMaxTeamSize] = useState('1')
  const [allowTeamEdit, setAllowTeamEdit] = useState(true)
  const [contestProblems, setContestProblems] = useState<ContestProblem[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isEdit) return
    let cancelled = false
    getContest(contestId)
      .then((data) => {
        if (cancelled) return
        const c = data.contest
        setTitle(c.title)
        setEngine(c.mode)
        setTemplate(c.mode.toLowerCase() as Template)
        setFeedback(c.feedback)
        setScoreMode(c.score_mode)
        setPenaltyMinutes(String(c.penalty_minutes))
        setFreezeEnabled(c.freeze_duration_minutes > 0)
        setFreezeMinutes(String(c.freeze_duration_minutes > 0 ? c.freeze_duration_minutes : 60))
        setRankKeys(c.rank_keys.join(', '))
        setStartTime(toLocalInput(c.start_time))
        setEndTime(toLocalInput(c.end_time))
        setDescription(c.description ?? '')
        setCoverPreview(contestCoverUrl(c.id, c.cover_image))
        setVisibility(c.visibility ?? 'public')
        setRegEnabled(Boolean(c.reg_start_time))
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

  const applyTemplate = (t: Template) => {
    setTemplate(t)
    switch (t) {
      case 'acm':
        setEngine('ACM')
        setScoreMode('all_or_nothing')
        setPenaltyMinutes((p) => p || '20')
        break
      case 'icpc':
        setEngine('ACM')
        setFeedback('realtime')
        setScoreMode('all_or_nothing')
        setFreezeEnabled(true)
        setPenaltyMinutes('20')
        break
      case 'oi':
        setEngine('OI')
        setScoreMode('partial')
        setFreezeEnabled(false)
        break
      case 'ioi':
        setEngine('IOI')
        setScoreMode('partial')
        setFreezeEnabled(false)
        break
      case 'practice':
        setEngine('IOI')
        setFeedback('realtime')
        setScoreMode('partial')
        setFreezeEnabled(false)
        setSubmissionLimit('0')
        break
      case 'custom':
        // 保留当前所有参数，仅切换为手动配置
        break
    }
  }

  const isACMEngine = engine === 'ACM'
  const freezeMinutesNum = Math.max(0, Number(freezeMinutes) || 0)
  const effectiveFreeze = freezeEnabled && isACMEngine ? freezeMinutesNum : 0

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!title.trim()) {
      setError('请填写比赛标题')
      return
    }
    if (!startTime || !endTime) {
      setError('请填写开始与结束时间')
      return
    }
    const start = new Date(startTime).getTime()
    const end = new Date(endTime).getTime()
    if (Number.isNaN(start) || Number.isNaN(end) || end <= start) {
      setError('结束时间必须晚于开始时间')
      return
    }
    if (freezeEnabled && freezeMinutesNum <= 0) {
      setError('封榜时长需大于 0 分钟')
      return
    }
    // 比赛已开始后修改关键配置：明确风险提示
    if (isEdit && Date.now() >= start) {
      const risk = [
        '比赛已经开始，修改计分/罚时/题目或时间会影响已产生的排行榜与提交判定',
        '已封榜的比赛修改配置可能导致动态揭晓数据与榜单不一致',
      ].join('\n')
      if (!window.confirm(`${risk}\n\n确定继续保存？`)) {
        setBusy(false)
        return
      }
    }
    const payload: ContestInput = {
      title: title.trim(),
      mode: engine,
      feedback,
      score_mode: scoreMode,
      penalty_minutes: Math.max(0, Number(penaltyMinutes) || 0),
      freeze_duration_minutes: effectiveFreeze,
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
      ...(regEnabled && regStart && regEnd
        ? { reg_start_time: fromLocalInput(regStart), reg_end_time: fromLocalInput(regEnd) }
        : {}),
    }
    setBusy(true)
    setError('')
    try {
      if (isEdit) {
        await updateContest(contestId, payload)
        if (coverFile) await uploadContestCover(contestId, coverFile)
        navigate(`/contest/${contestId}`)
      } else {
        const c = await createContest(payload)
        if (coverFile) await uploadContestCover(c.id, coverFile)
        navigate(`/contest/${c.id}`)
      }
    } catch (err) {
      setError(extractError(err))
      setBusy(false)
    }
  }

  if (loading) return <div className="page-loading">加载中…</div>

  return (
    <div className="form-page contest-manage-page">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">比赛管理</div>
          <h1 className="page-title">{isEdit ? '比赛设置' : '新建比赛'}</h1>
        </div>
        {isEdit && (
          <div className="contest-badges">
            <Link to={`/contest/${contestId}/messages`} className="button button-secondary">消息管理</Link>
            <Link to={`/contest/${contestId}`} className="button button-secondary">返回比赛总览</Link>
          </div>
        )}
      </div>
      {isEdit && (
        <div className="contest-nav contest-manage-nav">
          <span className="contest-nav-item active">比赛设置与题目</span>
          <Link className="contest-nav-item" to={`/contest/${contestId}/messages`}>消息管理</Link>
        </div>
      )}
      <form className="card form-card" onSubmit={submit}>
        <div className="form-group">
          <label htmlFor="contest-title">标题</label>
          <input
            id="contest-title"
            type="text"
            value={title}
            maxLength={128}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="比赛标题"
          />
        </div>

        <div className="contest-cover-editor">
          <div className="form-group">
            <label htmlFor="contest-cover">比赛封面</label>
            <input id="contest-cover" type="file" accept="image/jpeg,image/png,image/gif,image/webp" onChange={(event) => {
              const file = event.target.files?.[0]
              if (!file) return
              if (file.size > 8 * 1024 * 1024) { setError('封面不能超过 8MB'); return }
              setCoverFile(file)
              setCoverPreview(URL.createObjectURL(file))
            }} />
            <p className="field-hint">支持 JPG、PNG、GIF、WebP，最大 8MB。</p>
          </div>
          {coverPreview && <img className="contest-cover-preview" src={coverPreview} alt="比赛封面预览" />}
        </div>

        <div className="form-group">
          <label>赛制模板</label>
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
              </button>
            ))}
          </div>
        </div>

        {template === 'custom' && (
          <div className="form-group">
            <label htmlFor="contest-engine">评分引擎</label>
            <select
              id="contest-engine"
              value={engine}
              onChange={(e) => setEngine(e.target.value as ContestMode)}
            >
              {ENGINES.map((en) => (
                <option key={en.key} value={en.key}>
                  {en.label}
                </option>
              ))}
            </select>
            <p className="field-hint">自定义模式需要选择一个底层评分引擎（排行榜按该引擎计算）。</p>
          </div>
        )}

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="contest-feedback">反馈方式</label>
            <select
              id="contest-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value as typeof feedback)}
            >
              <option value="realtime">实时（提交后立即看到评测结果与排行榜）</option>
              <option value="blind">盲评（比赛进行中隐藏评测结果与排行榜）</option>
            </select>
          </div>
          {isACMEngine && (
            <div className="form-group">
              <label htmlFor="contest-penalty">罚时（分钟/次错误提交）</label>
              <input
                id="contest-penalty"
                type="number"
                min={0}
                value={penaltyMinutes}
                onChange={(e) => setPenaltyMinutes(e.target.value)}
              />
            </div>
          )}
        </div>

        <div className="freeze-block">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={freezeEnabled}
              disabled={!isACMEngine}
              onChange={(e) => setFreezeEnabled(e.target.checked)}
            />
            <span>启用封榜</span>
          </label>
          <div className="form-group">
            <label htmlFor="contest-freeze">封榜时长（分钟）</label>
            <input
              id="contest-freeze"
              type="number"
              min={1}
              value={freezeMinutes}
              disabled={!freezeEnabled || !isACMEngine}
              onChange={(e) => setFreezeMinutes(e.target.value)}
            />
          </div>
          <p className="field-hint">
            {isACMEngine
              ? '封榜后（比赛最后 N 分钟）新提交不再更新排行榜，比赛结束后会在动态排行榜中逐条揭晓。'
              : '封榜仅 ACM 赛制支持（OI/IOI 为按分数排名，无封榜概念）。'}
          </p>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="contest-start">开始时间</label>
            <div className="datetime-picker-row"><input id="contest-start-date" type="date" value={startTime.slice(0, 10)} onChange={(e) => setStartTime(`${e.target.value}T${startTime.slice(11, 16) || '00:00'}`)} /><input id="contest-start-time" type="time" value={startTime.slice(11, 16)} onChange={(e) => setStartTime(`${startTime.slice(0, 10)}T${e.target.value}`)} /></div>
          </div>
          <div className="form-group">
            <label htmlFor="contest-end">结束时间</label>
            <div className="datetime-picker-row"><input id="contest-end-date" type="date" value={endTime.slice(0, 10)} onChange={(e) => setEndTime(`${e.target.value}T${endTime.slice(11, 16) || '00:00'}`)} /><input id="contest-end-time" type="time" value={endTime.slice(11, 16)} onChange={(e) => setEndTime(`${endTime.slice(0, 10)}T${e.target.value}`)} /></div>
          </div>
        </div>

        <div className="form-group">
          <label htmlFor="contest-desc">比赛说明 / 公告（Markdown，显示在总览顶部）</label>
          <textarea
            id="contest-desc"
            className="markdown-editor small"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="比赛规则、注意事项、公告…"
          />
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="contest-visibility">可见性</label>
            <select
              id="contest-visibility"
              value={visibility}
              onChange={(e) => setVisibility(e.target.value as 'public' | 'private')}
            >
              <option value="public">公开（出现在比赛列表）</option>
              <option value="private">私有（仅管理员与已报名用户可见）</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="contest-default-limit">默认单题提交上限（0 = 不限）</label>
            <input
              id="contest-default-limit"
              type="number"
              min={0}
              max={1000}
              value={submissionLimit}
              onChange={(e) => setSubmissionLimit(e.target.value)}
            />
            <p className="field-hint">单题分值和提交上限可在本页下方的比赛题目区单独覆盖。</p>
          </div>
        </div>

        <div className="freeze-block">
          <label className="checkbox-label">
            <input type="checkbox" checked={regEnabled} onChange={(e) => setRegEnabled(e.target.checked)} />
            <span>设置独立报名时间窗</span>
          </label>
          {regEnabled && (
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="reg-start">报名开始</label>
                <div className="datetime-picker-row"><input id="reg-start" type="date" value={regStart.slice(0, 10)} onChange={(e) => setRegStart(`${e.target.value}T${regStart.slice(11, 16) || '00:00'}`)} /><input id="reg-start-time" type="time" value={regStart.slice(11, 16)} onChange={(e) => setRegStart(`${regStart.slice(0, 10)}T${e.target.value}`)} /></div>
              </div>
              <div className="form-group">
                <label htmlFor="reg-end">报名截止</label>
                <div className="datetime-picker-row"><input id="reg-end" type="date" value={regEnd.slice(0, 10)} onChange={(e) => setRegEnd(`${e.target.value}T${regEnd.slice(11, 16) || '00:00'}`)} /><input id="reg-end-time" type="time" value={regEnd.slice(11, 16)} onChange={(e) => setRegEnd(`${regEnd.slice(0, 10)}T${e.target.value}`)} /></div>
              </div>
            </div>
          )}
          <p className="field-hint">未设置时报名时间窗随比赛时间窗。</p>
        </div>

        <div className="form-row contest-registration-settings">
          <div className="form-group">
            <label htmlFor="contest-registration-mode">报名方式</label>
            <select id="contest-registration-mode" value={registrationMode} onChange={(e) => setRegistrationMode(e.target.value as typeof registrationMode)}>
              <option value="both">个人或队伍报名</option>
              <option value="individual">仅允许个人报名</option>
              <option value="team">仅允许队伍报名</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="contest-max-team-size">队伍人数上限</label>
            <input id="contest-max-team-size" type="number" min={1} max={20} value={registrationMode === 'individual' ? 1 : maxTeamSize} disabled={registrationMode === 'individual'} onChange={(e) => setMaxTeamSize(e.target.value)} />
          </div>
          <label className="checkbox-label registration-edit-toggle"><input type="checkbox" checked={allowTeamEdit} onChange={(e) => setAllowTeamEdit(e.target.checked)} /><span>报名截止前允许队长调整成员</span></label>
        </div>

        <details className="advanced-section">
          <summary>高级选项</summary>
          <div className="form-group">
            <label htmlFor="contest-rank-keys">排名附加关键字</label>
            <input
              id="contest-rank-keys"
              type="text"
              value={rankKeys}
              onChange={(e) => setRankKeys(e.target.value)}
              placeholder="如：打星, 出题人"
            />
            <p className="field-hint">
              队伍名包含这些关键词的队伍会<b>固定排在最前面</b>（如"打星队"——不计入正式排名的选手、
              出题人自测队等），普通比赛留空即可。多个关键词用逗号分隔。
            </p>
          </div>
          {template === 'custom' && (
            <div className="form-group">
              <label htmlFor="contest-score-mode">计分粒度</label>
              <select
                id="contest-score-mode"
                value={scoreMode}
                onChange={(e) => setScoreMode(e.target.value as typeof scoreMode)}
              >
                <option value="all_or_nothing">整题通过才计分</option>
                <option value="partial">按测试点部分计分</option>
              </select>
            </div>
          )}
        </details>

        {error && <div className="error-message">{error}</div>}

        <div className="form-actions">
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? '保存中…' : isEdit ? '保存' : '创建'}
          </button>
          <button type="button" className="button button-secondary" onClick={() => navigate(-1)}>
            取消
          </button>
        </div>
      </form>
      {isEdit && (
        <ProblemManager
          contestId={contestId}
          problems={contestProblems}
          onChanged={reloadContestProblems}
        />
      )}
    </div>
  )
}
