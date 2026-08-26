import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { TOKEN_KEY } from '../api'
import { useAuth } from '../context/AuthContext'
import { ratingClass } from '../utils/rating'

export default function Navbar() {
  const { user, setUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const navClass = ({ isActive }: { isActive: boolean }) => isActive ? 'active' : undefined

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
          <NavLink to="/problems" className={({ isActive }) => navClass({ isActive: isActive || location.pathname.startsWith('/problem/') })}>题目</NavLink>
          <NavLink to="/status" className={navClass}>提交记录</NavLink>
          <NavLink to="/contests" className={({ isActive }) => navClass({ isActive: isActive || location.pathname.startsWith('/contest/') })}>比赛</NavLink>
          <NavLink to="/ranking" className={navClass}>排名</NavLink>
          {user?.role === 'admin' && (
            <>
              <NavLink to="/admin/problems" className={navClass}>题目管理</NavLink>
              <NavLink to="/admin/users" className={navClass}>用户管理</NavLink>
              <NavLink to="/admin/judge" className={navClass}>测评集群</NavLink>
              <NavLink to="/admin/notifications" className={navClass}>全站通知</NavLink>
              <NavLink to="/contest/new" className={navClass}>新建比赛</NavLink>
            </>
          )}
          {(user?.role === 'admin' || user?.role === 'teacher') && <NavLink to="/groups" className={navClass}>教学空间</NavLink>}
        </nav>
        <div className="nav-auth">
          {user ? (
            <>
              <NavLink
                to="/profile"
                className={({ isActive }) => `username ${(user.role === 'student' || user.role === 'user') ? ratingClass(user.rating) : ''}${isActive ? ' active' : ''}`}
                title={(user.role === 'student' || user.role === 'user') ? `综合分 ${user.rating || 1000}` : '打开个人中心'}
              >
                {user.username}
                {user.role === 'admin' && <span className="admin-tag">管理员</span>}
                {user.role === 'teacher' && <span className="teacher-tag">教师</span>}
              </NavLink>
              <NavLink to="/favorites" className={navClass}>收藏</NavLink>
              <NavLink to="/notifications" className={navClass}>通知</NavLink>
              <button type="button" className="link-button" onClick={logout}>
                退出
              </button>
            </>
          ) : (
            <>
              <NavLink to="/login" className={navClass}>登录</NavLink>
              <NavLink to="/register" className={navClass}>注册</NavLink>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
