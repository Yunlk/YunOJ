import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'

export default function AdminRoute({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) {
    return <div className="page-loading">加载中…</div>
  }
  if (!user) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />
  }
  if (user.role !== 'admin') {
    return (
      <div className="no-permission">
        <h1>无权限</h1>
        <p>当前账号没有访问该页面的权限。</p>
      </div>
    )
  }
  return <>{children}</>
}
