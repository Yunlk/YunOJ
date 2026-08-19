import { useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { extractError, login, TOKEN_KEY } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Login() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const { setUser } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  const from = (location.state as { from?: string } | null)?.from ?? '/'

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!username.trim() || !password) {
      setError('请输入用户名和密码')
      return
    }
    setLoading(true)
    setError('')
    try {
      const data = await login(username.trim(), password)
      localStorage.setItem(TOKEN_KEY, data.token)
      setUser(data.user)
      navigate(from, { replace: true })
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-card">
      <h1 className="auth-title">登录 YunOJ</h1>
      <form onSubmit={submit} className="auth-form">
        <div className="form-group">
          <label htmlFor="login-username">用户名</label>
          <input
            id="login-username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            placeholder="请输入用户名"
          />
        </div>
        <div className="form-group">
          <label htmlFor="login-password">密码</label>
          <input
            id="login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            placeholder="请输入密码"
          />
        </div>
        {error && <div className="error-message">{error}</div>}
        <button type="submit" className="button button-primary button-block" disabled={loading}>
          {loading ? '登录中…' : '登录'}
        </button>
      </form>
      <p className="auth-switch">
        还没有账号？<Link to="/register">立即注册</Link>
      </p>
    </div>
  )
}
