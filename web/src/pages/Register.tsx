import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { extractError, register, TOKEN_KEY } from '../api'
import { useAuth } from '../context/AuthContext'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function Register() {
  const [username, setUsername] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const name = username.trim()
    if (name.length < 3 || name.length > 20) {
      setError('用户名长度需为 3-20 位')
      return
    }
    if (!EMAIL_RE.test(email.trim())) {
      setError('请输入有效的邮箱地址')
      return
    }
    if (password.length < 6) {
      setError('密码至少需要 6 位')
      return
    }
    if (password !== confirm) {
      setError('两次输入的密码不一致')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await register(name, email.trim(), password)
      localStorage.setItem(TOKEN_KEY, data.token)
      setUser(data.user)
      navigate('/', { replace: true })
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-title">注册 YunOJ</h1>
      <form onSubmit={submit} className="auth-form">
        <div className="form-group">
          <label htmlFor="reg-username">用户名</label>
          <input
            id="reg-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="3-20 位字符"
          />
        </div>
        <div className="form-group">
          <label htmlFor="reg-email">邮箱</label>
          <input
            id="reg-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            placeholder="you@example.com"
          />
        </div>
        <div className="form-group">
          <label htmlFor="reg-password">密码</label>
          <input
            id="reg-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            placeholder="至少 6 位"
          />
        </div>
        <div className="form-group">
          <label htmlFor="reg-confirm">确认密码</label>
          <input
            id="reg-confirm"
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            placeholder="再次输入密码"
          />
        </div>
        {error && <div className="error-message">{error}</div>}
        <button type="submit" className="button button-primary button-block" disabled={loading}>
          {loading ? '注册中…' : '注册'}
        </button>
      </form>
      <p className="auth-switch">
        已有账号？<Link to="/login">去登录</Link>
      </p>
    </div>
  )
}
