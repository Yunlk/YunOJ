import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, extractError } from '../api'
import DifficultyBadge from '../components/DifficultyBadge'
import type { HomeProblem } from '../types'

export default function Favorites() {
  const [items, setItems] = useState<HomeProblem[]>([])
  const [error, setError] = useState('')
  useEffect(() => { api.get<{ items: HomeProblem[] }>('/profile/favorites').then((res) => setItems(res.data.items)).catch((err) => setError(extractError(err))) }, [])
  return <div className="favorites-page"><div className="page-header"><h1 className="page-title">我的收藏</h1></div>{error && <div className="error-message">{error}</div>}<table className="data-table"><thead><tr><th>#</th><th>题目</th><th>难度</th><th>通过 / 提交</th></tr></thead><tbody>{items.length === 0 ? <tr><td colSpan={4} className="table-empty">还没有收藏题目</td></tr> : items.map((item) => <tr key={item.id}><td className="mono">{item.id}</td><td><Link to={`/problem/${item.id}`}>{item.title}</Link></td><td><DifficultyBadge value={item.difficulty} /></td><td className="mono">{item.accepted_count} / {item.submission_count}</td></tr>)}</tbody></table></div>
}
