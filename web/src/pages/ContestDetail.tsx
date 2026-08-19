import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  addContestProblem,
  deleteContest,
  extractError,
  getContest,
  getContestStandings,
  getLanguages,
  registerContest,
  removeContestProblem,
  submitToContest,
} from '../api'
import CodeEditor from '../components/CodeEditor'
import RollBoardPlayer from '../components/RollBoardPlayer'
import { useAuth } from '../context/AuthContext'
import type {
  ACMStanding,
  ContestDetail as ContestDetailData,
  ContestProblem,
  ContestStandings,
  Language,
  OIStanding,
} from '../types'
import {
  contestFeedbackLabel,
  contestModeLabel,
  contestPhase,
  minutesSinceStart,
  phaseClass,
  phaseLabel,
  scoreModeLabel,
} from '../utils/contest'
import { formatTime } from '../utils/format'

export default function ContestDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const contestId = Number(id)

  const [data, setData] = useState<ContestDetailData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rollboardOpen, setRollboardOpen] = useState(false)

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

  const reload = useCallback(() => {
    getContest(contestId)
      .then(setData)
      .catch(() => {})
  }, [contestId])

  if (loading) return <div className="page-loading">加载中…</div>
  if (error) return <div className="error-message">{error}</div>
  if (!data) return <div className="error-message">比赛不存在</div>

  const { contest, problems } = data
  const phase = contestPhase(contest)
  const isAdmin = data.is_admin ?? false

  const handleDelete = async () => {
    if (!window.confirm(`确定删除比赛「${contest.title}」？该操作不可恢复。`)) return
    try {
      await deleteContest(contestId)
      navigate('/contests')
    } catch (err) {
      window.alert(extractError(err))
    }
  }

  return (
    <div className="contest-page">
      <div className="page-header">
        <h1 className="page-title">{contest.title}</h1>
        <div className="contest-badges">
          <span className="tag-chip">{contestModeLabel(contest.mode)}</span>
          <span className={`phase-badge ${phaseClass(phase)}`}>{phaseLabel(phase)}</span>
        </div>
        {isAdmin && (
          <div className="contest-admin-actions">
            <Link to={`/contest/${contest.id}/edit`} className="button button-secondary">
              编辑
            </Link>
            <button type="button" className="button button-danger" onClick={handleDelete}>
              删除
            </button>
          </div>
        )}
      </div>

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
          <span className="field-label">反馈</span>
          <span>{contestFeedbackLabel(contest.feedback)}</span>
        </div>
        {contest.mode !== 'acm' && (
          <div className="meta-item">
            <span className="field-label">计分</span>
            <span>{scoreModeLabel(contest.score_mode)}</span>
          </div>
        )}
        {contest.mode === 'acm' && (
          <>
            <div className="meta-item">
              <span className="field-label">罚时</span>
              <span>{contest.penalty_minutes} 分钟</span>
            </div>
            <div className="meta-item">
              <span className="field-label">封榜</span>
              <span>{contest.freeze_duration_minutes > 0 ? `最后 ${contest.freeze_duration_minutes} 分钟` : '不封榜'}</span>
            </div>
          </>
        )}
      </div>

      <section className="contest-section">
        <div className="section-header">
          <h2>题目</h2>
        </div>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 90 }}>题号</th>
              <th>标题</th>
              {isAdmin && <th style={{ width: 80 }}>操作</th>}
            </tr>
          </thead>
          <tbody>
            {problems.length === 0 ? (
              <tr>
                <td colSpan={isAdmin ? 3 : 2} className="table-empty">
                  暂无题目
                </td>
              </tr>
            ) : (
              problems.map((p) => (
                <tr key={p.problem_id}>
                  <td className="mono">{p.display_id}</td>
                  <td>
                    <Link to={`/problem/${p.problem_id}`} className="problem-link">
                      {p.title}
                    </Link>
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        type="button"
                        className="link-button danger"
                        onClick={async () => {
                          if (!window.confirm(`移除题目 ${p.display_id}？`)) return
                          try {
                            await removeContestProblem(contestId, p.problem_id)
                            reload()
                          } catch (err) {
                            window.alert(extractError(err))
                          }
                        }}
                      >
                        移除
                      </button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      {isAdmin && <AdminProblemPanel contestId={contest.id} problems={problems} onChanged={reload} />}

      <section className="contest-section">
        <div className="section-header">
          <h2>参赛</h2>
        </div>
        {!user ? (
          <div className="card notice-card">
            请先 <Link to="/login">登录</Link> 后再报名参赛。
          </div>
        ) : data.is_registered ? (
          <SubmitPanel contestId={contest.id} problems={problems} phase={phase} />
        ) : (
          <RegisterPanel contestId={contest.id} defaultName={user.username} onRegistered={reload} />
        )}
      </section>

      <section className="contest-section">
        <div className="section-header">
          <h2>排行榜</h2>
          {isAdmin && contest.mode === 'acm' && (
            <button
              type="button"
              className="button button-primary"
              onClick={() => setRollboardOpen(true)}
            >
              滚榜
            </button>
          )}
        </div>
        <StandingsPanel contestId={contest.id} isAdmin={isAdmin} />
      </section>

      {rollboardOpen && <RollBoardPlayer contestId={contest.id} onClose={() => setRollboardOpen(false)} />}
    </div>
  )
}

// ---------- 报名 ----------

function RegisterPanel({
  contestId,
  defaultName,
  onRegistered,
}: {
  contestId: number
  defaultName: string
  onRegistered: () => void
}) {
  const [teamName, setTeamName] = useState(defaultName)
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

// ---------- 比赛提交 ----------

function SubmitPanel({
  contestId,
  problems,
  phase,
}: {
  contestId: number
  problems: ContestProblem[]
  phase: 'upcoming' | 'running' | 'ended'
}) {
  const [languages, setLanguages] = useState<Language[]>([])
  const [problemId, setProblemId] = useState<number>(problems[0]?.problem_id ?? 0)
  const [language, setLanguage] = useState('cpp')
  const [code, setCode] = useState('')
  const [optimize, setOptimize] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [lastId, setLastId] = useState<number | null>(null)

  useEffect(() => {
    getLanguages()
      .then(setLanguages)
      .catch(() => {})
  }, [])

  const submit = async () => {
    if (!problemId) {
      setError('请先选择题目')
      return
    }
    if (!code.trim()) {
      setError('代码不能为空')
      return
    }
    setBusy(true)
    setError('')
    setLastId(null)
    try {
      const res = await submitToContest(contestId, problemId, language, code, optimize)
      setLastId(res.id)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="card">
      {phase !== 'running' ? (
        <div className="notice-card">
          {phase === 'upcoming' ? '比赛尚未开始，开始后可在此提交。' : '比赛已结束，不再接受提交。'}
        </div>
      ) : (
        <>
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="submit-problem">题目</label>
              <select
                id="submit-problem"
                value={problemId}
                onChange={(e) => setProblemId(Number(e.target.value))}
              >
                {problems.map((p) => (
                  <option key={p.problem_id} value={p.problem_id}>
                    {p.display_id} — {p.title}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="submit-language">语言</label>
              <select id="submit-language" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {languages.map((l) => (
                  <option key={l.key} value={l.key}>
                    {l.name} ({l.version})
                  </option>
                ))}
              </select>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
              -O2
            </label>
          </div>
          <div className="contest-editor">
            <CodeEditor language={language} value={code} onChange={setCode} onCtrlEnter={submit} />
          </div>
          <div className="contest-submit-row">
            <button type="button" className="button button-primary" disabled={busy} onClick={submit}>
              {busy ? '提交中…' : '提交'}
            </button>
            <span className="muted">Ctrl/Cmd + Enter 快速提交</span>
          </div>
          {error && <div className="error-message">{error}</div>}
          {lastId !== null && (
            <div className="success-message">
              提交成功，<Link to={`/submission/${lastId}`}>查看提交 #{lastId}</Link>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ---------- 排行榜 ----------

function StandingsPanel({ contestId, isAdmin }: { contestId: number; isAdmin: boolean }) {
  const [standings, setStandings] = useState<ContestStandings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getContestStandings(contestId)
      .then(setStandings)
      .catch((err) => setError(extractError(err)))
      .finally(() => setLoading(false))
  }, [contestId])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <div className="page-loading">排行榜加载中…</div>
  if (error) {
    return (
      <div className="card notice-card">
        <p>{error}</p>
        <button type="button" className="button button-secondary" onClick={load}>
          重试
        </button>
      </div>
    )
  }
  if (!standings) return null

  const isACM = standings.mode === 'acm'
  const frozen = Boolean(standings.freeze_at)

  return (
    <div>
      {isACM && frozen && (
        <div className="notice-card freeze-notice">
          已封榜（{formatTime(standings.freeze_at!)}）
          {standings.frozen_submissions !== undefined && standings.frozen_submissions > 0
            ? `：另有 ${standings.frozen_submissions} 条提交暂未公开`
            : ''}
          {isAdmin && '，管理员可在上方使用滚榜功能'}
        </div>
      )}
      {isACM ? (
        <ACMTable standings={standings.standings as ACMStanding[]} problems={standings.problems} startTime={standings.contest.start_time} />
      ) : (
        <OITable standings={standings.standings as OIStanding[]} problems={standings.problems} />
      )}
    </div>
  )
}

function ACMTable({
  standings,
  problems,
  startTime,
}: {
  standings: ACMStanding[]
  problems: ContestProblem[]
  startTime: string
}) {
  return (
    <div className="standings-wrap">
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            <th>队伍</th>
            <th style={{ width: 70 }}>通过</th>
            <th style={{ width: 70 }}>罚时</th>
            {problems.map((p) => (
              <th key={p.problem_id} title={p.title} style={{ width: 72 }}>
                {p.display_id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 ? (
            <tr>
              <td colSpan={4 + problems.length} className="table-empty">
                暂无队伍
              </td>
            </tr>
          ) : (
            standings.map((s) => (
              <tr key={s.team_id}>
                <td className="mono">{s.rank}</td>
                <td>{s.team_name}</td>
                <td className="mono">{s.solved}</td>
                <td className="mono">{s.penalty}</td>
                {problems.map((p) => {
                  const ps = s.problems[p.display_id]
                  if (!ps) return <td key={p.problem_id} className="standings-cell" />
                  if (ps.solved) {
                    const mins = ps.solved_at ? minutesSinceStart(ps.solved_at, startTime) : null
                    return (
                      <td key={p.problem_id} className="standings-cell ac-cell">
                        {mins === null ? '✓' : `✓ ${mins}`}
                      </td>
                    )
                  }
                  if (ps.failed_attempts > 0) {
                    return (
                      <td key={p.problem_id} className="standings-cell wa-cell">
                        +{ps.failed_attempts}
                      </td>
                    )
                  }
                  return <td key={p.problem_id} className="standings-cell" />
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function OITable({ standings, problems }: { standings: OIStanding[]; problems: ContestProblem[] }) {
  return (
    <div className="standings-wrap">
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            <th>队伍</th>
            <th style={{ width: 90 }}>总分</th>
            {problems.map((p) => (
              <th key={p.problem_id} title={p.title} style={{ width: 90 }}>
                {p.display_id}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 ? (
            <tr>
              <td colSpan={3 + problems.length} className="table-empty">
                暂无队伍
              </td>
            </tr>
          ) : (
            standings.map((s) => (
              <tr key={s.team_id}>
                <td className="mono">{s.rank}</td>
                <td>{s.team_name}</td>
                <td className="mono standings-total">{s.total_score}</td>
                {problems.map((p) => {
                  const score = s.problem_scores[p.display_id]
                  const subs = s.problem_submissions[p.display_id]
                  if (score === undefined) return <td key={p.problem_id} className="standings-cell" />
                  return (
                    <td key={p.problem_id} className="standings-cell score-cell">
                      {score}
                      {subs > 0 && <span className="muted"> ({subs} 次)</span>}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

// ---------- 管理员：题目管理 ----------

function AdminProblemPanel({
  contestId,
  problems,
  onChanged,
}: {
  contestId: number
  problems: ContestProblem[]
  onChanged: () => void
}) {
  const [problemId, setProblemId] = useState('')
  const [displayId, setDisplayId] = useState('')
  const [sortOrder, setSortOrder] = useState(String(problems.length + 1))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const pid = Number(problemId)
    if (!Number.isInteger(pid) || pid <= 0) {
      setError('请输入有效的题目 ID')
      return
    }
    if (!displayId.trim()) {
      setError('请填写题号（如 A、B、P1）')
      return
    }
    setBusy(true)
    setError('')
    try {
      await addContestProblem(contestId, {
        problem_id: pid,
        display_id: displayId.trim(),
        sort_order: Number(sortOrder) || 0,
      })
      setProblemId('')
      setDisplayId('')
      setSortOrder(String(Number(sortOrder) + 1))
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="contest-section">
      <div className="section-header">
        <h2>题目管理</h2>
        <span className="muted">仅管理员可见</span>
      </div>
      <div className="card">
        <form className="form-row admin-problem-form" onSubmit={submit}>
          <div className="form-group">
            <label htmlFor="ap-problem-id">题目 ID</label>
            <input
              id="ap-problem-id"
              type="number"
              min={1}
              value={problemId}
              onChange={(e) => setProblemId(e.target.value)}
              placeholder="如 1"
            />
          </div>
          <div className="form-group">
            <label htmlFor="ap-display-id">题号</label>
            <input
              id="ap-display-id"
              type="text"
              value={displayId}
              onChange={(e) => setDisplayId(e.target.value)}
              placeholder="如 A"
            />
          </div>
          <div className="form-group">
            <label htmlFor="ap-sort">顺序</label>
            <input
              id="ap-sort"
              type="number"
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
            />
          </div>
          <button type="submit" className="button button-primary" disabled={busy}>
            {busy ? '添加中…' : '添加题目'}
          </button>
        </form>
        {error && <div className="error-message">{error}</div>}
      </div>
    </section>
  )
}
