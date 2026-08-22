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
  return <div className="assignment-detail-page"><div className="page-header"><div><Link to={`/groups/${data.group.id}`} className="back-link">← {data.group.name}</Link><h1 className="page-title">{data.assignment.title}</h1><p className="muted">{data.assignment.kind === 'test' ? '测试' : '作业'} · 开始于 {formatTime(data.assignment.start_at)}{data.assignment.due_at ? ` · 截止 ${formatTime(data.assignment.due_at)}` : ''}</p></div></div>{error && <div className="error-message">{error}</div>}{data.assignment.description && <div className="card assignment-description">{data.assignment.description}</div>}{data.can_manage && <form className="card assignment-add-form" onSubmit={addProblem}><div className="section-header"><h2>添加题目</h2><span className="muted">按题目 ID 添加</span></div><div className="form-row"><input value={problemId} onChange={(event) => setProblemId(event.target.value)} placeholder="题目 ID" inputMode="numeric" /><input value={maxScore} onChange={(event) => setMaxScore(event.target.value)} placeholder="满分" inputMode="numeric" /></div><button className="button button-secondary" type="submit">添加到作业</button></form>}<section className="card"><div className="section-header"><h2>题目</h2><span className="muted">{data.problems.length} 道</span></div>{data.problems.length === 0 ? <p className="muted">教师还没有添加题目。</p> : <div className="assignment-problem-list">{data.problems.map((problem, index) => <Link to={`/problem/${problem.problem_id}?assignment_id=${data.assignment.id}`} className="assignment-problem-item" key={problem.problem_id}><span className="assignment-problem-index">{index + 1}</span><span><strong>{problem.title}</strong><small>满分 {problem.max_score}</small></span><span>进入题目 →</span></Link>)}</div>}</section>{data.progress && <section className="card"><div className="section-header"><h2>完成情况</h2><span className="muted">按最高分统计</span></div><table className="data-table"><thead><tr><th>学生</th><th>完成题数</th><th>最高分</th></tr></thead><tbody>{data.progress.map((item) => <tr key={item.user_id}><td>{item.username}</td><td>{item.solved} / {item.problem_count}</td><td>{item.best_score} / {item.total_score}</td></tr>)}</tbody></table></section>}</div>
}
