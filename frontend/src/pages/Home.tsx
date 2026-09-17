import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { extractError, getHome, getProblemFacets, getProblems, getSubmissions } from '../api'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import type { Contest, HomeData, ProblemFacets, ProblemListItem, SubmissionListItem } from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import { contestModeLabel } from '../utils/contest'
import { getDifficulty } from '../utils/difficulty'
import { formatRunTime, formatTime } from '../utils/format'

type ContestPhase = 'active' | 'upcoming' | 'ended'

function contestPhase(contest: Contest, now: number): ContestPhase {
  if (now < new Date(contest.start_time).getTime()) return 'upcoming'
  if (now < new Date(contest.end_time).getTime()) return 'active'
  return 'ended'
}

const PHASE_LABEL: Record<ContestPhase, string> = {
  active: '进行中',
  upcoming: '即将开始',
  ended: '已结束',
}

/**
 * 首页 = 训练工作台：先回答「我现在该做什么」，再给进度与赛程。
 * 平台总量数据退到页面底部一行，不再占据首屏。
 */
export default function Home() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const now = useClock()
  const [data, setData] = useState<HomeData | null>(null)
  const [facets, setFacets] = useState<ProblemFacets | null>(null)
  const [recent, setRecent] = useState<SubmissionListItem[]>([])
  const [attempted, setAttempted] = useState<ProblemListItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getHome()
      .then((value) => {
        if (!cancelled) setData(value)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    getProblemFacets()
      .then((value) => {
        if (!cancelled) setFacets(value)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!user) {
      setRecent([])
      setAttempted([])
      return
    }
    let cancelled = false
    getSubmissions({ page: 1, size: 6, user_id: String(user.id) })
      .then((page) => {
        if (!cancelled) setRecent(page.items)
      })
      .catch(() => {})
    // 按最近提交排序：首页「继续上次的进度」要回到刚动过的那道题，而不是题号最小的
    getProblems({ page: 1, size: 5, my_status: 'attempted', sort: 'recent' })
      .then((page) => {
        if (!cancelled) setAttempted(page.items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [user])

  const contests = useMemo(() => {
    if (!data) return []
    const all = [...data.summary.active_contests, ...data.summary.upcoming_contests]
    return all
      .filter((c) => contestPhase(c, now) !== 'ended')
      .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
  }, [data, now])

  const runningContest = contests.find((c) => contestPhase(c, now) === 'active') ?? null
  const nextContest = contests.find((c) => contestPhase(c, now) === 'upcoming') ?? null
  const solved = facets?.solved ?? 0
  const total = facets?.total ?? 0

  const randomProblem = async () => {
    try {
      const first = await getProblems({ page: 1, size: 1 })
      if (first.total === 0) return
      const pick = Math.floor(Math.random() * first.total) + 1
      const target = await getProblems({ page: pick, size: 1 })
      if (target.items[0]) navigate(`/problem/${target.items[0].id}`)
    } catch (err) {
      setError(extractError(err))
    }
  }

  const continueProblem = () => {
    if (attempted[0]) navigate(`/problem/${attempted[0].id}`)
    else navigate('/problems?my_status=todo')
  }

  if (loading) return <div className="page-loading">首页加载中…</div>
  if (error || !data) return <div className="error-message">{error || '首页加载失败'}</div>

  const { summary } = data

  return (
    <div className="home">
      <PageHeader
        eyebrow="训练工作台"
        title={user ? `${user.username}，继续刷题` : '开始刷题'}
        description={
          user
            ? `已解决 ${solved} / ${total} 道题，保持节奏。`
            : '登录后可保存代码草稿、记录提交与进度。'
        }
        actions={
          <>
            <button type="button" className="button button-secondary" onClick={() => void randomProblem()}>
              随机一题
            </button>
            <Link to="/problems" className="button button-primary">
              进入题库
            </Link>
          </>
        }
      />

      <div className="home-grid">
        <div className="home-main">
          {user && (
            <section className="card home-continue">
              <div className="home-continue-text">
                <span className="home-continue-label">继续上次的进度</span>
                {attempted.length > 0 ? (
                  <>
                    <strong>P{attempted[0].id} {attempted[0].title}</strong>
                    <span className="home-continue-hint">
                      这道题你尝试过但还没通过 · 难度 {getDifficulty(attempted[0].difficulty).label}
                    </span>
                  </>
                ) : (
                  <>
                    <strong>还没有未完成的题目</strong>
                    <span className="home-continue-hint">从题库挑一道开始，或者随机来一题</span>
                  </>
                )}
              </div>
              <div className="home-continue-actions">
                <button type="button" className="button button-primary" onClick={continueProblem}>
                  {attempted.length > 0 ? '继续这题' : '去选题'}
                </button>
              </div>
            </section>
          )}

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">比赛</h2>
              <Link to="/contests" className="section-hint">
                全部比赛 →
              </Link>
            </div>
            {contests.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">暂无公开赛程</div>
                <p className="empty-state-hint">有新的比赛时会显示在这里。</p>
              </div>
            ) : (
              <div className="home-contests">
                {runningContest && (
                  <Link to={`/contest/${runningContest.id}`} className="home-contest home-contest-active">
                    <span className="home-contest-phase">进行中</span>
                    <strong>{runningContest.title}</strong>
                    <span className="home-contest-meta">
                      {contestModeLabel(runningContest.mode)} · 剩余 {formatRemaining(new Date(runningContest.end_time).getTime() - now)}
                    </span>
                  </Link>
                )}
                {nextContest && (
                  <Link to={`/contest/${nextContest.id}`} className="home-contest">
                    <span className="home-contest-phase upcoming">即将开始</span>
                    <strong>{nextContest.title}</strong>
                    <span className="home-contest-meta">
                      {contestModeLabel(nextContest.mode)} · {formatTime(nextContest.start_time)}
                    </span>
                  </Link>
                )}
                {contests
                  .filter((c) => c.id !== runningContest?.id && c.id !== nextContest?.id)
                  .slice(0, 3)
                  .map((c) => (
                    <Link to={`/contest/${c.id}`} className="home-contest" key={c.id}>
                      <span className={`home-contest-phase ${contestPhase(c, now)}`}>{PHASE_LABEL[contestPhase(c, now)]}</span>
                      <strong>{c.title}</strong>
                      <span className="home-contest-meta">
                        {contestModeLabel(c.mode)} · {formatTime(c.start_time)}
                      </span>
                    </Link>
                  ))}
              </div>
            )}
          </section>

          {user && (
            <section className="section">
              <div className="section-head">
                <h2 className="section-title">最近提交</h2>
                <Link to="/status" className="section-hint">
                  全部提交 →
                </Link>
              </div>
              {recent.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-title">还没有提交记录</div>
                  <p className="empty-state-hint">通过一题后，这里会记录你的每一次尝试。</p>
                  <Link to="/problems" className="button button-primary button-sm">
                    去题库
                  </Link>
                </div>
              ) : (
                <div className="table-frame">
                  <table className="data-table">
                    <thead>
                      <tr>
                        <th style={{ width: 92 }}>结果</th>
                        <th>题目</th>
                        <th style={{ width: 88 }}>语言</th>
                        <th className="cell-right" style={{ width: 96 }}>
                          耗时
                        </th>
                        <th className="cell-right" style={{ width: 160 }}>
                          提交时间
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((s) => (
                        <tr key={s.id} className="clickable-row" onClick={() => navigate(`/submission/${s.id}`)}>
                          <td>
                            <StatusBadge status={s.status} />
                          </td>
                          <td>
                            <Link
                              to={`/problem/${s.problem_id}`}
                              className="problem-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              P{s.problem_id} {s.problem_title}
                            </Link>
                          </td>
                          <td className="mono">{s.language}</td>
                          <td className="cell-right cell-num">{formatRunTime(s.time_ms)}</td>
                          <td className="cell-right mono">{formatTime(s.created_at)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="home-side">
          <section className="side-card">
            <h2 className="side-card-title">最近举行的比赛</h2>
            {summary.recent_contests.length === 0 ? (
              <p className="field-hint">还没有结束的比赛。</p>
            ) : (
              <ul className="home-contest-list">
                {summary.recent_contests.slice(0, 6).map((c) => (
                  <li key={c.id}>
                    <Link to={`/contest/${c.id}`}>
                      <span className="home-contest-mode">{contestModeLabel(c.mode)}</span>
                      <span className="home-contest-title">{c.title}</span>
                      <time className="home-contest-date" dateTime={c.end_time}>
                        {formatTime(c.end_time).slice(0, 10)}
                      </time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <Link to="/contests" className="button button-ghost button-sm button-block">
              全部比赛
            </Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
