import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addGroupMember, createAssignment, extractError, getGroup } from '../api'
import { useAuth } from '../context/AuthContext'
import type { GroupDetail as GroupDetailData } from '../types'
import { formatTime } from '../utils/format'

export default function GroupDetail() {
  const { id } = useParams()
  const { user } = useAuth()
  const [data, setData] = useState<GroupDetailData | null>(null)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [kind, setKind] = useState<'assignment' | 'test'>('assignment')
  const [memberId, setMemberId] = useState('')
  const [memberRole, setMemberRole] = useState<'student' | 'teacher'>('student')

  const load = () => getGroup(Number(id)).then(setData).catch((err) => setError(extractError(err)))
  useEffect(() => { void load() }, [id])

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    try {
      await createAssignment(Number(id), { title, description, kind, start_at: new Date().toISOString(), published: true })
      setTitle(''); setDescription(''); setShowCreate(false); await load()
    } catch (err) { setError(extractError(err)) }
  }

  const addMember = async (event: React.FormEvent) => {
    event.preventDefault()
    const userId = Number(memberId)
    if (!Number.isInteger(userId) || userId <= 0) {
      setError('请输入有效的用户 ID')
      return
    }
    try {
      await addGroupMember(Number(id), { user_id: userId, role: memberRole })
      setMemberId('')
      await load()
    } catch (err) { setError(extractError(err)) }
  }

  if (!data) return error ? <div className="error-message">{error}</div> : <div className="page-loading">班级加载中…</div>
  const canCreate = data.can_manage && (user?.role === 'teacher' || user?.role === 'admin')
  return <div className="group-detail-page">
    <div className="page-header"><div><Link to="/groups" className="back-link">← 班级与团体</Link><h1 className="page-title">{data.group.name}</h1><p className="muted">{data.group.description || '暂无说明'} · {data.group.member_count} 位成员</p></div>{canCreate && <button className="button button-primary" type="button" onClick={() => setShowCreate((value) => !value)}>发布作业</button>}</div>
    {error && <div className="error-message">{error}</div>}
    {showCreate && <form className="card form-card" onSubmit={submit}><div className="form-group"><label htmlFor="assignment-title">标题</label><input id="assignment-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="作业或测试标题" /></div><div className="form-row"><div className="form-group"><label htmlFor="assignment-kind">类型</label><select id="assignment-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="assignment">作业</option><option value="test">测试</option></select></div><div className="form-group"><label htmlFor="assignment-description">说明</label><input id="assignment-description" value={description} onChange={(event) => setDescription(event.target.value)} /></div></div><button className="button button-primary" type="submit" disabled={!title.trim()}>发布</button></form>}
    <div className="group-detail-grid"><section className="card"><div className="section-header"><h2>作业与测试</h2><span className="muted">{data.assignments.length} 项</span></div>{data.assignments.length === 0 ? <p className="muted">还没有发布作业。</p> : <div className="assignment-list">{data.assignments.map((item) => <Link to={`/assignments/${item.id}`} className="assignment-item" key={item.id}><span><strong>{item.title}</strong><small>{item.kind === 'test' ? '测试' : '作业'} · {item.problem_count} 道题 · {formatTime(item.start_at)}</small></span><span className={item.published ? 'assignment-published' : 'assignment-draft'}>{item.published ? '已发布' : '草稿'}</span></Link>)}</div>}</section><section className="card"><div className="section-header"><h2>成员</h2><span className="muted">{data.members.length} 人</span></div>{canCreate && <form className="member-add-form" onSubmit={addMember}><input value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder="用户 ID" inputMode="numeric" /><select value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}><option value="student">学生</option><option value="teacher">教师</option></select><button className="button button-secondary" type="submit">添加</button></form>}<div className="member-list">{data.members.map((member) => <div className="member-item" key={member.user_id}><span><strong>{member.username}</strong><small>{member.email}</small></span><span className="muted">{member.role === 'teacher' ? '教师' : '学生'}</span></div>)}</div></section></div>
  </div>
}
