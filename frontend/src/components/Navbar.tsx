import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { TOKEN_KEY, getActiveContest } from '../api'
import CommandPalette from './CommandPalette'
import { useAuth } from '../context/AuthContext'
import type { Contest } from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import { ratingClass } from '../utils/rating'

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null
  if (!node) return false
  return /^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName) || node.isContentEditable
}

/**
 * 顶部导航：刷题优先（题库/比赛/提交记录/排名）+ 全局快速跳转 + 进行中比赛提示。
 */
export default function Navbar() {
  const { user, setUser } = useAuth()
  const location = useLocation()
  const navigate = useNavigate()
  const [menuOpen, setMenuOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [activeContest, setActiveContest] = useState<Contest | null>(null)
  const now = useClock()
  const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'active' : undefined)
  // 下拉菜单项：.menu-item 提供整行可点区域与悬停态；active 由 .appbar-panel a.active 着色
  const menuClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'menu-item active' : 'menu-item')
  const adminActive = location.pathname.startsWith('/admin/') || location.pathname === '/contest/new'

  useEffect(() => setMenuOpen(false), [location.pathname])

  // 进行中的比赛：进站就能看到剩余时间，不必先点进比赛列表
  useEffect(() => {
    let cancelled = false
    const load = () => {
      getActiveContest()
        .then((contest) => {
          if (!cancelled) setActiveContest(contest)
        })
        .catch(() => {})
    }
    load()
    const timer = window.setInterval(load, 60000)
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [location.pathname])

  // Ctrl/⌘+K 或 / 唤起快速跳转；页面自带搜索框时（[data-search-shortcut]）让位给页面
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen(true)
        return
      }
      if (e.key === '/' && !isTypingTarget(e.target)) {
        const pageSearch = document.querySelector<HTMLElement>('[data-search-shortcut]')
        if (pageSearch) {
          e.preventDefault()
          pageSearch.focus()
          return
        }
        e.preventDefault()
        setPaletteOpen(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY)
    setUser(null)
    setMenuOpen(false)
    navigate('/')
  }

  const remaining = activeContest ? new Date(activeContest.end_time).getTime() - now : 0
  return (
    <>
      <header className="appbar">
        <div className="appbar-inner">
          <Link to="/" className="appbar-logo" aria-label="YunOJ 首页">
            Yun<span>OJ</span>
          </Link>

          <button
            type="button"
            className="appbar-menu-toggle"
            aria-label={menuOpen ? '关闭导航' : '打开导航'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span aria-hidden="true">{menuOpen ? '×' : '≡'}</span>
          </button>

          <button type="button" className="appbar-search" onClick={() => setPaletteOpen(true)}>
            <span className="appbar-search-icon" aria-hidden="true">
              ⌕
            </span>
            <span className="appbar-search-text">搜索题目 / 快速跳转</span>
            <kbd>Ctrl K</kbd>
          </button>

          <div className={`appbar-body${menuOpen ? ' open' : ''}`}>
            <nav className="appbar-nav" aria-label="主导航">
              <NavLink
                to="/problems"
                className={({ isActive }) =>
                  navClass({ isActive: isActive || location.pathname.startsWith('/problem/') })
                }
              >
                题库
              </NavLink>
              <NavLink
                to="/contests"
                className={({ isActive }) =>
                  navClass({ isActive: isActive || location.pathname.startsWith('/contest/') })
                }
              >
                比赛
              </NavLink>
              <NavLink to="/status" className={navClass}>
                提交记录
              </NavLink>
              <NavLink to="/ranking" className={navClass}>
                排名
              </NavLink>
              {(user?.role === 'admin' || user?.role === 'teacher') && (
                <NavLink to="/groups" className={navClass}>
                  教学空间
                </NavLink>
              )}
              {user?.role === 'admin' && (
                <details className={`appbar-dropdown${adminActive ? ' active' : ''}`} key={`admin-${location.pathname}`}>
                  <summary>管理</summary>
                  <div className="appbar-panel menu">
                    {/* 下拉项必须用 .menu-item：早前误传 navClass（只返回 active），
                        链接退化成行内纯文本，菜单看起来「只有文字」 */}
                    <NavLink to="/admin/problems" className={menuClass}>
                      题目管理
                    </NavLink>
                    <NavLink to="/admin/users" className={menuClass}>
                      用户管理
                    </NavLink>
                    <NavLink to="/admin/judge" className={menuClass}>
                      测评集群
                    </NavLink>
                    <NavLink to="/admin/notifications" className={menuClass}>
                      全站通知
                    </NavLink>
                    <NavLink to="/contest/new" className={menuClass}>
                      新建比赛
                    </NavLink>
                  </div>
                </details>
              )}
            </nav>

            {activeContest && remaining > 0 && (
              <NavLink to={`/contest/${activeContest.id}`} className="appbar-contest" title={activeContest.title}>
                <span className="appbar-contest-dot" aria-hidden="true" />
                <span className="appbar-contest-title">{activeContest.title}</span>
                <span className="appbar-contest-time">{formatRemaining(remaining)}</span>
              </NavLink>
            )}

            <div className="appbar-actions">
              {user ? (
                <details className="appbar-dropdown appbar-user" key={`user-${location.pathname}`}>
                  <summary className={(user.role === 'student' || user.role === 'user') ? ratingClass(user.rating) : ''}>
                    {user.username}
                    {user.role === 'admin' && <span className="appbar-role">管理员</span>}
                    {user.role === 'teacher' && <span className="appbar-role">教师</span>}
                  </summary>
                  <div className="appbar-panel menu appbar-panel-right">
                    <div className="appbar-user-head">
                      <strong>{user.username}</strong>
                      <span>
                        {user.role === 'student' || user.role === 'user'
                          ? `综合分 ${user.rating || 1000}`
                          : user.role === 'admin'
                            ? '管理员账号'
                            : '教师账号'}
                      </span>
                    </div>
                    <div className="menu-sep" />
                    <NavLink to="/profile" className="menu-item">
                      个人中心
                    </NavLink>
                    <NavLink to="/favorites" className="menu-item">
                      收藏题目
                    </NavLink>
                    <NavLink to="/notifications" className="menu-item">
                      通知
                    </NavLink>
                    <NavLink to="/settings" className="menu-item">
                      设置
                    </NavLink>
                    <div className="menu-sep" />
                    <button type="button" className="menu-item" onClick={logout}>
                      退出登录
                    </button>
                  </div>
                </details>
              ) : (
                <>
                  <NavLink to="/login" className="appbar-link">
                    登录
                  </NavLink>
                  <NavLink to="/register" className="button button-primary button-sm">
                    注册
                  </NavLink>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </>
  )
}
