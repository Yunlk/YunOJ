import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { extractError, getRankings } from '../api'
import Pagination from '../components/Pagination'
import type { RankingEntry } from '../types'
import { formatTime } from '../utils/format'
import { ratingClass } from '../utils/rating'

const PAGE_SIZE = 30

function RankingAvatar({ item }: { item: RankingEntry }) {
  const [failed, setFailed] = useState(false)
  if (!item.avatar || failed) {
    return <span className="ranking-avatar-fallback">{item.username.slice(0, 1).toUpperCase()}</span>
  }
  return (
    <img
      className="ranking-avatar-image"
      src={`/api/users/${item.user_id}/avatar?v=${encodeURIComponent(item.avatar)}`}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

export default function Ranking() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const [items, setItems] = useState<RankingEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getRankings(page, PAGE_SIZE)
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setTotal(data.total)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
  }, [page])

  const changePage = (nextPage: number) => {
    setSearchParams(nextPage > 1 ? { page: String(nextPage) } : {})
  }

  return (
    <div className="ranking-page">
      <div className="page-header ranking-header">
        <div>
          <h1 className="page-title">全站排名</h1>
          <p className="ranking-subtitle">难度加权解题、一血与有效通过率共同计分</p>
        </div>
        <div className="ranking-formula mono">
          1000 + (加权解题 + 0.1 × 一血) × (0.7 + 0.3 × 有效通过率) × 40
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="ranking-table-wrap">
        <table className="data-table ranking-table">
          <thead>
            <tr>
              <th className="ranking-rank-column">排名</th>
              <th>用户</th>
              <th>综合分</th>
              <th>解题</th>
              <th>加权解题</th>
              <th>一血</th>
              <th>有效通过率</th>
              <th>最后通过</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={8} className="table-empty">排名计算中…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={8} className="table-empty">暂无有效提交</td></tr>
            ) : items.map((item) => (
              <tr key={item.user_id} className={item.rank <= 3 ? `ranking-top-${item.rank}` : ''}>
                <td className="ranking-rank-column mono">{item.rank}</td>
                <td>
                  <div className="ranking-user">
                    <RankingAvatar item={item} />
                    <Link to={`/status?user_id=${item.user_id}`} className={`ranking-name ${ratingClass(item.rating)}`}>
                      {item.username}
                    </Link>
                  </div>
                </td>
                <td className={`ranking-rating mono ${ratingClass(item.rating)}`}>{item.rating}</td>
                <td className="mono">{item.solved_problems} / {item.attempted_problems}</td>
                <td className="mono">{item.weighted_solved.toFixed(1)}</td>
                <td className="mono">{item.first_bloods}</td>
                <td className="mono">{Math.round(item.acceptance_rate * 100)}%</td>
                <td className="ranking-last-ac">{item.last_accepted_at ? formatTime(item.last_accepted_at) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={changePage} />
    </div>
  )
}
