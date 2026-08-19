import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addContestProblem, extractError, getContest, getProblems, removeContestProblem,
  reorderContestProblems, updateContestProblem,
} from '../api'
import type { ContestDetail, ContestProblem, ProblemListItem } from '../types'

function ProblemManager({ contestId, problems, onChanged }: {
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
      <form
        className="admin-problem-search"
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
              <span className="mono">#{problem.id}</span>
              <span className="candidate-title">{problem.title}</span>
              <button type="button" className="link-button" disabled={busy} onClick={() => add(problem.id)}>添加</button>
            </div>
          ))}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}

      <div className="admin-problem-table-wrap">
        <table className="data-table admin-problem-table">
          <thead>
            <tr>
              <th>顺序</th>
              <th>题号</th>
              <th>标题</th>
              <th>单题分值</th>
              <th>提交上限</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {problems.length === 0 ? (
              <tr><td colSpan={6} className="table-empty">暂无题目</td></tr>
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
                <td className="mono">{problem.sort_order}</td>
                <td>
                  <input
                    type="text"
                    defaultValue={problem.display_id}
                    disabled={busy}
                    className="admin-problem-id-input"
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
                    min={0}
                    max={100}
                    defaultValue={problem.score ?? ''}
                    disabled={busy}
                    placeholder="默认"
                    onBlur={(event) => void update(problem.problem_id, {
                      score: event.target.value === '' ? null : Number(event.target.value),
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
                    onBlur={(event) => void update(problem.problem_id, {
                      submission_limit: event.target.value === '' ? null : Number(event.target.value),
                    })}
                  />
                </td>
                <td>
                  <button type="button" className="link-button danger" disabled={busy} onClick={() => void remove(problem.problem_id)}>
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
      <div className="page-header">
        <div>
          <div className="page-eyebrow">比赛管理</div>
          <h1 className="page-title">题目管理 · {data.contest.title}</h1>
        </div>
        <div className="contest-badges">
          <Link to={`/contest/${contestId}`} className="button button-secondary">返回总览</Link>
          <Link to={`/contest/${contestId}/standings`} className="button button-secondary">查看排行榜</Link>
        </div>
      </div>
      <ProblemManager contestId={contestId} problems={data.problems} onChanged={reload} />
    </div>
  )
}
