import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { extractError, getContestMySubmissions } from '../api'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import type { SubmissionListItem } from '../types'
import { formatTime } from '../utils/format'

const PAGE_SIZE = 20

export default function ContestMySubmissions() {
  const { id } = useParams()
  const { user } = useAuth()
  const contestId = Number(id)
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const status = searchParams.get('status') ?? ''

  const [items, setItems] = useState<SubmissionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getContestMySubmissions({
      id: contestId, page, size: PAGE_SIZE, status: status || undefined,
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
  }, [contestId, page, status])

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    next.set('page', '1')
    setSearchParams(next)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">{isAdmin ? '比赛全部提交' : '我的比赛提交'}</h1>
        <Link to={`/contest/${contestId}`} className="button button-secondary">← 返回总览</Link>
      </div>
      <div className="search-form">
        <select value={status} onChange={(e) => setFilter('status', e.target.value)}>
          <option value="">全部状态</option>
          <option value="accepted">已通过</option>
          <option value="wrong_answer">答案错误</option>
          <option value="presentation_error">格式错误</option>
          <option value="time_limit_exceeded">超时</option>
          <option value="memory_limit_exceeded">超内存</option>
          <option value="output_limit_exceeded">输出超限</option>
          <option value="runtime_error">运行错误</option>
          <option value="compile_error">编译错误</option>
          <option value="system_error">系统错误</option>
        </select>
      </div>
      {error && <div className="error-message">{error}</div>}
      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 80 }}>#</th>
            {isAdmin && <th style={{ width: 120 }}>用户</th>}
            <th>题目</th>
            <th style={{ width: 90 }}>语言</th>
            <th style={{ width: 110 }}>状态</th>
            <th style={{ width: 80 }}>得分</th>
            <th style={{ width: 100 }}>耗时</th>
            <th style={{ width: 160 }}>提交时间</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={isAdmin ? 8 : 7} className="table-empty">加载中…</td></tr>
          ) : items.length === 0 ? (
            <tr><td colSpan={isAdmin ? 8 : 7} className="table-empty">暂无提交</td></tr>
          ) : (
            items.map((s) => (
              <tr key={s.id}>
                <td className="mono">
                  <Link to={`/submission/${s.id}`} className="problem-link">{s.id}</Link>
                </td>
                {isAdmin && <td>{s.username}</td>}
                <td>{s.problem_title}</td>
                <td className="mono">{s.language}</td>
                <td><StatusBadge status={s.status} /></td>
                <td className="mono">{s.score}</td>
                <td className="mono">{s.time_ms} ms</td>
                <td className="mono">{formatTime(s.created_at)}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={(p) => {
        const next = new URLSearchParams(searchParams)
        next.set('page', String(p))
        setSearchParams(next)
      }} />
    </div>
  )
}
