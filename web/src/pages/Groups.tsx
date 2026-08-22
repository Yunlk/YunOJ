import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createGroup, extractError, getGroups } from '../api'
import { useAuth } from '../context/AuthContext'
import type { Group } from '../types'

export default function Groups() {
  const { user } = useAuth()
  const [items, setItems] = useState<Group[]>([])
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const canCreate = user?.role === 'admin' || user?.role === 'teacher'

  const load = () => {
    setLoading(true)
    getGroups().then(setItems).catch((err) => setError(extractError(err))).finally(() => setLoading(false))
  }
  useEffect(() => { load() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setError('')
    try {
      const group = await createGroup({ name, description })
      setItems((current) => [group, ...current])
      setName(''); setDescription('')
    } catch (err) { setError(extractError(err)) }
  }

  return <div className="groups-page">
    <div className="page-header"><div><div className="page-eyebrow">教学空间</div><h1 className="page-title">班级与团体</h1></div></div>
    {error && <div className="error-message">{error}</div>}
    {canCreate && <form className="card group-create-form" onSubmit={submit}><h2>创建班级 / 团体</h2><div className="form-row"><div className="form-group"><label htmlFor="group-name">名称</label><input id="group-name" value={name} onChange={(event) => setName(event.target.value)} placeholder="如：2026 算法基础班" /></div><div className="form-group"><label htmlFor="group-description">说明</label><input id="group-description" value={description} onChange={(event) => setDescription(event.target.value)} placeholder="选填" /></div></div><button className="button button-primary" type="submit" disabled={!name.trim()}>创建</button></form>}
    {loading ? <div className="page-loading">加载中…</div> : items.length === 0 ? <div className="empty-state">暂无班级或团体</div> : <div className="group-grid">{items.map((group) => <Link className="group-card" to={`/groups/${group.id}`} key={group.id}><div className="group-card-heading"><h2>{group.name}</h2><span>{group.member_count} 人</span></div><p>{group.description || '暂无说明'}</p><small>负责人：{group.owner_name}</small></Link>)}</div>}
  </div>
}
