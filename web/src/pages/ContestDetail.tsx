import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  deleteContest, extractError, getContest, getContestOverview, registerContest, uploadContestAvatar,
} from '../api'
import Markdown from '../components/Markdown'
import { useAuth } from '../context/AuthContext'
import type { ContestDetail as ContestDetailData, ContestOverview, MyTeam, OverviewProblem } from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import {
  contestFeedbackLabel, contestModeLabel, contestPhase, phaseClass, phaseLabel, teamAvatarUrl,
} from '../utils/contest'
import { formatTime } from '../utils/format'

const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']

function AvatarPicker({ preview, onPick }: { preview: string; onPick: (f: File) => void }) {
  const inputId = `avatar-input-${Math.random().toString(36).slice(2, 8)}`
  return (
    <div className="avatar-picker">
      <label htmlFor={inputId} className="avatar-button" title="点击选择头像图片（JPG/PNG/GIF/WebP，≤2MB）">
        {preview ? <img src={preview} alt="头像预览" className="avatar-img" /> : <span className="avatar-placeholder">+</span>}
      </label>
      <input
        id={inputId}
        type="file"
        accept={AVATAR_TYPES.join(',')}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0]
          if (!f) return
          if (!AVATAR_TYPES.includes(f.type)) {
            window.alert('头像仅支持 JPG/PNG/GIF/WebP 图片')
            return
          }
          if (f.size > 2 * 1024 * 1024) {
            window.alert('头像不能超过 2MB')
            return
          }
          onPick(f)
        }}
      />
      <div className="avatar-picker-text">
        <div className="avatar-picker-title">队伍头像</div>
        <div className="muted">点击选择图片，将显示在动态排行榜上（可选）</div>
      </div>
    </div>
  )
}

function TeamAvatar({ contestId, teamId, avatar, size }: {
  contestId: number; teamId: number; avatar: string; size: 'sm' | 'lg'
}) {
  const url = teamAvatarUrl(contestId, teamId, avatar)
  const cls = size === 'lg' ? 'avatar-lg' : 'avatar-sm'
  if (!url) return <span className={`${cls} avatar-fallback`}>?</span>
  return <img src={url} alt="" className={cls} />
}

// ---------- 报名 ----------

function RegisterPanel({ contestId, defaultName, onRegistered }: {
  contestId: number; defaultName: string; onRegistered: () => void
}) {
  const [teamName, setTeamName] = useState(defaultName)
  const [avatarFile, setAvatarFile] = useState<File | null>(null)
  const [preview, setPreview] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!teamName.trim()) {
      setError('请填写队伍名')
      return
    }
    setBusy(true)
    setError('')
    try {
      await registerContest(contestId, teamName.trim())
      if (avatarFile) {
        try {
          await uploadContestAvatar(contestId, avatarFile)
        } catch {
          window.alert('报名成功，但头像上传失败，可在总览中重新上传')
        }
      }
      onRegistered()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      <form className="register-form" onSubmit={submit}>
        <AvatarPicker
          preview={preview}
          onPick={(f) => {
            setAvatarFile(f)
            setPreview(URL.createObjectURL(f))
          }}
        />
        <div className="form-group">
          <label htmlFor="team-name">队伍名</label>
          <input
            id="team-name"
            type="text"
            value={teamName}
            maxLength={64}
            onChange={(e) => setTeamName(e.target.value)}
            placeholder="你的队伍名（将显示在排行榜上）"
          />
        </div>
        {error && <div className="error-message">{error}</div>}
        <button type="submit" className="button button-primary" disabled={busy}>
          {busy ? '报名中…' : '报名'}
        </button>
      </form>
    </div>
  )
}

// ---------- 队伍信息（已报名） ----------

