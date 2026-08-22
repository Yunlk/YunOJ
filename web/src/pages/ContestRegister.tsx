import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { addContestMember, extractError, getContestRegistration, registerContest, removeContestMember } from '../api'
import { useAuth } from '../context/AuthContext'
import type { ContestRegistration } from '../types'

export default function ContestRegister() {
  const { id } = useParams()
  const contestId = Number(id)
  const { user } = useAuth()
  const [data, setData] = useState<ContestRegistration | null>(null)
  const [name, setName] = useState('')
  const [memberName, setMemberName] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => getContestRegistration(contestId).then((item) => {
    setData(item)
    if (!name && user) setName(user.username)
  }).catch((err) => setError(extractError(err)))
  useEffect(() => { load() }, [contestId])

  if (!user) return <div className="contest-register-page"><div className="card"><p>请先登录后报名。</p><Link className="button button-primary" to="/login">去登录</Link></div></div>
  if (!data) return <div className="page-loading">报名信息加载中…</div>

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setBusy(true); setError('')
    try { await registerContest(contestId, name.trim()); await load() } catch (err) { setError(extractError(err)) } finally { setBusy(false) }
  }
  const teamId = data.team?.team_id
  const addMember = async (event: FormEvent) => {
    event.preventDefault()
    if (!teamId || !memberName.trim()) return
    setBusy(true); setError('')
    try { await addContestMember(contestId, teamId, { username: memberName.trim() }); setMemberName(''); await load() } catch (err) { setError(extractError(err)) } finally { setBusy(false) }
  }
  return (
    <div className="contest-register-page">
      <div className="page-header"><div><span className="eyebrow">比赛报名</span><h1 className="page-title">{data.contest.title}</h1></div><Link className="button button-secondary" to={`/contest/${contestId}`}>返回比赛</Link></div>
      <div className="contest-register-grid">
        <section className="card">
          <h2>报名方式</h2>
          <p className="muted">{data.registration_mode === 'individual' ? '个人报名' : data.registration_mode === 'team' ? `队伍报名，最多 ${data.max_team_size} 人` : `个人或队伍报名，队伍最多 ${data.max_team_size} 人`}</p>
          {!data.is_registered ? <form onSubmit={submit} className="form-stack"><label>报名名称<input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="个人名或队伍名" /></label><button className="button button-primary" disabled={busy}>{busy ? '提交中…' : '确认报名'}</button></form> : <div className="registration-success">已报名：<strong>{data.team?.team_name}</strong></div>}
        </section>
        {data.is_registered && data.team && <section className="card"><h2>队伍成员</h2><div className="team-member-list">{data.members.map((member) => <div className="team-member-row" key={member.user_id}><span>{member.username}</span><span className="muted">{member.is_captain ? '队长' : '成员'}</span>{data.team?.is_captain && !member.is_captain && <button className="button button-link" onClick={() => removeContestMember(contestId, data.team!.team_id, member.user_id).then(load).catch((err) => setError(extractError(err)))}>移除</button>}</div>)}</div>{data.team.is_captain && data.allow_team_edit && data.registration_mode !== 'individual' && <form onSubmit={addMember} className="inline-form"><input value={memberName} onChange={(e) => setMemberName(e.target.value)} placeholder="输入用户名添加成员" /><button className="button button-secondary" disabled={busy}>添加</button></form>}<p className="muted">成员的提交会统一计入本队排行榜。</p></section>}
      </div>
      {error && <div className="error-message">{error}</div>}
    </div>
  )
}
