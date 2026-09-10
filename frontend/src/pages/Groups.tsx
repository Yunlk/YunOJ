import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { createGroup, extractError, getGroups } from '../api'
import { useAuth } from '../context/AuthContext'
import type { Group } from '../types'
import PageHeader from '../components/PageHeader'

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

  return (
    <div>
      <PageHeader eyebrow="教学空间" title="班级与团体" description="组织课程、作业与测试，集中查看成员完成情况。" />

      {error && <div className="error-message">{error}</div>}

      {canCreate && (
        <form className="card" onSubmit={submit} aria-labelledby="group-create-title">
          <div className="section-head">
            <h2 className="section-title" id="group-create-title">创建班级 / 团体</h2>
            <span className="section-hint">名称必填，说明可在创建后补充</span>
          </div>
          <div className="layout-split">
            <div className="form-group">
              <label htmlFor="group-name">名称</label>
              <input
                id="group-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="如：2026 算法基础班"
              />
            </div>
            <div className="form-group">
              <label htmlFor="group-description">说明</label>
              <input
                id="group-description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="选填"
              />
            </div>
          </div>
          <button className="button button-primary" type="submit" disabled={!name.trim()}>创建</button>
        </form>
      )}

      {loading ? (
        <div className="page-loading">加载中…</div>
      ) : items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-title">暂无班级或团体</span>
          <span className="empty-state-hint">
            {canCreate ? '用上方表单创建第一个班级，再在班级详情里添加成员与作业。' : '等待教师或管理员创建班级后再加入。'}
          </span>
        </div>
      ) : (
        <>
          <div className="table-summary">
            <span>共 {items.length} 个班级或团体</span>
          </div>
          <div className="table-frame">
            <table className="data-table">
              <thead>
                <tr>
                  <th style={{ width: 280 }}>名称</th>
                  <th style={{ width: 96 }}>成员</th>
                  <th style={{ width: 160 }}>负责人</th>
                  <th>说明</th>
                </tr>
              </thead>
              <tbody>
                {items.map((group) => (
                  <tr key={group.id}>
                    <td><Link to={`/groups/${group.id}`}>{group.name}</Link></td>
                    <td className="cell-num">{group.member_count}</td>
                    <td>{group.owner_name}</td>
                    <td>{group.description || '暂无说明'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
