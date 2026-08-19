import { Link, useNavigate } from 'react-router-dom'
import { TOKEN_KEY } from '../api'
import { useAuth } from '../context/AuthContext'

export default function Navbar() {
  const { user, setUser } = useAuth()
  const navigate = useNavigate()

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    navigate('/')
  }

  return (
    <header className="navbar">
      <div className="navbar-inner">
        <Link to="/" className="logo">
          YunOJ
        </Link>
        <nav className="nav-links">
          <Link to="/">题目</Link>
          <Link to="/status">状态</Link>
          <Link to="/contests">比赛</Link>
          {user?.role === 'admin' && (
            <>
              <Link to="/problem/new">新建题目</Link>
              <Link to="/contest/new">新建比赛</Link>
            </>
          )}
        </nav>
        <div className="nav-auth">
          {user ? (
            <>
              <span className="username" title={user.email}>
                {user.username}
                {user.role === 'admin' && <span className="admin-tag">管理员</span>}
              </span>
              <button type="button" className="link-button" onClick={logout}>
                退出
              </button>
            </>
          ) : (
            <>
              <Link to="/login">登录</Link>
              <Link to="/register">注册</Link>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
