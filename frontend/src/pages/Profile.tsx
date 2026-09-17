import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractError, getProfile } from '../api'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import type { ProfileData, SubmissionListItem } from '../types'
import { formatRunTime, formatTime } from '../utils/format'
import { ratingClass } from '../utils/rating'

function Avatar({ profile, failed, onError }: {
  profile: ProfileData
  failed: boolean
  onError: () => void
}) {
  if (!profile.user.avatar || failed) {
    return <span className="pf-avatar-fallback">{profile.user.username.slice(0, 1).toUpperCase()}</span>
  }
  return (
    <img
      className="pf-avatar-image"
      src={`/api/users/${profile.user.id}/avatar?v=${encodeURIComponent(profile.user.avatar)}`}
      alt=""
      onError={onError}
    />
  )
}

function RoleTag({ role }: { role: string }) {
  if (role !== 'admin' && role !== 'teacher') return null
  return <span className="badge badge-info">{role === 'admin' ? '管理员' : '教师'}</span>
}

function RecentSubmissionRow({ item }: { item: SubmissionListItem }) {
  return (
    <tr>
      <td>
        <Link to={`/problem/${item.problem_id}`} className="pf-problem-link">{item.problem_title}</Link>
      </td>
      <td><StatusBadge status={item.status} /></td>
      <td className="pf-mono">{item.language}</td>
      <td className="pf-mono">{formatRunTime(item.time_ms)}</td>
      <td className="pf-mono pf-time-cell">{formatTime(item.created_at)}</td>
      <td className="cell-actions">
        <Link to={`/submission/${item.id}`} className="button button-ghost button-sm">查看</Link>
      </td>
    </tr>
  )
}

export default function Profile() {
  const { setUser } = useAuth()
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [avatarFailed, setAvatarFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProfile()
      .then((data) => {
        if (cancelled) return
        setProfile(data)
        setUser(data.user)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [setUser])

  const acceptedRate = profile && profile.stats.total_submissions > 0
    ? Math.round((profile.stats.accepted_submissions / profile.stats.total_submissions) * 100)
    : 0

  if (loading) return <div className="page-loading">个人中心加载中…</div>
  if (error && !profile) return <div className="error-message">{error}</div>
  if (!profile) return null

  const { user, stats, ranking } = profile
  const isStudent = user.role === 'student' || user.role === 'user'

  return (
    <div className="profile-page">
      <PageHeader
        title={user.username}
        eyebrow="个人中心"
        description={`${user.email} · 加入于 ${formatTime(user.created_at).slice(0, 10)}`}
        actions={<RoleTag role={user.role} />}
      />

      {error && <div className="error-message">{error}</div>}

      <div className="layout-side">
        <div className="pf-main">
          <section aria-label="训练统计">
            <div className="stat-grid">
              <div className="stat-tile">
                <span className="stat-tile-label">综合分</span>
                <strong className={`stat-tile-value ${isStudent ? ratingClass(user.rating) : ''}`}>
                  {user.rating || 1000}
                </strong>
                {ranking && <span className="stat-tile-sub">加权解题 {ranking.weighted_solved.toFixed(1)}</span>}
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">全站排名</span>
                <strong className="stat-tile-value">{user.rank > 0 ? `#${user.rank}` : '—'}</strong>
                <span className="stat-tile-sub"><Link to="/ranking">查看排行榜</Link></span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">提交次数</span>
                <strong className="stat-tile-value">{stats.total_submissions}</strong>
              </div>
              <div className="stat-tile stat-tile-positive">
                <span className="stat-tile-label">通过提交</span>
                <strong className="stat-tile-value">{stats.accepted_submissions}</strong>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">做过题目</span>
                <strong className="stat-tile-value">{stats.attempted_problems}</strong>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">参加比赛</span>
                <strong className="stat-tile-value">{stats.contests}</strong>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">提交通过率</span>
                <strong className="stat-tile-value">{acceptedRate}%</strong>
              </div>
            </div>
          </section>

          <section className="pf-panel" aria-labelledby="pf-recent-title">
            <div className="pf-panel-head">
              <h2 className="pf-panel-title" id="pf-recent-title">最近提交</h2>
              <Link to={`/status?user_id=${user.id}`} className="pf-link">查看全部</Link>
            </div>
            <div className="table-frame">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>题目</th>
                    <th>结果</th>
                    <th>语言</th>
                    <th>CPU 耗时</th>
                    <th>提交时间</th>
                    <th><span className="visually-hidden">操作</span></th>
                  </tr>
                </thead>
                <tbody>
                  {profile.recent_submissions.length === 0
                    ? <tr><td colSpan={6} className="table-empty">暂无提交记录</td></tr>
                    : profile.recent_submissions.map((item) => <RecentSubmissionRow key={item.id} item={item} />)}
                </tbody>
              </table>
            </div>
          </section>

          <section className="pf-panel" aria-labelledby="pf-contests-title">
            <div className="pf-panel-head">
              <h2 className="pf-panel-title" id="pf-contests-title">参加过的比赛</h2>
              <Link to="/contests" className="pf-link">浏览比赛</Link>
            </div>
            {profile.contests.length === 0 ? (
              <div className="empty-state">
                <span className="empty-state-title">还没有参加过比赛</span>
                <span className="empty-state-hint">报名一场比赛，用限时提交检验训练成果。</span>
                <Link to="/contests" className="button button-primary button-sm">去看比赛</Link>
              </div>
            ) : (
              <ul className="pf-contest-list">
                {profile.contests.slice(0, 8).map((contest) => (
                  <li key={contest.id}>
                    <Link className="pf-contest-item" to={`/contest/${contest.id}`}>
                      <span className="pf-contest-main">
                        <strong>{contest.title}</strong>
                        <small>{contest.mode} · {contest.submission_count} 次提交</small>
                      </span>
                      <time className="pf-mono">{formatTime(contest.last_submitted_at).slice(0, 10)}</time>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="pf-side" aria-label="账号信息">
          <section className="side-card" aria-labelledby="pf-account-title">
            <h2 className="side-card-title" id="pf-account-title">账号信息</h2>
            <div className="pf-account-head">
              <span className="pf-avatar">
                <Avatar profile={profile} failed={avatarFailed} onError={() => setAvatarFailed(true)} />
              </span>
              <span className="pf-account-name">
                <strong className={isStudent ? ratingClass(user.rating) : ''}>{user.username}</strong>
                <RoleTag role={user.role} />
              </span>
            </div>
            <dl className="kv-list">
              <div><dt>邮箱</dt><dd>{user.email}</dd></div>
              <div><dt>加入时间</dt><dd>{formatTime(user.created_at).slice(0, 10)}</dd></div>
              <div><dt>综合分</dt><dd>{user.rating || 1000}</dd></div>
              <div><dt>全站排名</dt><dd>{user.rank > 0 ? `#${user.rank}` : '—'}</dd></div>
              {ranking && <div><dt>加权解题</dt><dd>{ranking.weighted_solved.toFixed(1)}</dd></div>}
              {ranking && <div><dt>首次 AC</dt><dd>{ranking.first_bloods}</dd></div>}
            </dl>
            <Link to="/settings" className="button button-ghost button-sm button-block">账号设置</Link>
          </section>
        </aside>
      </div>
    </div>
  )
}
