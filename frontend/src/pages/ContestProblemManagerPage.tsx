import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addContestProblem, extractError, getContest, getProblems, removeContestProblem,
  reorderContestProblems, updateContestProblem,
} from '../api'
import PageHeader from '../components/PageHeader'
import type { ContestDetail, ContestProblem, ProblemListItem } from '../types'

export function ProblemManager({ contestId, problems, onChanged }: {
  contestId: number
  problems: ContestProblem[]
  onChanged: () => void
}) {
  const [keyword, setKeyword] = useState('')
  const [candidates, setCandidates] = useState<ProblemListItem[]>([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const search = useCallback(() => {
    setSearching(true)
    getProblems({ page: 1, size: 12, keyword: keyword || undefined })
      .then((data) => setCandidates(data.items.filter((item) => !problems.some((p) => p.problem_id === item.id))))
      .catch((err) => setError(extractError(err)))
      .finally(() => setSearching(false))
  }, [keyword, problems])

  const add = async (problemId: number) => {
    setBusy(true)
    setError('')
    try {
      const maxOrder = problems.reduce((max, item) => Math.max(max, item.sort_order), 0)
      await addContestProblem(contestId, {
        problem_id: problemId,
        display_id: String.fromCharCode(65 + problems.length),
        sort_order: maxOrder + 1,
      })
      setCandidates((items) => items.filter((item) => item.id !== problemId))
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (problemId: number) => {
    if (!window.confirm('移除该题目？')) return
    setBusy(true)
    setError('')
    try {
      await removeContestProblem(contestId, problemId)
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const update = async (problemId: number, patch: {
    display_id?: string
    score?: number | null
    submission_limit?: number | null
    theme_color?: string
  }) => {
    const problem = problems.find((item) => item.problem_id === problemId)
    if (!problem) return
    setBusy(true)
    setError('')
    try {
      await updateContestProblem(contestId, problemId, {
        display_id: patch.display_id ?? problem.display_id,
        score: patch.score !== undefined ? patch.score : (problem.score ?? null),
        submission_limit: patch.submission_limit !== undefined
          ? patch.submission_limit
          : (problem.submission_limit ?? null),
        theme_color: patch.theme_color ?? problem.theme_color ?? '',
      })
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const reorder = async (from: number, to: number) => {
    if (from === to) return
    const ids = problems.map((item) => item.problem_id)
    const [moved] = ids.splice(from, 1)
    ids.splice(to, 0, moved)
    setBusy(true)
    setError('')
    try {
      await reorderContestProblems(contestId, ids)
      onChanged()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="contest-problem-manager">
      <div className="section-head contest-problem-manager-heading">
        <h2 className="section-title">比赛题目</h2>
        <span className="section-hint">
          题目状态不会因加入比赛自动改变。单题分值留空时继承题目满分，也可以填写任意正整数自定义本场分值。草稿题不会出现在公共题库，但比赛开始后报名选手可在比赛内访问并正常测评；比赛结束后仍保持草稿，除非管理员另行发布。
        </span>
      </div>
      <form
        className="toolbar toolbar-plain admin-problem-search"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault()
          search()
        }}
      >
        <label htmlFor="cp-search">从题库添加题目</label>
        <div className="admin-problem-search-row">
          <input
            id="cp-search"
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="题号或标题"
          />
          <button type="submit" className="button button-secondary" disabled={searching}>
            {searching ? '搜索中…' : '搜索'}
          </button>
        </div>
      </form>

      {candidates.length > 0 && (
        <div className="candidate-list">
          {candidates.map((problem) => (
            <div key={problem.id} className="candidate-item">
              <span className="cell-id">#{problem.id}</span>
              <span className="candidate-title">{problem.title}</span>
              {problem.status && (
                <span className={`badge ${problem.status === 'draft' ? 'badge-warning' : problem.status === 'published' ? 'badge-positive' : 'badge-danger'}`}>
                  {problem.status === 'draft' ? '草稿' : problem.status === 'published' ? '公开' : '停用'}
                </span>
              )}
              <button type="button" className="button button-ghost button-sm" disabled={busy} onClick={() => add(problem.id)}>添加</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="table-summary">
        <span>本场共 {problems.length} 道题</span>
        <span className="section-hint">拖拽行可调整顺序</span>
      </div>

      <div className="table-frame">
        <table className="data-table admin-problem-table">
          <thead>
            <tr>
              <th style={{ width: 64 }}>顺序</th>
              <th style={{ width: 96 }}>题号</th>
              <th>标题</th>
              <th style={{ width: 170 }}>单题分值（可自定义）</th>
              <th style={{ width: 140 }}>提交上限</th>
              <th style={{ width: 130 }}>题目颜色</th>
              <th className="cell-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {problems.length === 0 ? (
              <tr>
                <td colSpan={7} className="table-empty">
                  <div className="empty-state">
                    <span className="empty-state-title">暂无题目</span>
                    <span className="empty-state-hint">在上方搜索题库并点击「添加」把题目加入本场比赛。</span>
                  </div>
                </td>
              </tr>
            ) : problems.map((problem, index) => (
              <tr
                key={problem.problem_id}
                draggable
                onDragStart={() => setDragIdx(index)}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragIdx !== null) void reorder(dragIdx, index)
                  setDragIdx(null)
                }}
                className="admin-problem-row"
                title="拖拽调整顺序"
              >
                <td className="cell-num">{problem.sort_order}</td>
                <td>
                  <input
                    type="text"
                    defaultValue={problem.display_id}
                    disabled={busy}
                    className="admin-problem-id-input"
                    aria-label={`题号（${problem.title}）`}
                    onBlur={(event) => {
                      const value = event.target.value.trim()
                      if (value && value !== problem.display_id) void update(problem.problem_id, { display_id: value })
                    }}
                  />
                </td>
                <td><Link to={`/problem/${problem.problem_id}`} className="problem-link">{problem.title}</Link></td>
                <td>
                  <input
                    type="number"
                    min={1}
                    step={1}
                    defaultValue={problem.score ?? ''}
                    disabled={busy}
                    placeholder="继承题目满分"
                    aria-label={`单题分值（${problem.title}）`}
                    onBlur={(event) => void update(problem.problem_id, {
                      score: event.target.value === ''
                        ? null
                        : (() => {
                          const value = Number(event.target.value)
                          return Number.isFinite(value) ? Math.max(1, Math.floor(value)) : null
                        })(),
                    })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    min={0}
                    max={1000}
                    defaultValue={problem.submission_limit ?? ''}
                    disabled={busy}
                    placeholder="继承"
                    aria-label={`提交上限（${problem.title}）`}
                    onBlur={(event) => void update(problem.problem_id, {
                      submission_limit: event.target.value === '' ? null : Number(event.target.value),
                    })}
                  />
                </td>
                <td>
                  <select
                    className="contest-theme-select"
                    value={problem.theme_color || ''}
                    disabled={busy}
                    aria-label={`题目颜色（${problem.title}）`}
                    onChange={(event) => void update(problem.problem_id, { theme_color: event.target.value })}
                  >
                    <option value="">自动</option>
                    {['blue', 'green', 'orange', 'purple', 'cyan', 'rose', 'yellow', 'indigo'].map((color) => <option key={color} value={color}>{color}</option>)}
                  </select>
                </td>
                <td className="cell-actions">
                  <button type="button" className="button button-ghost button-sm danger" disabled={busy} onClick={() => void remove(problem.problem_id)}>
                    移除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

export default function ContestProblemManagerPage() {
  const { id } = useParams()
  const contestId = Number(id)
  const [data, setData] = useState<ContestDetail | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    getContest(contestId)
      .then(setData)
      .catch((err) => setError(extractError(err)))
  }, [contestId])

  useEffect(() => { reload() }, [reload])

  if (error) return <div className="error-message">{error}</div>
  if (!data) return <div className="page-loading">加载中…</div>

  return (
    <div className="contest-admin-page">
      <PageHeader
        eyebrow="比赛管理"
        title={`题目管理 · ${data.contest.title}`}
        description="配置本场题目、显示顺序、分值、提交上限与主题色。"
        actions={<Link to={`/contest/${contestId}`} className="button button-secondary">返回总览</Link>}
      />
      <ProblemManager contestId={contestId} problems={data.problems} onChanged={reload} />
    </div>
  )
}
