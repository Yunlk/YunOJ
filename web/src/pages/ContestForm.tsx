import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { createContest, extractError, getContest, updateContest } from '../api'
import type { ContestInput } from '../types'
import { fromLocalInput, toLocalInput } from '../utils/contest'

export default function ContestForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const contestId = Number(id)

  const [title, setTitle] = useState('')
  const [mode, setMode] = useState<'acm' | 'oi' | 'ioi'>('acm')
  const [feedback, setFeedback] = useState<'visible' | 'blind'>('visible')
  const [scoreMode, setScoreMode] = useState<'last' | 'best'>('last')
  const [penaltyMinutes, setPenaltyMinutes] = useState('20')
  const [freezeMinutes, setFreezeMinutes] = useState('0')
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
        setMode(c.mode)
        setFeedback(c.feedback)
        setScoreMode(c.score_mode)
        setPenaltyMinutes(String(c.penalty_minutes))
        setFreezeMinutes(String(c.freeze_duration_minutes))
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
    const payload: ContestInput = {
      title: title.trim(),
      mode,
      feedback,
      score_mode: scoreMode,
      penalty_minutes: Math.max(0, Number(penaltyMinutes) || 0),
      freeze_duration_minutes: Math.max(0, Number(freezeMinutes) || 0),
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

        <div className="form-row">
          <div className="form-group">
            <label htmlFor="contest-mode">赛制</label>
            <select id="contest-mode" value={mode} onChange={(e) => setMode(e.target.value as typeof mode)}>
              <option value="acm">ACM（按通过数排名，罚时=分钟+错误次数×罚时）</option>
              <option value="oi">OI（按总分排名，每道题取最后一次提交得分）</option>
              <option value="ioi">IOI（按总分排名，每道题取各次提交最优得分）</option>
            </select>
          </div>
          <div className="form-group">
            <label htmlFor="contest-feedback">反馈方式</label>
            <select
              id="contest-feedback"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value as typeof feedback)}
            >
              <option value="visible">实时（提交后立即看到评测结果）</option>
              <option value="blind">盲评（比赛进行中隐藏评测结果与排行榜）</option>
            </select>
          </div>
        </div>

        <div className="form-row">
          {mode !== 'acm' && (
            <div className="form-group">
              <label htmlFor="contest-score-mode">OI 计分</label>
              <select
                id="contest-score-mode"
                value={scoreMode}
                onChange={(e) => setScoreMode(e.target.value as typeof scoreMode)}
              >
                <option value="last">取最后一次提交</option>
                <option value="best">取最优一次提交</option>
              </select>
            </div>
          )}
          {mode === 'acm' && (
            <>
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
              <div className="form-group">
                <label htmlFor="contest-freeze">封榜时长（分钟，0=不封榜）</label>
                <input
                  id="contest-freeze"
                  type="number"
                  min={0}
                  value={freezeMinutes}
                  onChange={(e) => setFreezeMinutes(e.target.value)}
                />
              </div>
            </>
          )}
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

        <div className="form-group">
          <label htmlFor="contest-rank-keys">排名附加关键字</label>
          <input
            id="contest-rank-keys"
            type="text"
            value={rankKeys}
            onChange={(e) => setRankKeys(e.target.value)}
            placeholder="队伍名包含这些关键词的排在最前，逗号分隔（可留空）"
          />
        </div>

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
