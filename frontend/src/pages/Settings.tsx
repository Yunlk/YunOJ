import { useEffect, useRef, useState } from 'react'
import { changePassword, extractError, getProfile, updateProfile, uploadProfileAvatar } from '../api'
import { useAuth } from '../context/AuthContext'
import type { ProfileData } from '../types'
import PageHeader from '../components/PageHeader'

function Avatar({ profile, failed, onError }: {
  profile: ProfileData
  failed: boolean
  onError: () => void
}) {
  const initial = profile.user.username.slice(0, 1).toUpperCase()
  if (!profile.user.avatar || failed) {
    return <span className="settings-avatar-fallback">{initial}</span>
  }
  return (
    <img
      className="settings-avatar-image"
      src={`/api/users/${profile.user.id}/avatar?v=${encodeURIComponent(profile.user.avatar)}`}
      alt=""
      onError={onError}
    />
  )
}

export default function Settings() {
  const { setUser, refresh } = useAuth()
  const inputRef = useRef<HTMLInputElement>(null)
  const [profile, setProfile] = useState<ProfileData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [avatarFailed, setAvatarFailed] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [profilePassword, setProfilePassword] = useState('')
  const [profileMessage, setProfileMessage] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [passwordMessage, setPasswordMessage] = useState('')

  useEffect(() => {
    let cancelled = false
    getProfile()
      .then((data) => {
        if (cancelled) return
        setProfile(data)
        setUser(data.user)
        setUsername(data.user.username)
        setEmail(data.user.email)
      })
      .catch((err) => { if (!cancelled) setError(extractError(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [setUser])

  const onAvatarChange = async (file: File | undefined) => {
    if (!file || !profile) return
    setUploading(true)
    setError('')
    try {
      const result = await uploadProfileAvatar(file)
      setProfile((current) => current ? { ...current, user: { ...current.user, avatar: result.avatar } } : current)
      setUser({ ...profile.user, avatar: result.avatar })
      setAvatarFailed(false)
      await refresh()
    } catch (err) { setError(extractError(err)) }
    finally {
      setUploading(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  const saveProfile = async (event: React.FormEvent) => {
    event.preventDefault()
    setProfileMessage('')
    try {
      const result = await updateProfile(username, email, profilePassword)
      setProfile((current) => current ? { ...current, user: result.user } : current)
      setUser(result.user)
      setProfilePassword('')
      setProfileMessage('资料已更新')
    } catch (err) { setProfileMessage(extractError(err)) }
  }

  const savePassword = async (event: React.FormEvent) => {
    event.preventDefault()
    setPasswordMessage('')
    try {
      await changePassword(currentPassword, newPassword)
      setCurrentPassword('')
      setNewPassword('')
      setPasswordMessage('密码已更新')
    } catch (err) { setPasswordMessage(extractError(err)) }
  }

  if (loading) return <div className="page-loading">设置加载中…</div>
  if (error && !profile) return <div className="error-message">{error}</div>
  if (!profile) return null

  return (
    <div className="settings-page">
      <PageHeader eyebrow="账户" title="设置" description="管理公开资料与登录安全。" />

      {error && <div className="error-message">{error}</div>}

      <div className="settings-grid">
        <section className="card settings-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">个人资料</h2>
              <p className="field-hint">这些信息会显示在你的公开资料中</p>
            </div>
          </div>
          <div className="panel-body">
            <div className="settings-avatar-row">
              <div className="settings-avatar"><Avatar profile={profile} failed={avatarFailed} onError={() => setAvatarFailed(true)} /></div>
              <div>
                <strong>头像</strong>
                <p className="field-hint">支持 JPG、PNG、GIF、WebP，最大 2MB</p>
                <input
                  ref={inputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/gif,image/webp"
                  aria-label="选择新的头像图片"
                  hidden
                  onChange={(event) => void onAvatarChange(event.target.files?.[0])}
                />
                <button type="button" className="button button-secondary" onClick={() => inputRef.current?.click()} disabled={uploading}>{uploading ? '上传中…' : '更换头像'}</button>
              </div>
            </div>
            <form className="settings-form" onSubmit={saveProfile}>
              <div className="form-group">
                <label htmlFor="set-username">用户名</label>
                <input id="set-username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" maxLength={20} />
              </div>
              <div className="form-group">
                <label htmlFor="set-email">绑定邮箱</label>
                <input id="set-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" />
              </div>
              <div className="form-group">
                <label htmlFor="set-profile-password">当前密码</label>
                <input
                  id="set-profile-password"
                  type="password"
                  value={profilePassword}
                  onChange={(event) => setProfilePassword(event.target.value)}
                  placeholder="修改用户名或邮箱时必填"
                  autoComplete="current-password"
                />
              </div>
              <div className="admin-form-actions">
                <button className="button button-primary" type="submit" disabled={!username || !email || !profilePassword}>保存资料</button>
              </div>
            </form>
            {profileMessage && <p className={profileMessage === '资料已更新' ? 'success-message' : 'error-message'}>{profileMessage}</p>}
          </div>
        </section>

        <section className="card settings-panel">
          <div className="panel-head">
            <div>
              <h2 className="panel-title">登录安全</h2>
              <p className="field-hint">定期更新密码，保护账号安全</p>
            </div>
          </div>
          <div className="panel-body">
            <form className="settings-form" onSubmit={savePassword}>
              <div className="form-group">
                <label htmlFor="set-current-password">当前密码</label>
                <input
                  id="set-current-password"
                  type="password"
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <div className="form-group">
                <label htmlFor="set-new-password">新密码</label>
                <input
                  id="set-new-password"
                  type="password"
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  placeholder="6-72 位"
                  autoComplete="new-password"
                  minLength={6}
                  maxLength={72}
                />
              </div>
              <div className="admin-form-actions">
                <button className="button button-primary" type="submit" disabled={!currentPassword || newPassword.length < 6}>更新密码</button>
              </div>
            </form>
            {passwordMessage && <p className={passwordMessage === '密码已更新' ? 'success-message' : 'error-message'}>{passwordMessage}</p>}
          </div>
        </section>
      </div>
    </div>
  )
}
