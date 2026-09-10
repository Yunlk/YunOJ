import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { extractError, getRankings } from '../api'
import Pagination from '../components/Pagination'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import type { RankingEntry } from '../types'
import { formatTime } from '../utils/format'
import { ratingClass } from '../utils/rating'

const PAGE_SIZE = 30

function RankingAvatar({ item }: { item: RankingEntry }) {
  const [failed, setFailed] = useState(false)
  if (!item.avatar || failed) {
    return <span className="rank-avatar rank-avatar-fallback">{item.username.slice(0, 1).toUpperCase()}</span>
  }
  return (
    <img
      className="rank-avatar"
      src={`/api/users/${item.user_id}/avatar?v=${encodeURIComponent(item.avatar)}`}
      alt=""
      onError={() => setFailed(true)}
    />
  )
}

/**
 * 全站排名：先回答「我在哪」，再给榜单。
 * 搜索按用户名过滤显示，但保留全站名次（不重排），避免误导。
 */
export default function Ranking() {
  const { user } = useAuth()
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const keyword = searchParams.get('keyword') ?? ''

  const [items, setItems] = useState<RankingEntry[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [input, setInput] = useState(keyword)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setInput(keyword), [keyword])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getRankings(page, PAGE_SIZE, keyword || undefined)
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
    return () => {
      cancelled = true
    }
  }, [page, keyword])

  const setPage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    if (p <= 1) next.delete('page')
    else next.set('page', String(p))
    setSearchParams(next)
  }

  const search = (value: string) => {
    const next = new URLSearchParams(searchParams)
    const trimmed = value.trim()
    if (trimmed) next.set('keyword', trimmed)
    else next.delete('keyword')
    next.delete('page')
    setSearchParams(next)
  }

  const isStudent = Boolean(user && (user.role === 'student' || user.role === 'user'))
  const myId = user?.id ?? 0

  return (
    <div className="ranking-page">
      <PageHeader
        eyebrow="训练"
        title="全站排名"
        description="按难度加权解题、一血与有效通过率综合计分；搜索只过滤显示，名次仍是全站名次。"
        actions={
          <form
            className="search-form"
            onSubmit={(e) => {
              e.preventDefault()
              search(input)
            }}
          >
            <input
              ref={searchRef}
              type="search"
              className="search-input"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="搜索用户名…"
              aria-label="搜索用户"
              data-search-shortcut
            />
            <button type="submit" className="button button-primary">
              搜索
            </button>
          </form>
        }
      />

      {error && <div className="error-message">{error}</div>}

      {isStudent && user && (
        <section className="rank-me" aria-label="我的排名">
          <span className={`rank-me-badge ${ratingClass(user.rating)}`}>
            {user.rank > 0 ? `#${user.rank}` : '未上榜'}
          </span>
          <div className="rank-me-body">
            <strong>{user.username}</strong>
            <span className="rank-me-hint">
              综合分 {user.rating || 1000} · {user.rank > 0 ? `全站第 ${user.rank} 名` : '通过一题即可进入榜单'}
            </span>
          </div>
          <div className="rank-me-actions">
            <Link to="/status" className="button button-ghost button-sm">
              我的提交
            </Link>
            <Link to="/problems" className="button button-secondary button-sm">
              去刷题
            </Link>
          </div>
        </section>
      )}

      <details className="rank-formula">
        <summary>计分方式</summary>
        <p className="mono">综合分 = 1000 + (加权解题 + 0.1 × 一血) × (0.7 + 0.3 × 有效通过率) × 40</p>
        <p className="field-hint">加权解题按题目难度系数累加；有效通过率 = 通过题数 / 尝试题数。</p>
      </details>

      <div className="table-summary">
        <span>{loading ? '排名计算中…' : keyword ? `匹配 “${keyword}” 共 ${total} 人` : `共 ${total} 位选手`}</span>
        {keyword && (
          <button type="button" className="button button-ghost button-sm" onClick={() => search('')}>
            清除搜索
          </button>
        )}
      </div>

      <div className="table-frame">
        <table className="data-table ranking-table">
          <thead>
            <tr>
              <th style={{ width: 68 }}>排名</th>
              <th>用户</th>
              <th className="cell-right" style={{ width: 92 }}>
                综合分
              </th>
              <th className="cell-right" style={{ width: 104 }}>
                解题
              </th>
              <th className="cell-right" style={{ width: 100 }}>
                加权解题
              </th>
              <th className="cell-right" style={{ width: 72 }}>
                一血
              </th>
              <th className="cell-right" style={{ width: 92 }}>
                通过率
              </th>
              <th className="cell-right" style={{ width: 168 }}>
                最后通过
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 10 }).map((_, i) => (
                <tr key={`skeleton-${i}`}>
                  <td colSpan={8}>
                    <div className="skeleton" style={{ height: 16, width: `${55 + ((i * 17) % 40)}%` }} />
                  </td>
                </tr>
              ))
            ) : items.length === 0 ? (
              <tr>
                <td colSpan={8} className="table-empty">
                  <div className="empty-state-inline">
                    <span>{keyword ? '没有匹配的选手' : '暂无有效提交'}</span>
                    {keyword && (
                      <button type="button" className="button button-ghost button-sm" onClick={() => search('')}>
                        清除搜索
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              items.map((item) => (
                <tr
                  key={item.user_id}
                  className={[item.rank <= 3 ? `rank-top-${item.rank}` : '', item.user_id === myId ? 'rank-row-me' : '']
                    .filter(Boolean)
                    .join(' ')}
                >
                  <td className="rank-column">
                    {item.rank <= 3 ? <span className="rank-medal">{item.rank}</span> : item.rank}
                  </td>
                  <td>
                    <div className="rank-user">
                      <RankingAvatar item={item} />
                      <Link to={`/status?user_id=${item.user_id}`} className={`rank-name ${ratingClass(item.rating)}`}>
                        {item.username}
                      </Link>
                      {item.user_id === myId && <span className="badge badge-info">我</span>}
                    </div>
                  </td>
                  <td className={`cell-right rank-rating ${ratingClass(item.rating)}`}>{item.rating}</td>
                  <td className="cell-right cell-num">
                    {item.solved_problems}
                    <span className="rank-sub"> / {item.attempted_problems}</span>
                  </td>
                  <td className="cell-right cell-num">{item.weighted_solved.toFixed(1)}</td>
                  <td className="cell-right cell-num">{item.first_bloods > 0 ? item.first_bloods : '—'}</td>
                  <td className="cell-right cell-num">{Math.round(item.acceptance_rate * 100)}%</td>
                  <td className="cell-right mono rank-last-ac">
                    {item.last_accepted_at ? formatTime(item.last_accepted_at) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={setPage} />
    </div>
  )
}
