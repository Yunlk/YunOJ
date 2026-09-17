import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { extractError, getProblemFacets, getProblems } from '../api'
import type { MyProblemStatus, ProblemSort } from '../api'
import DifficultyBadge from '../components/DifficultyBadge'
import Pagination from '../components/Pagination'
import PageHeader from '../components/PageHeader'
import type { ProblemFacets, ProblemListItem } from '../types'
import { DIFFICULTIES, getDifficulty } from '../utils/difficulty'

const PAGE_SIZES = [20, 50, 100]

const STATUS_TABS: { key: MyProblemStatus | ''; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'todo', label: '未做' },
  { key: 'attempted', label: '尝试过' },
  { key: 'accepted', label: '已通过' },
]

const SORT_OPTIONS: { key: ProblemSort; label: string }[] = [
  { key: 'id', label: '按题号' },
  { key: 'recent', label: '最近做过' },
  { key: 'difficulty', label: '难度升序' },
  { key: 'difficulty_desc', label: '难度降序' },
  { key: 'acceptance', label: '通过率最高' },
  { key: 'submissions', label: '提交最多' },
  { key: 'newest', label: '最新添加' },
]

/** 题目状态标记：已通过 / 尝试过 / 未做，颜色与判定色一致。 */
function StatusCell({ status }: { status?: string }) {
  if (status === 'accepted') {
    return (
      <span className="problem-status problem-status-accepted" title="已通过">
        <span aria-hidden="true">✓</span>
        <span className="visually-hidden">已通过</span>
      </span>
    )
  }
  if (status === 'wrong_answer') {
    return (
      <span className="problem-status problem-status-attempted" title="尝试过但未通过">
        <span aria-hidden="true">✗</span>
        <span className="visually-hidden">尝试过但未通过</span>
      </span>
    )
  }
  return (
    <span className="problem-status problem-status-todo" title="未做">
      <span aria-hidden="true">–</span>
      <span className="visually-hidden">未做</span>
    </span>
  )
}

function acceptanceText(accepted: number, submissions: number) {
  if (submissions <= 0) return '—'
  return `${Math.round((accepted / submissions) * 100)}%`
}

