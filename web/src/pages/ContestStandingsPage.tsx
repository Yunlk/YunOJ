import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addContestProblem, extractError, getContest, getContestStandings, getProblems,
  removeContestProblem, reorderContestProblems, updateContestProblem,
} from '../api'
import RollBoardPlayer from '../components/RollBoardPlayer'
import type {
  ACMProblemState, ACMStanding, ContestDetail as ContestDetailData, ContestProblem, ContestStandings, OIStanding, ProblemListItem,
} from '../types'
import { minutesSinceStart, teamAvatarUrl } from '../utils/contest'
import { formatTime } from '../utils/format'

function TeamAvatar({ contestId, teamId, avatar, size }: {
  contestId: number; teamId: number; avatar: string; size: 'sm' | 'lg'
}) {
  const url = teamAvatarUrl(contestId, teamId, avatar)
  const cls = size === 'lg' ? 'avatar-lg' : 'avatar-sm'
  if (!url) return <span className={`${cls} avatar-fallback`}>?</span>
  return <img src={url} alt="" className={cls} />
}

// ---------- 排行榜 ----------

// ICPC 风格题目格：未提交无底色；WA 红色（-N）；AC 绿色（✓ 分钟）；
// 一血深绿底色白字（★ 分钟）。仅在 AC 时改变排名（引擎语义），
// 未通过尝试以红色负计数显示，不影响排名。
function ACMCell({ state, startTime }: { state: ACMProblemState | undefined; startTime: string }) {
  if (!state || (!state.solved && state.failed_attempts === 0)) {
    return <td className="standings-cell" />
  }
  if (state.solved) {
    const mins = state.solved_at ? minutesSinceStart(state.solved_at, startTime) : null
    if (state.first_blood) {
      return (
        <td className="standings-cell fb-cell" title="一血！全场第一个通过">
          ★ {mins ?? ''}
        </td>
      )
    }
    return (
      <td className="standings-cell ac-cell" title={`通过于第 ${mins ?? '?'} 分钟`}>
        ✓ {mins ?? ''}
      </td>
    )
  }
  return (
    <td className="standings-cell wa-cell" title={`${state.failed_attempts} 次未通过尝试`}>
      -{state.failed_attempts}
    </td>
  )
}

