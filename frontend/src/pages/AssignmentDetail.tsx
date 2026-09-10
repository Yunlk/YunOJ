import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addAssignmentProblem, extractError, getAssignment } from '../api'
import type { AssignmentDetail as AssignmentDetailData } from '../types'
import { formatTime } from '../utils/format'

export default function AssignmentDetail() {
  const { id } = useParams()
  const [data, setData] = useState<AssignmentDetailData | null>(null)
  const [error, setError] = useState('')
  const [problemId, setProblemId] = useState('')
  const [maxScore, setMaxScore] = useState('100')
  useEffect(() => { getAssignment(Number(id)).then(setData).catch((err) => setError(extractError(err))) }, [id])
  const addProblem = async (event: React.FormEvent) => {
    event.preventDefault()
    const parsed = Number(problemId)
    if (!Number.isInteger(parsed) || parsed <= 0) { setError('请输入有效的题目 ID'); return }
    try {
      await addAssignmentProblem(Number(id), { problem_id: parsed, sort_order: data?.problems.length ?? 0, max_score: Math.max(1, Number(maxScore) || 100) })
      setProblemId('')
      const next = await getAssignment(Number(id))
      setData(next)
    } catch (err) { setError(extractError(err)) }
  }
  if (!data) return error ? <div className="error-message">{error}</div> : <div className="page-loading">作业加载中…</div>
  return (
    <div>
      <nav className="breadcrumb" aria-label="当前位置">
        <Link to={`/groups/${data.group.id}`}>{data.group.name}</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{data.assignment.title}</span>
      </nav>

      <header className="page-header page-header-standard">
        <div className="page-heading">
          <h1 className="page-title">{data.assignment.title}</h1>
          <p className="page-description">
            {data.assignment.kind === 'test' ? '测试' : '作业'} · 开始于 {formatTime(data.assignment.start_at)}
            {data.assignment.due_at ? ` · 截止 ${formatTime(data.assignment.due_at)}` : ''}
          </p>
        </div>
      </header>

      {error && <div className="error-message">{error}</div>}

      {data.assignment.description && (
        <div className="card admin-prewrap">{data.assignment.description}</div>
      )}

      {data.can_manage && (
        <form className="card" onSubmit={addProblem} aria-labelledby="assignment-add-problem-title">
          <div className="section-head">
            <h2 className="section-title" id="assignment-add-problem-title">添加题目</h2>
            <span className="section-hint">按题目 ID 添加</span>
          </div>
          <div className="toolbar">
            <span className="toolbar-label">题目 ID</span>
            <input value={problemId} onChange={(event) => setProblemId(event.target.value)} placeholder="题目 ID" inputMode="numeric" aria-label="题目 ID" />
            <span className="toolbar-label">满分</span>
            <input value={maxScore} onChange={(event) => setMaxScore(event.target.value)} placeholder="满分" inputMode="numeric" aria-label="满分" />
            <button className="button button-secondary" type="submit">添加到作业</button>
          </div>
        </form>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">题目</h2>
          <span className="section-hint">{data.problems.length} 道</span>
        </div>
        {data.problems.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">还没有添加题目</span>
            <span className="empty-state-hint">
              {data.can_manage ? '用上方表单按题目 ID 添加，学生就能从这里进入作答。' : '教师添加题目后，这里会显示题目列表与满分。'}
            </span>
          </div>
        ) : (
          <div className="table-frame">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="cell-tight" style={{ width: 72 }}>#</th>
                  <th>题目</th>
                  <th className="cell-right" style={{ width: 96 }}>满分</th>
                  <th className="cell-actions" style={{ width: 132 }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {data.problems.map((problem, index) => (
                  <tr key={problem.problem_id}>
                    <td className="cell-id">{index + 1}</td>
                    <td>
                      <Link to={`/problem/${problem.problem_id}?assignment_id=${data.assignment.id}`}>{problem.title}</Link>
                    </td>
                    <td className="cell-right cell-num">{problem.max_score}</td>
                    <td className="cell-actions">
                      <Link to={`/problem/${problem.problem_id}?assignment_id=${data.assignment.id}`} className="button button-primary button-sm">进入题目</Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {data.progress && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">完成情况</h2>
            <span className="section-hint">按最高分统计</span>
          </div>
          <div className="table-frame">
            <table className="data-table">
              <thead>
                <tr>
                  <th>学生</th>
                  <th className="cell-right" style={{ width: 140 }}>完成题数</th>
                  <th className="cell-right" style={{ width: 160 }}>最高分</th>
                </tr>
              </thead>
              <tbody>
                {data.progress.map((item) => (
                  <tr key={item.user_id}>
                    <td>{item.username}</td>
                    <td className="cell-right cell-num">{item.solved} / {item.problem_count}</td>
                    <td className="cell-right cell-num">{item.best_score} / {item.total_score}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  )
}
