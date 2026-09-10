import { useCallback, useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import {
  batchProblems,
  copyProblem,
  deleteProblem,
  exportProblemPackage,
  extractError,
  getProblems,
  getProblemUsage,
  importProblemPackage,
} from '../api'
import Pagination from '../components/Pagination'
import DifficultyBadge from '../components/DifficultyBadge'
import PageHeader from '../components/PageHeader'
import type { ProblemListItem } from '../types'
import { formatTime } from '../utils/format'
import { DIFFICULTIES } from '../utils/difficulty'

const PAGE_SIZE = 20

const TYPE_LABELS: Record<string, string> = {
  standard: '标准',
  hack: 'Hack',
  spj: 'SPJ',
  interactive: '交互',
  output_only: '输出题',
}

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  disabled: '已停用',
}

function statusBadgeClass(status: string): string {
  if (status === 'published') return 'badge badge-positive'
  if (status === 'draft') return 'badge badge-warning'
  return 'badge'
}

export default function ProblemAdmin() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const keyword = searchParams.get('keyword') ?? ''
  const difficulty = Number(searchParams.get('difficulty') ?? '0') || undefined
  const tag = searchParams.get('tag') ?? ''
  const type = searchParams.get('type') ?? ''
  const status = searchParams.get('status') ?? ''

  const [problems, setProblems] = useState<ProblemListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState(false)
  const [input, setInput] = useState(keyword)
  const [importing, setImporting] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    getProblems({
      page, size: PAGE_SIZE, keyword: keyword || undefined,
      difficulty: difficulty ? [difficulty] : undefined,
      tag: tag ? [tag] : undefined,
      type: type || undefined, status: status || undefined,
    })
      .then((data) => {
        setProblems(data.items)
        setTotal(data.total)
      })
      .catch((err) => setError(extractError(err)))
      .finally(() => setLoading(false))
  }, [page, keyword, difficulty, tag, type, status])

  useEffect(() => {
    load()
  }, [load])

  const search = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const next = new URLSearchParams()
    const kw = input.trim()
    if (kw) next.set('keyword', kw)
    next.set('page', '1')
    setSearchParams(next)
  }

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    next.set('page', '1')
    setSearchParams(next)
  }

  const changePage = (p: number) => {
    const next = new URLSearchParams(searchParams)
    next.set('page', String(p))
    setSearchParams(next)
  }

  const toggle = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => {
      if (prev.size === problems.length && problems.length > 0) return new Set()
      return new Set(problems.map((p) => p.id))
    })
  }

  const runBatch = async (action: 'publish' | 'disable' | 'delete') => {
    const ids = [...selected]
    if (ids.length === 0) {
      window.alert('请先勾选题目')
      return
    }
    if (action === 'delete' && !window.confirm(`确定删除选中的 ${ids.length} 道题目？删除会级联删除其提交记录。`)) return
    setBusy(true)
    setError('')
    try {
      const res = await batchProblems(ids, action)
      const failed = res.results.filter((r) => !r.ok)
      if (failed.length > 0) {
        window.alert(`成功 ${res.results.length - failed.length} 项，失败 ${failed.length} 项：\n` +
          failed.map((f) => `#${f.id}: ${f.error}`).join('\n'))
      }
      setSelected(new Set())
      load()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleCopy = async (id: number) => {
    setBusy(true)
    try {
      const p = await copyProblem(id)
      navigate(`/admin/problems/${p.id}`)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    setImporting(true)
    setError('')
    try {
      const result = await importProblemPackage(file)
      navigate(`/admin/problems/${result.problem.id}/tests`)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setImporting(false)
    }
  }

  const handleExport = async (id: number) => {
    setBusy(true)
    setError('')
    try {
      await exportProblemPackage(id)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (p: ProblemListItem) => {
    try {
      const usage = await getProblemUsage(p.id)
      let msg = `确定删除题目「${p.title}」？`
      if (usage.contests.length > 0) {
        window.alert(`该题目被 ${usage.contests.length} 场比赛引用，不能删除：\n` +
          usage.contests.map((c) => `#${c.id} ${c.title}`).join('\n'))
        return
      }
      if (usage.submissions > 0) {
        msg += `\n\n该题有 ${usage.submissions} 条提交记录，删除后一并清除。`
      }
      if (!window.confirm(msg)) return
      await deleteProblem(p.id)
      load()
    } catch (err) {
      setError(extractError(err))
    }
  }

  return (
    <div>
      <PageHeader
        eyebrow="平台管理"
        title="题目管理"
        description="维护题面、测试点、状态与可见性。"
        actions={<div className="page-actions">
          <label className="button button-secondary">
            {importing ? '导入中…' : '导入迁移包'}
            <input
              type="file"
              accept=".zip,application/zip"
              onChange={handleImport}
              disabled={importing}
              style={{ display: 'none' }}
            />
          </label>
          <Link to="/problem/new" className="button button-primary">新建题目</Link>
        </div>}
      />

      <form className="toolbar" onSubmit={search}>
        <input
          className="search-input"
          type="search"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="按标题搜索…"
          aria-label="按标题搜索"
        />
        <select value={difficulty ?? ''} onChange={(e) => setFilter('difficulty', e.target.value)} aria-label="难度">
          <option value="">全部难度</option>
          {DIFFICULTIES.map((item) => (
            <option key={item.value} value={item.value}>{item.label}</option>
          ))}
        </select>
        <select value={type} onChange={(e) => setFilter('type', e.target.value)} aria-label="题型">
          <option value="">全部题型</option>
          {Object.entries(TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setFilter('status', e.target.value)} aria-label="状态">
          <option value="">全部状态</option>
          {Object.entries(STATUS_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <input
          className="search-input"
          type="search"
          value={tag}
          onChange={(e) => setFilter('tag', e.target.value)}
          placeholder="标签筛选…"
          aria-label="按标签筛选"
        />
        <button type="submit" className="button button-primary">搜索</button>
      </form>

      {error && <div className="error-message">{error}</div>}

      <div className="toolbar toolbar-plain">
        <label className="check-row">
          <input
            type="checkbox"
            checked={selected.size > 0 && selected.size === problems.length}
            onChange={toggleAll}
            aria-label="全选本页题目"
          />
          全选本页
        </label>
        <span className="toolbar-label">已选 {selected.size} 项</span>
        <span className="toolbar-spacer" />
        <button type="button" className="button button-secondary button-sm" disabled={busy || selected.size === 0} onClick={() => runBatch('publish')}>
          批量发布
        </button>
        <button type="button" className="button button-secondary button-sm" disabled={busy || selected.size === 0} onClick={() => runBatch('disable')}>
          批量停用
        </button>
        <button type="button" className="button button-danger button-sm" disabled={busy || selected.size === 0} onClick={() => runBatch('delete')}>
          批量删除
        </button>
      </div>

      <div className="table-summary">
        <span>共 {total} 道题目</span>
        <span>第 {page} 页 · 每页 {PAGE_SIZE} 条</span>
      </div>

      <div className="table-frame">
      <table className="data-table admin-table-fixed">
        <thead>
          <tr>
            <th style={{ width: 40 }} />
            <th style={{ width: 70 }} className="cell-id">#</th>
            <th>标题</th>
            <th style={{ width: 80 }}>题型</th>
            <th style={{ width: 90 }}>难度</th>
            <th style={{ width: 80 }} className="cell-num">测试点</th>
            <th style={{ width: 120 }} className="cell-num">通过 / 提交</th>
            <th style={{ width: 90 }}>状态</th>
            <th style={{ width: 150 }}>更新时间</th>
            <th style={{ width: 320 }} className="cell-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={10} className="table-empty">加载中…</td></tr>
          ) : problems.length === 0 ? (
            <tr><td colSpan={10} className="table-empty">暂无题目</td></tr>
          ) : (
            problems.map((p) => (
              <tr key={p.id}>
                <td className="cell-tight">
                  <input
                    type="checkbox"
                    checked={selected.has(p.id)}
                    onChange={() => toggle(p.id)}
                    aria-label={`选择题目 ${p.title}`}
                  />
                </td>
                <td className="cell-id">{p.id}</td>
                <td>
                  <Link to={`/problem/${p.id}`} className="problem-link">{p.title}</Link>
                </td>
                <td><span className="tag-chip">{TYPE_LABELS[p.type ?? 'standard'] ?? p.type}</span></td>
                <td><DifficultyBadge value={p.difficulty} /></td>
                <td className="cell-num">{p.testcase_count ?? 0}</td>
                <td className="cell-num">{p.accepted_count} / {p.submission_count}</td>
                <td>
                  <span className={statusBadgeClass(p.status ?? 'published')}>
                    {STATUS_LABELS[p.status ?? 'published'] ?? p.status}
                  </span>
                </td>
                <td className="cell-num">{formatTime(p.updated_at)}</td>
                <td className="cell-actions">
                  <div className="row-actions">
                    <Link to={`/problem/${p.id}`} className="button button-ghost button-sm">预览</Link>
                    <button type="button" className="button button-ghost button-sm" disabled={busy} onClick={() => handleCopy(p.id)}>复制</button>
                    <button type="button" className="button button-ghost button-sm" disabled={busy} onClick={() => handleExport(p.id)}>导出</button>
                    <Link to={`/admin/problems/${p.id}/tests`} className="button button-ghost button-sm">测试点</Link>
                    <Link to={`/problem/${p.id}/edit`} className="button button-ghost button-sm">编辑</Link>
                    <button type="button" className="button button-ghost button-sm danger" onClick={() => handleDelete(p)}>删除</button>
                  </div>
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
      </div>

      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={changePage} />
    </div>
  )
}
