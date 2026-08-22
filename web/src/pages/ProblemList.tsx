import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { extractError, getProblems } from '../api'
import DifficultyBadge from '../components/DifficultyBadge'
import Pagination from '../components/Pagination'
import type { ProblemListItem } from '../types'
import { DIFFICULTIES } from '../utils/difficulty'

const PAGE_SIZE = 20

export default function ProblemList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const keyword = searchParams.get('keyword') ?? ''
  const difficulty = Number(searchParams.get('difficulty') ?? '0') || undefined

  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [input, setInput] = useState(keyword)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProblems({ page, size: PAGE_SIZE, keyword: keyword || undefined, difficulty })
      .then((data) => {
        if (cancelled) return
        setProblems(data.items)
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
  }, [page, keyword, difficulty])

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const next = new URLSearchParams()
    const kw = input.trim()
    if (kw) next.set('keyword', kw)
    if (difficulty) next.set('difficulty', String(difficulty))
    next.set('page', '1')
    setSearchParams(next)
  }

  const changePage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  const changeDifficulty = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('difficulty', value)
    else next.delete('difficulty')
    next.set('page', '1')
    setSearchParams(next)
  }

  return (
    <div>
      <div className="page-header">
        <h1 className="page-title">题目列表</h1>
        <form className="search-form" onSubmit={search}>
          <select value={difficulty ?? ''} onChange={(event) => changeDifficulty(event.target.value)} aria-label="难度筛选">
            <option value="">全部难度</option>
            {DIFFICULTIES.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <input
            className="search-input"
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="按标题搜索…"
          />
          <button type="submit" className="button button-primary">
            搜索
          </button>
        </form>
      </div>

      {error && <div className="error-message">{error}</div>}

      <table className="data-table">
        <thead>
          <tr>
            <th style={{ width: 70 }}>#</th>
            <th>标题</th>
            <th style={{ width: 90 }}>难度</th>
            <th style={{ width: 200 }}>标签</th>
            <th style={{ width: 130 }}>通过 / 提交</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={5} className="table-empty">
                加载中…
              </td>
            </tr>
          ) : problems.length === 0 ? (
            <tr>
              <td colSpan={5} className="table-empty">
                暂无题目
              </td>
            </tr>
          ) : (
            problems.map((p) => (
              <tr key={p.id}>
                <td className="mono">{p.id}</td>
                <td>
                  <Link to={`/problem/${p.id}`} className="problem-link">
                    {p.title}
                  </Link>
                </td>
                <td>
                  <DifficultyBadge value={p.difficulty} />
                </td>
                <td>
                  <div className="tag-list">
                    {p.tags.length === 0 ? (
                      <span className="muted">—</span>
                    ) : (
                      p.tags.map((t) => (
                        <span key={t} className="tag-chip">
                          {t}
                        </span>
                      ))
                    )}
                  </div>
                </td>
                <td className="mono">
                  {p.accepted_count} / {p.submission_count}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>

      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={changePage} />
    </div>
  )
}
