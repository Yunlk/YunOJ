import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { extractError, getSubmissions } from '../api'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { SUBMISSION_STATUSES, type SubmissionListItem } from '../types'
import { formatMemory, formatRunTime, formatTime } from '../utils/format'
import { getStatusInfo } from '../utils/status'

const PAGE_SIZE = 20

export default function Status() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const problemId = searchParams.get('problem_id') ?? ''
  const userId = searchParams.get('user_id') ?? ''
  const status = searchParams.get('status') ?? ''

  const [items, setItems] = useState<SubmissionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [fProblem, setFProblem] = useState(problemId)
  const [fUser, setFUser] = useState(userId)
  const [fStatus, setFStatus] = useState(status)

  const navigate = useNavigate()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getSubmissions({
      page,
      size: PAGE_SIZE,
      problem_id: problemId || undefined,
      user_id: userId || undefined,
      status: status || undefined,
    })
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
  }, [page, problemId, userId, status])

  const applyFilters = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const next = new URLSearchParams()
    if (fProblem.trim()) next.set('problem_id', fProblem.trim())
    if (fUser.trim()) next.set('user_id', fUser.trim())
    if (fStatus) next.set('status', fStatus)
    next.set('page', '1')
    setSearchParams(next)
  }

  const resetFilters = () => {
    setFProblem('')
    setFUser('')
    setFStatus('')
    setSearchParams({})
  }

  const changePage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  const openRow = (submissionId: number) => {
    navigate(`/submission/${submissionId}`)
  }

  return (
    <div>
      <h1 className="page-title">评测状态</h1>

      <form className="filter-bar" onSubmit={applyFilters}>
        <input
          className="filter-input"
          type="text"
          value={fProblem}
          onChange={(e) => setFProblem(e.target.value)}
          placeholder="题目 ID"
        />
        <input
          className="filter-input"
          type="text"
          value={fUser}
          onChange={(e) => setFUser(e.target.value)}
          placeholder="用户 ID"
        />
        <select
          className="select-input"
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
        >
          <option value="">全部状态</option>
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {getStatusInfo(s).label}
            </option>
          ))}
        </select>
        <button type="submit" className="button button-primary">
          筛选
        </button>
        <button type="button" className="button button-secondary" onClick={resetFilters}>
          重置
        </button>
      </form>

      {error && <div className="error-message">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>提交号</th>
            <th>题目</th>
            <th style={{ width: 120 }}>用户</th>
            <th style={{ width: 110 }}>语言</th>
            <th style={{ width: 150 }}>结果</th>
            <th style={{ width: 100 }}>耗时</th>
            <th style={{ width: 100 }}>内存</th>
            <th style={{ width: 170 }}>时间</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={8} className="table-empty">
                加载中…
              </td>
            </tr>
          ) : items.length === 0 ? (
            <tr>
              <td colSpan={8} className="table-empty">
                暂无提交记录
              </td>
            </tr>
          ) : (
            items.map((s) => (
              <tr key={s.id} className="clickable-row" onClick={() => openRow(s.id)}>
                <td className="mono">
                  <Link to={`/submission/${s.id}`} onClick={(e) => e.stopPropagation()}>
                    {s.id}
                  </Link>
                </td>
                <td>
                  <Link
                    to={`/problem/${s.problem_id}`}
                    onClick={(e) => e.stopPropagation()}
                    className="problem-link"
                  >
                    {s.problem_title}
                  </Link>
                </td>
                <td>{s.username}</td>
                <td className="mono">{s.language}</td>
                <td>
                  <StatusBadge status={s.status} />
                </td>
                <td className="mono">{formatRunTime(s.time_ms)}</td>
                <td className="mono">{formatMemory(s.memory_kb)}</td>
                <td className="mono">{formatTime(s.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={changePage} />
    </div>
  )
}
