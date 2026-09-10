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

  // 加载失败（多为非成员访问私有班级的 403）：给整页状态与出口，而不是只抛一行红字
  if (!data) {
    if (!error) return <div className="page-loading">班级加载中…</div>
    return (
      <div className="state-page">
        <h1>无法访问该班级</h1>
        <p>{error}。班级与团体仅对成员与教师开放，请确认你已被加入该班级。</p>
        <div className="state-page-actions">
          <Link to="/groups" className="button button-primary">
            返回班级与团体
          </Link>
        </div>
      </div>
    )
  }
  const canCreate = data.can_manage && (user?.role === 'teacher' || user?.role === 'admin')
  return (
    <div>
      <nav className="breadcrumb" aria-label="当前位置">
        <Link to="/groups">班级与团体</Link>
        <span className="breadcrumb-sep">/</span>
        <span>{data.group.name}</span>
      </nav>

      <header className="page-header page-header-standard">
        <div className="page-heading">
          <h1 className="page-title">{data.group.name}</h1>
          <p className="page-description">{data.group.description || '暂无说明'} · {data.group.member_count} 位成员</p>
        </div>
        {canCreate && (
          <div className="page-actions">
            <button className="button button-primary" type="button" onClick={() => setShowCreate((value) => !value)}>发布作业</button>
          </div>
        )}
      </header>

      {error && <div className="error-message">{error}</div>}

      {showCreate && (
        <form className="card" onSubmit={submit} aria-labelledby="assignment-create-title">
          <div className="section-head">
            <h2 className="section-title" id="assignment-create-title">创建作业或测试</h2>
          </div>
          <div className="form-group">
            <label htmlFor="assignment-title">标题</label>
            <input id="assignment-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="作业或测试标题" />
          </div>
          <div className="layout-split">
            <div className="form-group">
              <label htmlFor="assignment-kind">类型</label>
              <select id="assignment-kind" value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}>
                <option value="assignment">作业</option>
                <option value="test">测试</option>
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="assignment-description">说明</label>
              <input id="assignment-description" value={description} onChange={(event) => setDescription(event.target.value)} />
            </div>
          </div>
          <button className="button button-primary" type="submit" disabled={!title.trim()}>发布</button>
        </form>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">作业与测试</h2>
          <span className="section-hint">{data.assignments.length} 项</span>
        </div>
        {data.assignments.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">还没有发布作业</span>
            <span className="empty-state-hint">
              {canCreate ? '点「发布作业」创建第一份作业或测试，学生就能在班级里看到。' : '教师发布作业后，这里会显示作业与测试列表。'}
            </span>
            {canCreate && (
              <button className="button button-primary button-sm" type="button" onClick={() => setShowCreate(true)}>发布作业</button>
            )}
          </div>
        ) : (
          <div className="table-frame">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 300 }}>标题</th>
                  <th style={{ width: 88 }}>类型</th>
                  <th style={{ width: 96 }}>题目数</th>
                  <th style={{ width: 176 }}>开始时间</th>
                  <th style={{ width: 96 }}>状态</th>
                </tr>
              </thead>
              <tbody>
                {data.assignments.map((item) => (
                  <tr key={item.id}>
                    <td><Link to={`/assignments/${item.id}`}>{item.title}</Link></td>
                    <td><span className="tag-chip">{item.kind === 'test' ? '测试' : '作业'}</span></td>
                    <td className="cell-num">{item.problem_count}</td>
                    <td className="cell-num">{formatTime(item.start_at)}</td>
                    <td>
                      <span className={item.published ? 'badge badge-positive' : 'badge'}>{item.published ? '已发布' : '草稿'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">成员</h2>
          <span className="section-hint">{data.members.length} 人</span>
        </div>
        {canCreate && (
          <form className="toolbar" onSubmit={addMember}>
            <span className="toolbar-label">添加成员</span>
            <input aria-label="用户 ID" value={memberId} onChange={(event) => setMemberId(event.target.value)} placeholder="用户 ID" inputMode="numeric" />
            <select aria-label="成员角色" value={memberRole} onChange={(event) => setMemberRole(event.target.value as typeof memberRole)}>
              <option value="student">学生</option>
              <option value="teacher">教师</option>
            </select>
            <button className="button button-secondary" type="submit">添加</button>
          </form>
        )}
        {data.members.length === 0 ? (
          <div className="empty-state">
            <span className="empty-state-title">还没有成员</span>
            <span className="empty-state-hint">
              {canCreate ? '按用户 ID 添加学生或教师，成员即可看到班级作业。' : '教师添加成员后，这里会显示班级成员。'}
            </span>
          </div>
        ) : (
          <div className="table-frame">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 200 }}>用户名</th>
                  <th>邮箱</th>
                  <th style={{ width: 96 }}>角色</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((member) => (
                  <tr key={member.user_id}>
                    <td>{member.username}</td>
                    <td className="cell-id">{member.email}</td>
                    <td>{member.role === 'teacher' ? '教师' : '学生'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
