import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProblems } from '../api'
import { useAuth } from '../context/AuthContext'
import type { ProblemListItem } from '../types'

interface QuickLink {
  label: string
  hint: string
  to: string
}

const BASE_LINKS: QuickLink[] = [
  { label: '题库', hint: '全部题目与筛选', to: '/problems' },
  { label: '比赛', hint: '进行中与即将开始', to: '/contests' },
  { label: '提交记录', hint: '按结论与题目检索', to: '/status' },
  { label: '排名', hint: '全站综合分榜', to: '/ranking' },
]

const USER_LINKS: QuickLink[] = [
  { label: '个人中心', hint: '进度与最近提交', to: '/profile' },
  { label: '收藏题目', hint: '稍后继续练习', to: '/favorites' },
]

/**
 * 命令面板：Ctrl/⌘+K 或 / 唤起，按题号或标题直达题目。
 * 刷题时「我想做 P123」不该经过题库页三次点击。
 */
export default function CommandPalette({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<ProblemListItem[]>([])
  const [loading, setLoading] = useState(false)
  const [cursor, setCursor] = useState(0)
  const inputRef = useRef<HTMLInputElement | null>(null)

  const links = useMemo(() => (user ? [...BASE_LINKS, ...USER_LINKS] : BASE_LINKS), [user])

  // 数字输入视为题号直达
  const numeric = /^\d+$/.test(query.trim()) ? Number(query.trim()) : 0

  useEffect(() => {
    if (!open) return
    setQuery('')
    setCursor(0)
    setItems([])
    const timer = window.setTimeout(() => inputRef.current?.focus(), 20)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const keyword = query.trim()
    if (keyword.length < 1) {
      setItems([])
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    const timer = window.setTimeout(() => {
      getProblems({ page: 1, size: 8, keyword })
        .then((data) => {
          if (!cancelled) setItems(data.items)
        })
        .catch(() => {
          if (!cancelled) setItems([])
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, query])

  const results = useMemo(() => {
    const trimmed = query.trim()
    const rows: { key: string; label: string; hint: string; to: string }[] = []
    if (!trimmed) {
      return links.map((l) => ({ key: l.to, label: l.label, hint: l.hint, to: l.to }))
    }
    if (numeric > 0) {
      rows.push({ key: `p-${numeric}`, label: `打开题目 P${numeric}`, hint: '题号直达', to: `/problem/${numeric}` })
    }
    for (const p of items) {
      rows.push({
        key: `p-${p.id}`,
        label: `P${p.id} ${p.title}`,
        hint: `${p.accepted_count}/${p.submission_count} 通过`,
        to: `/problem/${p.id}`,
      })
    }
    for (const l of links) {
      if (l.label.includes(trimmed)) rows.push({ key: l.to, label: l.label, hint: l.hint, to: l.to })
    }
    return rows
  }, [items, links, numeric, query])

  const openResult = useCallback(
    (to: string) => {
      onClose()
      navigate(to)
    },
    [navigate, onClose],
  )

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setCursor((c) => Math.min(c + 1, results.length - 1))
      return
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setCursor((c) => Math.max(c - 1, 0))
      return
    }
    if (e.key === 'Enter') {
      e.preventDefault()
      const target = results[cursor]
      if (target) openResult(target.to)
    }
  }

  if (!open) return null

  return (
    <div className="cmdk-overlay" role="presentation" onMouseDown={onClose}>
      <div
        className="cmdk"
        role="dialog"
        aria-modal="true"
        aria-label="快速跳转"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="cmdk-input-row">
          <span className="cmdk-icon" aria-hidden="true">
            ⌕
          </span>
          <input
            ref={inputRef}
            className="cmdk-input"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCursor(0)
            }}
            placeholder="输入题号或标题，回车直达…"
            aria-label="搜索题目或跳转"
            autoComplete="off"
          />
          <kbd>Esc</kbd>
        </div>
        <ul className="cmdk-list" role="listbox" aria-label="跳转结果">
          {results.length === 0 ? (
            <li className="cmdk-empty">{loading ? '搜索中…' : '没有匹配的题目或入口'}</li>
          ) : (
            results.map((row, index) => (
              <li key={row.key}>
                <button
                  type="button"
                  role="option"
                  aria-selected={index === cursor}
                  className={index === cursor ? 'cmdk-item active' : 'cmdk-item'}
                  onMouseEnter={() => setCursor(index)}
                  onClick={() => openResult(row.to)}
                >
                  <span className="cmdk-item-label">{row.label}</span>
                  <span className="cmdk-item-hint">{row.hint}</span>
                </button>
              </li>
            ))
          )}
        </ul>
        <div className="cmdk-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> 选择
          </span>
          <span>
            <kbd>Enter</kbd> 打开
          </span>
          {numeric > 0 && <span>题号直达 P{numeric}</span>}
        </div>
      </div>
    </div>
  )
}
