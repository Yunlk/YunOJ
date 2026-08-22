import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { changePassword, extractError, getProfile, uploadProfileAvatar } from '../api'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import type { ProfileActivityDay, ProfileData, SubmissionListItem } from '../types'
import { formatRunTime, formatTime } from '../utils/format'
import { ratingClass } from '../utils/rating'

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function heatLevel(count: number): string {
  if (count <= 0) return 'level-0'
  if (count === 1) return 'level-1'
  if (count <= 3) return 'level-2'
  if (count <= 6) return 'level-3'
  return 'level-4'
}

function buildHeatmap(activity: ProfileActivityDay[]) {
  const counts = new Map(activity.map((item) => [item.date, item.count]))
  const now = new Date()
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - 364)
  const mondayOffset = (start.getUTCDay() + 6) % 7
  start.setUTCDate(start.getUTCDate() - mondayOffset)
  const cells: { date: string; count: number }[] = []
  for (let i = 0; i < 371; i += 1) {
    const date = new Date(start)
    date.setUTCDate(start.getUTCDate() + i)
    const key = dateKey(date)
    cells.push({ date: key, count: counts.get(key) ?? 0 })
  }
  return cells
}

function Avatar({ profile, failed, onError }: {
  profile: ProfileData
  failed: boolean
  onError: () => void
}) {
  const initial = profile.user.username.slice(0, 1).toUpperCase()
  if (!profile.user.avatar || failed) {
    return <span className="profile-avatar-fallback">{initial}</span>
  }
  return (
    <img
      className="profile-avatar-image"
      src={`/api/users/${profile.user.id}/avatar?v=${encodeURIComponent(profile.user.avatar)}`}
      alt=""
      onError={onError}
    />
  )
}

function RecentSubmission({ item }: { item: SubmissionListItem }) {
  return (
    <tr>
      <td>
        <Link to={`/problem/${item.problem_id}`} className="problem-link">{item.problem_title}</Link>
      </td>
      <td><StatusBadge status={item.status} /></td>
      <td className="mono">{item.language}</td>
      <td className="mono">{formatRunTime(item.time_ms)}</td>
      <td className="mono profile-date-cell">{formatTime(item.created_at)}</td>
      <td><Link to={`/submission/${item.id}`} className="link-button profile-detail-link">查看</Link></td>
    </tr>
  )
}

