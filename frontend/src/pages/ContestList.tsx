import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { extractError, getContests } from '../api'
import Pagination from '../components/Pagination'
import type { Contest } from '../types'
import { formatTime } from '../utils/format'
import { contestModeLabel, contestPhase, phaseClass, phaseLabel } from '../utils/contest'

const PAGE_SIZE = 20

export default function ContestList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)

  const [contests, setContests] = useState<Contest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getContests({ page, size: PAGE_SIZE })
      .then((data) => {
        if (cancelled) return
        setContests(data.items)
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
  }, [page])

  const changePage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">比赛</h1>
      </div>

      {error && <div className="error-message">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>#</th>
            <th>标题</th>
            <th style={{ width: 90 }}>赛制</th>
            <th style={{ width: 170 }}>开始时间</th>
            <th style={{ width: 170 }}>结束时间</th>
            <th style={{ width: 100 }}>状态</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={6} className="table-empty">
                加载中…
              </td>
            </tr>
          ) : contests.length === 0 ? (
            <tr>
              <td colSpan={6} className="table-empty">
                暂无比赛
              </td>
            </tr>
          ) : (
            contests.map((c) => {
              const phase = contestPhase(c)
              return (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>
                    <Link to={`/contest/${c.id}`} className="problem-link">
                      {c.title}
                    </Link>
                  </td>
                  <td>
                    <span className="tag-chip">{contestModeLabel(c.mode)}</span>
                  </td>
                  <td className="mono">{formatTime(c.start_time)}</td>
                  <td className="mono">{formatTime(c.end_time)}</td>
                  <td>
                    <span className={`phase-badge ${phaseClass(phase)}`}>{phaseLabel(phase)}</span>
                  </td>
                </tr>
              )
            })
          )}
        </tbody>
      </table>

      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={changePage} />
    </div>
  )
}