function TeamPanel({ contestId, teamId, team, onChanged }: {
  contestId: number; teamId: number; team: MyTeam; onChanged: () => void
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(teamAvatarUrl(contestId, teamId, team.avatar) ?? '')

  return (
    <div className="card team-panel">
      <div className="team-panel-info">
        <TeamAvatar contestId={contestId} teamId={teamId} avatar={team.avatar} size="lg" />
        <div>
          <div className="team-panel-name">{team.team_name}</div>
          <div className="muted">已报名参赛</div>
        </div>
      </div>
      <div className="team-panel-avatar">
        <AvatarPicker
          preview={preview}
          onPick={async (f) => {
            setBusy(true)
            setError('')
            setPreview(URL.createObjectURL(f))
            try {
              await uploadContestAvatar(contestId, f)
              onChanged()
            } catch (err) {
              setError(extractError(err))
            } finally {
              setBusy(false)
            }
          }}
        />
        <span className="muted">{busy ? '上传中…' : '点击左侧圆框更换头像'}</span>
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  )
}

// ---------- 总览内容 ----------

const MY_STATUS_LABELS: Record<string, string> = {
  untried: '未尝试',
  judging: '评测中',
  passed: '已通过',
  failed: '未通过',
}

function myStatusClass(s: string): string {
  if (s === 'passed') return 'ac-cell'
  if (s === 'failed') return 'wa-cell'
  if (s === 'judging') return 'phase-upcoming'
  return 'muted'
}

function acceptRate(attempted: number, accepted: number): string {
  if (attempted <= 0) return '-'
  return `${Math.round((accepted / attempted) * 100)}%`
}

function ContestOverviewContent({ contestId, isAdmin }: { contestId: number; isAdmin: boolean }) {
  const [overview, setOverview] = useState<ContestOverview | null>(null)
  const [error, setError] = useState('')
  const now = useClock(1000)

  useEffect(() => {
    let cancelled = false
    getContestOverview(contestId)
      .then((o) => {
        if (!cancelled) setOverview(o)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
    return () => {
      cancelled = true
    }
  }, [contestId])

  if (error) return <div className="error-message">{error}</div>
  if (!overview) return <div className="page-loading">总览加载中…</div>

  const { contest, problems } = overview
  const phase = contestPhase(contest, now)
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
  const total = Math.max(1, endMs - startMs)
  const progress = Math.min(100, Math.max(0, ((now - startMs) / total) * 100))
  const remainingMs = endMs - now
  const toStartMs = startMs - now

  return (
    <div>
      <div className="contest-status-bar">
        <div className="contest-status-main">
          <span className={`phase-badge ${phaseClass(phase)}`}>{phaseLabel(phase)}</span>
          {phase === 'upcoming' && (
            <span className="contest-countdown">距开始 {formatRemaining(toStartMs)}</span>
          )}
          {phase === 'running' && (
            <span className="contest-countdown danger">剩余 {formatRemaining(remainingMs)}</span>
          )}
          {phase === 'ended' && <span className="muted">已结束</span>}
        </div>
        <div className="contest-progress">
          <div className="contest-progress-fill" style={{ width: `${progress}%` }} />
        </div>
        <div className="contest-progress-labels muted">
          <span>{formatTime(contest.start_time)}</span>
          <span>{formatTime(contest.end_time)}</span>
        </div>
      </div>

      <div className="contest-nav">
        <span className="contest-nav-item active">总览</span>
        <Link className="contest-nav-item" to={`/contest/${contestId}/submissions`}>我的提交</Link>
        <Link className="contest-nav-item" to={`/contest/${contestId}/standings`}>排行榜</Link>
        {isAdmin && (
          <>
            <Link className="contest-nav-item" to={`/contest/${contestId}/edit`}>比赛设置</Link>
            <Link className="contest-nav-item" to={`/contest/${contestId}/standings`}>题目管理</Link>
          </>
        )}
      </div>

      {contest.description && (
        <div className="card contest-announcement">
          <Markdown>{contest.description}</Markdown>
        </div>
      )}

      <div className="overview-columns">
        <section className="contest-section overview-main">
          <div className="section-header"><h2>题目</h2></div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 80 }}>题号</th>
                <th>标题</th>
                <th style={{ width: 100 }}>我的状态</th>
                <th style={{ width: 90 }}>提交 / 通过</th>
                <th style={{ width: 90 }}>通过率</th>
              </tr>
            </thead>
            <tbody>
              {problems.length === 0 ? (
                <tr><td colSpan={5} className="table-empty">暂无题目</td></tr>
              ) : (
                problems.map((p: OverviewProblem) => (
                  <tr key={p.problem_id}>
                    <td className="mono">{p.display_id}</td>
                    <td>
                      <Link to={`/contest/${contestId}/problem/${p.problem_id}`} className="problem-link">
                        {p.title}
                      </Link>
                    </td>
                    <td>
                      <span className={myStatusClass(p.my_status)}>
                        {MY_STATUS_LABELS[p.my_status] ?? p.my_status}
                        {p.my_status === 'failed' && p.my_score > 0 && `（${p.my_score} 分）`}
                      </span>
                    </td>
                    <td className="mono">{p.accepted_users} / {p.attempted_users}</td>
                    <td className="mono">{acceptRate(p.attempted_users, p.accepted_users)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>

        <aside className="overview-side">
          {overview.my_summary && (
            <div className="card summary-card">
              <h3>我的成绩</h3>
              {!overview.my_summary.visible ? (
                <p className="muted">盲评进行中，成绩暂不可见</p>
              ) : contest.mode === 'ACM' ? (
                <div className="summary-numbers">
                  <div><span className="summary-num">{overview.my_summary.rank}</span><span className="muted">排名</span></div>
                  <div><span className="summary-num">{overview.my_summary.solved}</span><span className="muted">通过</span></div>
                  <div><span className="summary-num">{overview.my_summary.penalty}</span><span className="muted">罚时</span></div>
                </div>
              ) : (
                <div className="summary-numbers">
                  <div><span className="summary-num">{overview.my_summary.rank}</span><span className="muted">排名</span></div>
                  <div><span className="summary-num">{overview.my_summary.total_score}</span><span className="muted">总分</span></div>
                </div>
              )}
            </div>
          )}
          <div className="card summary-card">
            <h3>赛制</h3>
            <p>{contestModeLabel(contest.mode)} · {contestFeedbackLabel(contest.feedback)}反馈</p>
            <p className="muted">
              单题满分 {problems[0]?.score ?? 100} 分
              {problems[0]?.submission_limit ? ` · 单题最多 ${problems[0].submission_limit} 次提交` : ' · 提交次数不限'}
            </p>
          </div>
        </aside>
      </div>
    </div>
  )
}

// ---------- 页面入口 ----------

export default function ContestDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const contestId = Number(id)

  const [data, setData] = useState<ContestDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    getContest(contestId)
      .then(setData)
      .catch((err) => setError(extractError(err)))
  }, [contestId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getContest(contestId)
      .then((d) => {
        if (!cancelled) setData(d)
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
  }, [contestId])

  if (loading) return <div className="page-loading">加载中…</div>
  if (error) return <div className="error-message">{error}</div>
  if (!data) return <div className="error-message">比赛不存在</div>

  const { contest } = data
  const isAdmin = data.is_admin ?? false
  const registered = data.is_registered ?? false

  return (
    <div className="contest-page">
      <div className="page-header">
        <h1 className="page-title">{contest.title}</h1>
        <div className="contest-badges">
          <span className="tag-chip">{contestModeLabel(contest.mode)}</span>
          {contest.visibility === 'private' && <span className="tag-chip">私有</span>}
        </div>
        {isAdmin && (
          <div className="contest-admin-actions">
            <Link to={`/contest/${contest.id}/edit`} className="button button-secondary">编辑</Link>
            <button
              type="button"
              className="button button-danger"
              onClick={async () => {
                if (!window.confirm(`确定删除比赛「${contest.title}」？该操作不可恢复。`)) return
                try {
                  await deleteContest(contestId)
                  navigate('/contests')
                } catch (err) {
                  window.alert(extractError(err))
                }
              }}
            >
              删除
            </button>
          </div>
        )}
      </div>

      {registered || isAdmin ? (
        <>
          {registered && user && (
            <TeamPanel
              contestId={contest.id}
              teamId={user.id}
              team={data.my_team ?? { team_name: user.username, avatar: '' }}
              onChanged={reload}
            />
          )}
          <ContestOverviewContent contestId={contest.id} isAdmin={isAdmin} />
        </>
      ) : (
        <>
          <div className="card contest-meta">
            <div className="meta-item">
              <span className="field-label">开始时间</span>
              <span className="mono">{formatTime(contest.start_time)}</span>
            </div>
            <div className="meta-item">
              <span className="field-label">结束时间</span>
              <span className="mono">{formatTime(contest.end_time)}</span>
            </div>
            <div className="meta-item">
              <span className="field-label">赛制</span>
              <span>{contestModeLabel(contest.mode)}</span>
            </div>
            <div className="meta-item">
              <span className="field-label">反馈</span>
              <span>{contestFeedbackLabel(contest.feedback)}</span>
            </div>
          </div>
          {contest.description && (
            <div className="card contest-announcement">
              <Markdown>{contest.description}</Markdown>
            </div>
          )}
          <section className="contest-section">
            <div className="section-header"><h2>报名参赛</h2></div>
            {!user ? (
              <div className="card notice-card">
                请先 <Link to="/login">登录</Link> 后再报名参赛。
              </div>
            ) : (
              <RegisterPanel contestId={contest.id} defaultName={user.username} onRegistered={reload} />
            )}
          </section>
        </>
      )}
    </div>
  )
}
