import { Link } from 'react-router-dom'

export default function NotFound() {
  return (
    <div className="not-found">
      <h1>404</h1>
      <p>你访问的页面不存在。</p>
      <Link to="/" className="button button-primary">
        返回首页
      </Link>
    </div>
  )
}
