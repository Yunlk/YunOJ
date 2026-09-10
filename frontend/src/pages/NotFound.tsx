import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="empty-state">
      <h1 className="page-title">404</h1>
      <span className="empty-state-hint">你访问的页面不存在。</span>
      <Link to="/" className="button button-primary">
        返回首页
      </Link>
    </div>
  )
}
