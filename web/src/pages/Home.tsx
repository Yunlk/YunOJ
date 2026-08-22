import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractError, getHome } from '../api'
import DifficultyBadge from '../components/DifficultyBadge'
import { useAuth } from '../context/AuthContext'
import type { HomeData } from '../types'
import { formatTime } from '../utils/format'

function contestState(start: string, end: string): string {
  const now = Date.now()
  if (now < new Date(start).getTime()) return '即将开始'
  if (now < new Date(end).getTime()) return '进行中'
  return '已结束'
}

export default function Home() {
  const { user } = useAuth()
  const [data, setData] = useState<HomeData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    getHome()
      .then((value) => { if (!cancelled) setData(value) })
      .catch((err) => { if (!cancelled) setError(extractError(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  if (loading) return <div className="page-loading">首页加载中…</div>
  if (error || !data) return <div className="error-message">{error || '首页加载失败'}</div>
  const { summary } = data
  const contests = [...summary.active_contests, ...summary.upcoming_contests]

  return (
    <div className="home-page">
      <section className="home-intro">
        <div>
          <p className="home-kicker">YunOJ · 训练与竞赛平台</p>
          <h1>把每一次提交，变成可追踪的进步。</h1>
          <p className="home-intro-copy">题库、比赛和班级作业集中在一个工作台里，适合日常练习，也适合学校组织小型竞赛。</p>
          <div className="home-intro-actions">
            <Link to="/problems" className="button button-primary">进入题库</Link>
            <Link to="/contests" className="button button-secondary">浏览比赛</Link>
          </div>
        </div>
        <div className="home-stat-strip">
          <div><strong>{summary.problem_count}</strong><span>公开题目</span></div>
          <div><strong>{summary.user_count}</strong><span>活跃用户</span></div>
          <div><strong>{summary.submission_count}</strong><span>累计提交</span></div>
        </div>
      </section>

      {user && data.my_stats && (
        <section className="home-section home-personal-strip">
          <div><span>我的提交</span><strong>{data.my_stats.total_submissions}</strong></div>
          <div><span>通过提交</span><strong>{data.my_stats.accepted_submissions}</strong></div>
          <div><span>做过题目</span><strong>{data.my_stats.attempted_problems}</strong></div>
          <div><Link to="/profile">打开个人中心 →</Link></div>
        </section>
      )}

      <div className="home-content-grid">
        <section className="home-section">
          <div className="home-section-heading"><h2>比赛日程</h2><Link to="/contests">全部比赛</Link></div>
          {contests.length === 0 ? <p className="home-empty">暂时没有公开比赛。</p> : (
            <div className="home-contest-list">
              {contests.slice(0, 6).map((contest) => (
                <Link className="home-contest-item" to={`/contest/${contest.id}`} key={contest.id}>
                  <div><strong>{contest.title}</strong><span>{formatTime(contest.start_time)} · {contest.mode}</span></div>
                  <span className={`home-contest-state ${contestState(contest.start_time, contest.end_time) === '进行中' ? 'active' : ''}`}>{contestState(contest.start_time, contest.end_time)}</span>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section className="home-section">
          <div className="home-section-heading"><h2>最近题目</h2><Link to="/problems">题库</Link></div>
          <div className="home-problem-list">
            {summary.recent_problems.map((problem) => (
              <Link className="home-problem-item" to={`/problem/${problem.id}`} key={problem.id}>
                <span><strong>P{problem.id} · {problem.title}</strong><small>{problem.accepted_count} / {problem.submission_count} 通过</small></span>
                <DifficultyBadge value={problem.difficulty} />
              </Link>
            ))}
          </div>
        </section>
      </div>

      {user && data.groups && data.groups.length > 0 && (
        <section className="home-section">
          <div className="home-section-heading"><h2>我的班级 / 团体</h2><Link to="/groups">管理空间</Link></div>
          <div className="home-group-grid">
            {data.groups.slice(0, 4).map((group) => <Link to={`/groups/${group.id}`} className="home-group-item" key={group.id}><strong>{group.name}</strong><span>{group.member_count} 位成员 · {group.owner_name}</span></Link>)}
          </div>
        </section>
      )}
    </div>
  )
}
