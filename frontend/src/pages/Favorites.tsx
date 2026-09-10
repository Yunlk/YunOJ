import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, extractError, toggleProblemFavorite } from '../api'
import DifficultyBadge from '../components/DifficultyBadge'
import PageHeader from '../components/PageHeader'
import type { HomeProblem } from '../types'

type StatusFilter = 'all' | 'todo' | 'attempted' | 'accepted'

/** 我的作答状态：已通过 / 尝试过 / 未做。 */
type SolveStatus = 'accepted' | 'wrong_answer' | 'todo'

const STATUS_FILTERS: { key: StatusFilter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'todo', label: '未做' },
  { key: 'attempted', label: '尝试过' },
  { key: 'accepted', label: '已通过' },
]

/** 收藏接口自带 my_status（accepted / wrong_answer / 空串=未做），无需额外请求。 */
function solveStatus(item: HomeProblem): SolveStatus {
  if (item.my_status === 'accepted') return 'accepted'
  if (item.my_status === 'wrong_answer') return 'wrong_answer'
  return 'todo'
}

function StatusFlag({ status }: { status: SolveStatus }) {
  if (status === 'accepted') {
    return <span className="status-flag status-flag-accepted"><span aria-hidden="true">✓</span>已通过</span>
  }
  if (status === 'wrong_answer') {
    return <span className="status-flag status-flag-attempted"><span aria-hidden="true">✗</span>尝试过</span>
  }
  return <span className="status-flag status-flag-todo"><span aria-hidden="true">–</span>未做</span>
}

export default function Favorites() {
  const [items, setItems] = useState<HomeProblem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
  const [pendingId, setPendingId] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    api.get<{ items: HomeProblem[] }>('/profile/favorites')
      .then((res) => { if (!cancelled) setItems(res.data.items) })
      .catch((err) => { if (!cancelled) setError(extractError(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const rows = useMemo(() => items.map((item) => ({
    item,
    status: solveStatus(item),
  })), [items])

  const visible = useMemo(() => rows.filter((row) => {
    if (statusFilter === 'all') return true
    if (statusFilter === 'accepted') return row.status === 'accepted'
    if (statusFilter === 'attempted') return row.status === 'wrong_answer'
    return row.status === 'todo'
  }), [rows, statusFilter])

  const remove = async (id: number) => {
    setPendingId(id)
    setError('')
    try {
      await toggleProblemFavorite(id)
      setItems((current) => current.filter((item) => item.id !== id))
    } catch (err) {
      setError(extractError(err))
    } finally {
      setPendingId(null)
    }
  }

  return (
    <div className="favorites-page">
      <PageHeader title="我的收藏" description="集中查看稍后想继续练习的题目。" />

      {error && <div className="error-message">{error}</div>}

      {!loading && items.length > 0 && (
        <div className="toolbar">
          <div className="segmented" role="group" aria-label="按作答状态筛选收藏">
            {STATUS_FILTERS.map((filter) => (
              <button
                key={filter.key}
                type="button"
                aria-pressed={statusFilter === filter.key}
                onClick={() => setStatusFilter(filter.key)}
              >
                {filter.label}
                <span className="segmented-count">
                  {filter.key === 'all'
                    ? rows.length
                    : rows.filter((row) => (
                      filter.key === 'accepted' ? row.status === 'accepted'
                        : filter.key === 'attempted' ? row.status === 'wrong_answer'
                          : row.status === 'todo'
                    )).length}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="table-summary">
        <span>
          {loading ? '收藏加载中…' : `共 ${items.length} 道收藏题目${statusFilter === 'all' ? '' : `，当前筛选 ${visible.length} 道`}`}
        </span>
        <Link to="/problems" className="pf-link">去题库找题</Link>
      </div>

      {!loading && items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-title">还没有收藏题目</span>
          <span className="empty-state-hint">在题目页点「☆ 收藏」，稍后就能从这里直接回到没做完的题。</span>
          <Link to="/problems" className="button button-primary">去题库</Link>
        </div>
      ) : (
        <div className="table-frame">
          <table className="data-table">
            <thead>
              <tr>
                <th className="cell-tight">#</th>
                <th>题目</th>
                <th>难度</th>
                <th>标签</th>
                <th className="cell-right">通过 / 提交</th>
                <th>状态</th>
                <th className="cell-actions">操作</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={`skeleton-${i}`}>
                    <td colSpan={7}><div className="skeleton" style={{ height: 16, width: `${55 + i * 9}%` }} /></td>
                  </tr>
                ))
              ) : visible.length === 0 ? (
                <tr>
                  <td colSpan={7} className="table-empty">
                    <div className="empty-state-inline">
                      <span>当前筛选下没有收藏题目</span>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        onClick={() => setStatusFilter('all')}
                      >
                        清除筛选
                      </button>
                    </div>
                  </td>
                </tr>
              ) : (
                visible.map(({ item, status }) => (
                  <tr key={item.id}>
                    <td className="cell-id">{item.id}</td>
                    <td>
                      <Link to={`/problem/${item.id}`} className="pf-problem-link">{item.title}</Link>
                    </td>
                    <td><DifficultyBadge value={item.difficulty} /></td>
                    <td className="pf-tags-cell">
                      {item.tags.length === 0 ? (
                        <span className="pf-muted">—</span>
                      ) : (
                        <div className="tag-list">
                          {item.tags.slice(0, 3).map((tag) => <span className="tag-chip" key={tag}>{tag}</span>)}
                          {item.tags.length > 3 && <span className="pf-muted">+{item.tags.length - 3}</span>}
                        </div>
                      )}
                    </td>
                    <td className="cell-right pf-mono">{item.accepted_count} / {item.submission_count}</td>
                    <td><StatusFlag status={status} /></td>
                    <td className="cell-actions">
                      <Link to={`/problem/${item.id}`} className="button button-primary button-sm">去做题</Link>
                      <button
                        type="button"
                        className="button button-ghost button-sm"
                        disabled={pendingId === item.id}
                        onClick={() => void remove(item.id)}
                      >
                        {pendingId === item.id ? '取消中…' : '取消收藏'}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
