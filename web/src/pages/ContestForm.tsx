import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createContest, extractError, getContest, updateContest } from '../api'
import type { ContestInput, ContestMode } from '../types'
import { fromLocalInput, toLocalInput } from '../utils/contest'

/** 赛制模板：三个预置 + 自定义并列 */
type Template = 'acm' | 'oi' | 'ioi' | 'custom'

const TEMPLATES: { key: Template; label: string; desc: string }[] = [
  { key: 'acm', label: 'ACM', desc: '按通过题数排名，罚时 = 分钟 + 错误次数 × 罚时' },
  { key: 'oi', label: 'OI', desc: '按总分排名，每道题取最后一次提交得分' },
  { key: 'ioi', label: 'IOI', desc: '按总分排名，每道题取各次提交最优得分' },
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

  const applyTemplate = (t: Template) => {
    setTemplate(t)
    switch (t) {
      case 'acm':
        setEngine('ACM')
        setScoreMode('all_or_nothing')
        setPenaltyMinutes((p) => p || '20')
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
    }
    setBusy(true)
    setError('')
    try {
      if (isEdit) {
        await updateContest(contestId, payload)
        navigate(`/contest/${contestId}`)
      } else {
        const c = await createContest(payload)
        navigate(`/contest/${c.id}`)
      }
    } catch (err) {
      setError(extractError(err))
      setBusy(false)
    }
  }

  if (loading) return <div className="page-loading">加载中…</div>

  return (
    <div className="form-page">
      <h1 className="page-title">{isEdit ? '编辑比赛' : '新建比赛'}</h1>
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
              ? '封榜后（比赛最后 N 分钟）新提交不再更新排行榜，比赛结束后可滚榜解冻揭晓。'
              : '封榜仅 ACM 赛制支持（OI/IOI 为按分数排名，无封榜概念）。'}
          </p>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="contest-start">开始时间</label>
            <input
              id="contest-start"
              type="datetime-local"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
            />
          </div>
          <div className="form-group">
            <label htmlFor="contest-end">结束时间</label>
            <input
              id="contest-end"
              type="datetime-local"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
            />
          </div>
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
    </div>
  )
}