export default function ProblemList() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  // ---- URL 即筛选状态：可分享、可前进后退 ----
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const size = PAGE_SIZES.includes(Number(searchParams.get('size'))) ? Number(searchParams.get('size')) : 20
  const keyword = searchParams.get('keyword') ?? ''
  const myStatus = (searchParams.get('my_status') ?? '') as MyProblemStatus | ''
  const sort = (searchParams.get('sort') ?? 'id') as ProblemSort
  const difficulties = useMemo(
    () => (searchParams.get('difficulty') ?? '').split(',').map(Number).filter((n) => n >= 1 && n <= 9),
    [searchParams],
  )
  const tags = useMemo(
    () => (searchParams.get('tag') ?? '').split(',').filter(Boolean),
    [searchParams],
  )

  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [total, setTotal] = useState(0)
  const [facets, setFacets] = useState<ProblemFacets | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [input, setInput] = useState(keyword)
  const [tagPickerOpen, setTagPickerOpen] = useState(false)
  const searchRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => setInput(keyword), [keyword])

  const patchParams = useCallback(
    (patch: Record<string, string | null>, resetPage = true) => {
      const next = new URLSearchParams(searchParams)
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key)
        else next.set(key, value)
      }
      if (resetPage) next.set('page', '1')
      setSearchParams(next)
    },
    [searchParams, setSearchParams],
  )

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProblems({
      page,
      size,
      keyword: keyword || undefined,
      difficulty: difficulties.length ? difficulties : undefined,
      tag: tags.length ? tags : undefined,
      my_status: myStatus || undefined,
      sort,
    })
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
  }, [page, size, keyword, myStatus, sort, difficulties, tags])

  useEffect(() => {
    let cancelled = false
    getProblemFacets()
      .then((data) => {
        if (!cancelled) setFacets(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  // 键盘：/ 由导航统一分发（页面搜索框标记了 data-search-shortcut，会优先获得焦点）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return
      if (e.key === '/') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const query = useMemo(
    () => ({
      keyword: keyword || undefined,
      difficulty: difficulties.length ? difficulties : undefined,
      tag: tags.length ? tags : undefined,
      my_status: myStatus || undefined,
      sort,
    }),
    [keyword, difficulties, tags, myStatus, sort],
  )

  /** 在当前筛选结果里随机抽一题：先取总数，再随机取一页的第一题。 */
  const randomProblem = async () => {
    try {
      const first = await getProblems({ page: 1, size: 1, ...query })
      if (first.total === 0) {
        setError('当前筛选条件下没有题目')
        return
      }
      const pick = Math.floor(Math.random() * first.total) + 1
      const target = await getProblems({ page: pick, size: 1, ...query })
      if (target.items[0]) navigate(`/problem/${target.items[0].id}`)
    } catch (err) {
      setError(extractError(err))
    }
  }

  /** 继续未完成的题：按「我最近提交过」排序，优先回到上次动手的那道题。 */
  const continueAttempt = async () => {
    try {
      const data = await getProblems({ page: 1, size: 1, my_status: 'attempted', sort: 'recent' })
      if (data.items[0]) navigate(`/problem/${data.items[0].id}`)
      else patchParams({ my_status: 'attempted' })
    } catch (err) {
      setError(extractError(err))
    }
  }

  const toggleDifficulty = (value: number) => {
    const next = difficulties.includes(value)
      ? difficulties.filter((d) => d !== value)
      : [...difficulties, value].sort((a, b) => a - b)
    patchParams({ difficulty: next.length ? next.join(',') : null })
  }

  const toggleTag = (tag: string) => {
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag]
    patchParams({ tag: next.length ? next.join(',') : null })
  }

  const clearFilters = () => {
    setSearchParams(new URLSearchParams())
  }

  const hasFilters = Boolean(keyword || myStatus || difficulties.length || tags.length || sort !== 'id')

  return (
    <div className="problems-page">
      <PageHeader
        eyebrow="训练"
        title="题库"
        description="按状态、难度与标签定位练习；题号左侧标出你的作答状态，右侧可直接开始刷题。"
        actions={
          <button type="button" className="button button-secondary" onClick={() => void continueAttempt()}>
            继续未完成
          </button>
        }
      />

      {error && <div className="error-message">{error}</div>}

      <div className="problems-layout">
        <div className="problems-main">
          <div className="toolbar problems-toolbar">
            <form
              className="problems-search"
              onSubmit={(e) => {
                e.preventDefault()
                patchParams({ keyword: input.trim() || null })
              }}
            >
              <input
                ref={searchRef}
                type="search"
                className="search-input"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="搜索题目标题…"
                aria-label="搜索题目"
                data-search-shortcut
              />
              <kbd title="快捷键：/">{'/'}</kbd>
              <button type="submit" className="button button-primary button-sm">
                搜索
              </button>
            </form>

            <div className="segmented" role="group" aria-label="我的作答状态">
              {STATUS_TABS.map((tab) => (
                <button
                  key={tab.key || 'all'}
                  type="button"
                  aria-pressed={myStatus === tab.key}
                  onClick={() => patchParams({ my_status: tab.key || null })}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            <span className="toolbar-spacer" />

            <label className="toolbar-field">
              <span className="toolbar-label">排序</span>
              <select
                value={sort}
                onChange={(e) => patchParams({ sort: e.target.value === 'id' ? null : e.target.value })}
                aria-label="排序方式"
              >
                {SORT_OPTIONS.map((option) => (
                  <option key={option.key} value={option.key}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="toolbar-field">
              <span className="toolbar-label">每页</span>
              <select
                value={size}
                onChange={(e) => patchParams({ size: e.target.value === '20' ? null : e.target.value })}
                aria-label="每页题数"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>

            {hasFilters && (
              <button type="button" className="button button-ghost button-sm" onClick={clearFilters}>
                重置
              </button>
            )}
          </div>

          <div className="problem-filters">
            <div className="filter-group" role="group" aria-label="难度筛选">
              <span className="filter-label">难度</span>
              <div className="filter-chips">
                {DIFFICULTIES.map((item) => {
                  const facet = facets?.difficulties.find((d) => d.difficulty === item.value)
                  const active = difficulties.includes(item.value)
                  return (
                    <button
                      key={item.value}
                      type="button"
                      className={`filter-chip ${item.className}${active ? ' active' : ''}`}
                      aria-pressed={active}
                      onClick={() => toggleDifficulty(item.value)}
                      title={facet ? `${facet.solved}/${facet.total} 已解决` : undefined}
                    >
                      {item.label}
                      {facet && facet.total > 0 && (
                        <span className="filter-chip-count">
                          {facet.solved}/{facet.total}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>

            <div className="filter-group filter-group-tags">
              <span className="filter-label">标签</span>
              <div className="filter-chips">
                {tags.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    className="filter-chip active"
                    aria-pressed="true"
                    onClick={() => toggleTag(tag)}
                    title="移除该标签"
                  >
                    {tag}
                    <span className="filter-chip-remove" aria-hidden="true">
                      ×
                    </span>
                  </button>
                ))}
                <div className="tag-picker">
                  <button
                    type="button"
                    className="filter-chip filter-chip-add"
                    onClick={() => setTagPickerOpen((open) => !open)}
                    aria-expanded={tagPickerOpen}
                  >
                    + 标签
                  </button>
                  {tagPickerOpen && (
                    <>
                      <div className="tag-picker-backdrop" onClick={() => setTagPickerOpen(false)} />
                      <div className="tag-picker-panel menu" role="menu">
                        {(facets?.tags ?? []).length === 0 && <div className="tag-picker-empty">暂无标签</div>}
                        {(facets?.tags ?? []).map((t) => (
                          <button
                            key={t.tag}
                            type="button"
                            role="menuitem"
                            className={`menu-item${tags.includes(t.tag) ? ' active' : ''}`}
                            onClick={() => {
                              toggleTag(t.tag)
                              setTagPickerOpen(false)
                            }}
                          >
                            <span>{t.tag}</span>
                            <span className="tag-picker-count">{t.count}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>

          <div className="table-summary">
            <span>
              {loading ? '加载中…' : `共 ${total} 道题${hasFilters ? '（已筛选）' : ''}`}
            </span>
            {difficulties.length > 0 && (
              <span className="muted">
                难度：{difficulties.map((d) => getDifficulty(d).label).join('、')}
              </span>
            )}
          </div>

          <div className="table-frame">
            <table className="data-table problems-table">
              <thead>
                <tr>
                  <th className="cell-tight" style={{ width: 46 }}>
                    <span className="visually-hidden">我的状态</span>
                    <span aria-hidden="true">状态</span>
                  </th>
                  <th style={{ width: 72 }}>#</th>
                  <th>标题</th>
                  <th style={{ width: 96 }}>难度</th>
                  <th style={{ width: 210 }}>标签</th>
                  <th className="cell-right" style={{ width: 132 }}>
                    通过 / 提交
                  </th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  Array.from({ length: Math.min(size, 8) }).map((_, i) => (
                    <tr key={`skeleton-${i}`}>
                      <td colSpan={6}>
                        <div className="skeleton" style={{ height: 16, width: `${60 + ((i * 13) % 35)}%` }} />
                      </td>
                    </tr>
                  ))
                ) : problems.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="table-empty">
                      <div className="empty-state-inline">
                        <span>没有符合条件的题目</span>
                        {hasFilters && (
                          <button type="button" className="button button-ghost button-sm" onClick={clearFilters}>
                            清除筛选
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  problems.map((p) => (
                    <tr key={p.id} className="clickable-row" onClick={() => navigate(`/problem/${p.id}`)}>
                      <td className="cell-tight">
                        <StatusCell status={p.my_status} />
                      </td>
                      <td className="cell-id">{p.id}</td>
                      <td>
                        <Link
                          to={`/problem/${p.id}`}
                          className="problem-link"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {p.title}
                        </Link>
                      </td>
                      <td>
                        <DifficultyBadge value={p.difficulty} />
                      </td>
                      <td>
                        {p.tags.length === 0 ? (
                          <span className="muted">—</span>
                        ) : (
                          <div className="tag-list">
                            {p.tags.slice(0, 3).map((t) => (
                              <button
                                key={t}
                                type="button"
                                className="tag-chip tag-chip-link"
                                onClick={(e) => {
                                  e.stopPropagation()
                                  toggleTag(t)
                                }}
                              >
                                {t}
                              </button>
                            ))}
                            {p.tags.length > 3 && <span className="muted">+{p.tags.length - 3}</span>}
                          </div>
                        )}
                      </td>
                      <td className="cell-right cell-num">
                        {p.accepted_count} / {p.submission_count}
                        <span className="problem-rate">{acceptanceText(p.accepted_count, p.submission_count)}</span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination page={page} total={total} size={size} onChange={(p) => patchParams({ page: String(p) }, false)} />
        </div>

        <aside className="problems-side">
          <section className="side-card">
            <h2 className="side-card-title">快捷入口</h2>
            <div className="side-actions">
              <button type="button" className="button button-secondary button-block" onClick={() => void randomProblem()}>
                随机一题
              </button>
              <Link to="/favorites" className="button button-ghost button-block">
                我的收藏
              </Link>
            </div>
          </section>

          <section className="side-card problems-side-hint">
            <h2 className="side-card-title">状态说明</h2>
            <ul className="legend-list">
              <li>
                <StatusCell status="accepted" /> 已通过
              </li>
              <li>
                <StatusCell status="wrong_answer" /> 尝试过，尚未通过
              </li>
              <li>
                <StatusCell /> 未做
              </li>
            </ul>
            <p className="side-hint">
              按 <kbd>/</kbd> 直接搜索题目
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