export default function Profile() {
  const { setUser, refresh } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getProfile()
      .then((data) => {
        if (!cancelled) {
          setProfile(data)
          setUser(data.user)
        }
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [setUser])

  const heatmap = useMemo(() => buildHeatmap(profile?.activity ?? []), [profile?.activity])
  const activityTotal = useMemo(
    () => (profile?.activity ?? []).reduce((total, item) => total + item.count, 0),
    [profile?.activity],
  )
  const acceptedRate = profile && profile.stats.total_submissions > 0
    ? Math.round(profile.stats.accepted_submissions / profile.stats.total_submissions * 100)
    : 0

  const onAvatarChange = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadProfileAvatar(file)
      setProfile((current) => current
        ? { ...current, user: { ...current.user, avatar: result.avatar } }
        : current)
      setAvatarFailed(false)
      await refresh()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const updatePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setPasswordMessage('')
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword(''); setNewPassword(''); setPasswordMessage('密码已更新')
    } catch (err) { setPasswordMessage(extractError(err)) }
  }

  if (loading) return <div className="page-loading">个人中心加载中…</div>
  if (error && !profile) return <div className="error-message">{error}</div>
  if (!profile) return null

  return (
    <div className="profile-page">
      <div className="profile-header-panel">
        <div className="profile-identity">
          <button
            type="button"
            className="profile-avatar-button"
            onClick={() => inputRef.current?.click()}
            title="更换头像"
            disabled={uploading}
          >
            <Avatar profile={profile} failed={avatarFailed} onError={() => setAvatarFailed(true)} />
            <span className="profile-avatar-edit">更换</span>
          </button>
          <div>
            <div className="profile-name-line">
            <h1 className={(profile.user.role === 'student' || profile.user.role === 'user') ? ratingClass(profile.user.rating) : ''}>
                {profile.user.username}
              </h1>
              {profile.user.role === 'admin' && <span className="admin-tag">管理员</span>}
              {profile.user.role === 'teacher' && <span className="teacher-tag">教师</span>}
            </div>
            <p className="muted">{profile.user.email}</p>
            <p className="profile-meta">加入于 {formatTime(profile.user.created_at).slice(0, 10)}</p>
          </div>
        </div>
        <div className="profile-header-actions">
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            hidden
            onChange={(event) => void onAvatarChange(event.target.files?.[0])}
          />
          <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>
            {uploading ? '上传中…' : '更换头像'}
          </button>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <section className="profile-stat-grid" aria-label="训练统计">
        <div className="profile-stat profile-stat-rating"><span>综合分</span><strong>{profile.user.rating || 1000}</strong></div>
        <div className="profile-stat"><span>全站排名</span><strong>{profile.user.rank > 0 ? `#${profile.user.rank}` : '—'}</strong></div>
        <div className="profile-stat"><span>提交次数</span><strong>{profile.stats.total_submissions}</strong></div>
        <div className="profile-stat profile-stat-ac"><span>通过提交</span><strong>{profile.stats.accepted_submissions}</strong></div>
        <div className="profile-stat"><span>做过题目</span><strong>{profile.stats.attempted_problems}</strong></div>
        <div className="profile-stat"><span>参加比赛</span><strong>{profile.stats.contests}</strong></div>
        <div className="profile-stat profile-stat-rate"><span>提交通过率</span><strong>{acceptedRate}%</strong></div>
      </section>

      <section className="profile-panel profile-activity-panel">
        <div className="profile-panel-heading">
          <div>
            <h2>刷题活动</h2>
            <p className="muted">最近一年提交记录</p>
          </div>
          <span className="profile-heatmap-total">{activityTotal} 次提交</span>
        </div>
        <div className="profile-heatmap-wrap">
          <div className="profile-week-labels"><span>一</span><span>三</span><span>五</span></div>
          <div className="profile-heatmap-grid">
            {heatmap.map((cell) => (
              <span
                key={cell.date}
                className={`profile-heatmap-cell ${heatLevel(cell.count)}`}
                title={`${cell.date}：${cell.count} 次提交`}
              />
            ))}
          </div>
        </div>
        <div className="profile-heatmap-legend">
          <span>少</span><i className="level-0" /><i className="level-1" /><i className="level-2" /><i className="level-3" /><i className="level-4" /><span>多</span>
        </div>
      </section>

      <div className="profile-content-grid">
        <section className="profile-panel">
          <div className="profile-panel-heading">
            <h2>最近提交</h2>
            <Link to={`/status?user_id=${profile.user.id}`}>查看全部</Link>
          </div>
          <div className="profile-table-wrap">
            <table className="data-table profile-table">
              <thead><tr><th>题目</th><th>结果</th><th>语言</th><th>耗时</th><th>提交时间</th><th /></tr></thead>
              <tbody>
                {profile.recent_submissions.length === 0
                  ? <tr><td colSpan={6} className="table-empty">暂无提交记录</td></tr>
                  : profile.recent_submissions.map((item) => <RecentSubmission key={item.id} item={item} />)}
              </tbody>
            </table>
          </div>
        </section>

        <section className="profile-panel">
          <div className="profile-panel-heading">
            <h2>参加过的比赛</h2>
            <Link to="/contests">浏览比赛</Link>
          </div>
          {profile.contests.length === 0 ? (
            <p className="profile-empty">还没有参加过比赛</p>
          ) : (
            <div className="profile-contest-list">
              {profile.contests.slice(0, 8).map((contest) => (
                <Link className="profile-contest-item" key={contest.id} to={`/contest/${contest.id}`}>
                  <span>
                    <strong>{contest.title}</strong>
                    <small>{contest.mode} · {contest.submission_count} 次提交</small>
                  </span>
                  <time>{formatTime(contest.last_submitted_at).slice(0, 10)}</time>
                </Link>
              ))}
            </div>
          )}
        </section>
      </div>
      <section className="profile-panel profile-password-panel">
        <div className="profile-panel-heading"><div><h2>账户安全</h2><p className="muted">修改登录密码</p></div></div>
        <form className="form-row" onSubmit={updatePassword}><input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前密码" autoComplete="current-password" /><input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} placeholder="新密码（6-72 位）" autoComplete="new-password" /><button className="button button-secondary" type="submit" disabled={!currentPassword || newPassword.length < 6}>更新密码</button></form>
        {passwordMessage && <p className="muted">{passwordMessage}</p>}
      </section>
    </div>
  )
}