function ACMTable({ contestId, standings, problems, startTime }: {
  contestId: number
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
              <th key={p.problem_id} title={p.title} style={{ width: 78 }}>{p.display_id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 ? (
            <tr><td colSpan={4 + problems.length} className="table-empty">暂无队伍</td></tr>
          ) : (
            standings.map((s) => (
              <tr key={s.team_id}>
                <td className="mono">{s.rank}</td>
                <td>
                  <span className="standings-team">
                    <TeamAvatar contestId={contestId} teamId={s.team_id} avatar={s.avatar} size="sm" />
                    <span>{s.team_name}</span>
                  </span>
                </td>
                <td className="mono">{s.solved}</td>
                <td className="mono">{s.penalty}</td>
                {problems.map((p) => (
                  <ACMCell key={p.problem_id} state={s.problems[p.display_id]} startTime={startTime} />
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function OITable({ contestId, standings, problems }: {
  contestId: number
  standings: OIStanding[]
  problems: ContestProblem[]
}) {
  return (
    <div className="standings-wrap">
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th style={{ width: 56 }}>#</th>
            <th>队伍</th>
            <th style={{ width: 90 }}>总分</th>
            {problems.map((p) => (
              <th key={p.problem_id} title={p.title} style={{ width: 90 }}>{p.display_id}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 ? (
            <tr><td colSpan={3 + problems.length} className="table-empty">暂无队伍</td></tr>
          ) : (
            standings.map((s) => (
              <tr key={s.team_id}>
                <td className="mono">{s.rank}</td>
                <td>
                  <span className="standings-team">
                    <TeamAvatar contestId={contestId} teamId={s.team_id} avatar={s.avatar} size="sm" />
                    <span>{s.team_name}</span>
                  </span>
                </td>
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

function StandingsPanel({ contestId }: { contestId: number }) {
  const [standings, setStandings] = useState<ContestStandings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    getContestStandings(contestId)
      .then((s) => {
        setStandings(s)
        // 比赛进行中且未封榜：保持 3 秒轮询，随提交实时更新
        const now = Date.now()
        const start = new Date(s.contest.start_time).getTime()
        const end = new Date(s.contest.end_time).getTime()
        const running = now >= start && now < end
        const frozen = Boolean(s.freeze_at)
        setLive(running && !frozen)
      })
      .catch((err) => setError(extractError(err)))
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [contestId])

  useEffect(() => {
    load()
  }, [load])

  // 比赛中每 3 秒静默刷新榜单（AC 后排名/格子即时变化；WA 显示红色 -N 不影响排名）
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => load(true), 3000)
    return () => window.clearInterval(t)
  }, [live, load])

  if (loading) return <div className="page-loading">排行榜加载中…</div>
  if (error && !standings) {
    return (
      <div className="card notice-card">
        <p>{error}</p>
        <button type="button" className="button button-secondary" onClick={() => load()}>重试</button>
      </div>
    )
  }
  if (!standings) return null

  const isACM = standings.mode === 'ACM'
  const frozen = Boolean(standings.freeze_at)

  return (
    <div>
      <div className="standings-toolbar">
        {live && <span className="live-indicator"><span className="live-dot" />榜单实时更新中</span>}
        {frozen && !live && <span className="muted">榜单已冻结</span>}
        <button type="button" className="link-button" onClick={() => load(true)}>刷新</button>
      </div>
      {isACM && frozen && (
        <div className="notice-card freeze-notice">
          已封榜（{formatTime(standings.freeze_at!)}）
          {standings.frozen_submissions !== undefined && standings.frozen_submissions > 0
            ? `：另有 ${standings.frozen_submissions} 条提交暂未公开`
            : ''}
        </div>
      )}
      {isACM ? (
        <ACMTable
          contestId={contestId}
          standings={standings.standings as ACMStanding[]}
          problems={standings.problems}
          startTime={standings.contest.start_time}
        />
      ) : (
        <OITable
          contestId={contestId}
          standings={standings.standings as OIStanding[]}
          problems={standings.problems}
        />
      )}
    </div>
  )
}

// ---------- 管理员题目管理（搜索选择器 + 拖拽排序 + 题号/分值/上限） ----------

function AdminProblemManager({ contestId, problems, onChanged }: {
  contestId: number
  problems: ContestProblem[]
  onChanged: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [candidates, setCandidates] = useState<ProblemListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const search = useCallback(() => {
    setSearching(true)
    getProblems({ page: 1, size: 12, keyword: keyword || undefined })
      .then((data) => setCandidates(data.items))
      .catch(() => {})
      .finally(() => setSearching(false))
  }, [keyword])

  const add = async (pid: number) => {
    setBusy(true)
    setError('')
    try {
      const maxOrder = problems.reduce((m, p) => Math.max(m, p.sort_order), 0)
      await addContestProblem(contestId, {
        problem_id: pid,
        display_id: String.fromCharCode(65 + problems.length), // A, B, C...
        sort_order: maxOrder + 1,
      })
      setCandidates((cs) => cs.filter((c) => c.id !== pid))
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (pid: number) => {
    if (!window.confirm('移除该题目？')) return
    setBusy(true)
    try {
      await removeContestProblem(contestId, pid)
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const update = async (pid: number, patch: { display_id?: string; score?: number | null; submission_limit?: number | null }) => {
    setBusy(true)
    setError('')
    try {
      const p = problems.find((x) => x.problem_id === pid)
      if (!p) return
      await updateContestProblem(contestId, pid, {
        display_id: patch.display_id ?? p.display_id,
        score: patch.score !== undefined ? patch.score : (p.score ?? null),
        submission_limit: patch.submission_limit !== undefined ? patch.submission_limit : (p.submission_limit ?? null),
      })
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const ids = problems.map((p) => p.problem_id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    setBusy(true)
    setError('')
    reorderContestProblems(contestId, ids)
      .then(onChanged)
      .catch((err) => setError(extractError(err)))
      .finally(() => setBusy(false))
  }

  return (
    <section className="contest-section">
      <div className="section-header">
        <h2>题目管理</h2>
        <span className="muted">仅管理员可见</span>
      </div>
      <div className="card">
        <form
          className="form-row admin-problem-form"
          onSubmit={(e: FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            search()
          }}
        >
          <div className="form-group" style={{ flex: 1 }}>
            <label htmlFor="cp-search">搜索题库添加题目</label>
            <input
              id="cp-search"
              type="text"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="按标题搜索…"
            />
          </div>
          <button type="submit" className="button button-secondary" disabled={searching}>
            {searching ? '搜索中…' : '搜索'}
          </button>
        </form>
        {candidates.length > 0 && (
          <div className="candidate-list">
            {candidates.map((p) => (
              <div key={p.id} className="candidate-item">
                <span className="mono">#{p.id}</span>
                <span className="candidate-title">{p.title}</span>
                <button type="button" className="link-button" disabled={busy} onClick={() => add(p.id)}>
                  添加
                </button>
              </div>
            ))}
          </div>
        )}
        {error && <div className="error-message">{error}</div>}

        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>顺序</th>
              <th style={{ width: 90 }}>题号</th>
              <th>标题</th>
              <th style={{ width: 110 }}>单题分值（空=默认）</th>
              <th style={{ width: 130 }}>单题上限（空=继承，0=不限）</th>
              <th style={{ width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {problems.length === 0 ? (
              <tr><td colSpan={6} className="table-empty">暂无题目，用上方搜索添加</td></tr>
            ) : (
              problems.map((p, i) => (
                <tr
                  key={p.problem_id}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null) reorder(dragIdx, i)
                    setDragIdx(null)
                  }}
                  style={{ cursor: 'grab' }}
                  title="拖拽排序"
                >
                  <td className="mono">{p.sort_order}</td>
                  <td>
                    <input
                      type="text"
                      defaultValue={p.display_id}
                      disabled={busy}
                      style={{ width: 70 }}
                      onBlur={(e) => {
                        const v = e.target.value.trim()
                        if (v && v !== p.display_id) update(p.problem_id, { display_id: v })
                      }}
                    />
                  </td>
                  <td>
                    <Link to={`/problem/${p.problem_id}`} className="problem-link">{p.title}</Link>
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={p.score ?? ''}
                      disabled={busy}
                      style={{ width: 80 }}
                      placeholder="默认"
                      onChange={(e) => update(p.problem_id, { score: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={1000}
                      value={p.submission_limit ?? ''}
                      disabled={busy}
                      style={{ width: 80 }}
                      placeholder="继承"
                      onChange={(e) => update(p.problem_id, { submission_limit: e.target.value === '' ? null : Number(e.target.value) })}
                    />
                  </td>
                  <td>
                    <button type="button" className="link-button danger" disabled={busy} onClick={() => remove(p.problem_id)}>
                      移除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

// ---------- 页面 ----------

export default function ContestStandingsPage() {
  const { id } = useParams()
  const contestId = Number(id)
  const [data, setData] = useState<ContestDetailData | null>(null)
  const [rollboardOpen, setRollboardOpen] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    getContest(contestId)
      .then(setData)
      .catch((err) => setError(extractError(err)))
  }, [contestId])

  useEffect(() => {
    reload()
  }, [reload])

  if (error) return <div className="error-message">{error}</div>
  if (!data) return <div className="page-loading">加载中…</div>

  const isAdmin = data.is_admin ?? false
  const mode = data.contest.mode

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">排行榜 · {data.contest.title}</h1>
        <div className="contest-badges">
          <Link to={`/contest/${contestId}`} className="button button-secondary">← 返回总览</Link>
          {isAdmin && mode === 'ACM' && (
            <button type="button" className="button button-primary" onClick={() => setRollboardOpen(true)}>
              滚榜
            </button>
          )}
        </div>
      </div>
      <StandingsPanel contestId={contestId} />
      {isAdmin && (
        <AdminProblemManager contestId={contestId} problems={data.problems} onChanged={reload} />
      )}
      {rollboardOpen && <RollBoardPlayer contestId={contestId} onClose={() => setRollboardOpen(false)} />}
    </div>
  )
}
