import { useEffect, useState } from 'react'
import { extractError, getAdminUsers, updateAdminUser } from '../api'
import type { User } from '../types'

export default function AdminUsers() {
  const [items, setItems] = useState<User[]>([])
  const [keyword, setKeyword] = useState('')
  const [role, setRole] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState<number | null>(null)
  const [resetting, setResetting] = useState<number | null>(null)

  const load = () => {
    setLoading(true)
    getAdminUsers({ page: 1, size: 100, keyword: keyword || undefined, role: role || undefined })
      .then((data) => setItems(data.items))
      .catch((err) => setError(extractError(err)))
      .finally(() => setLoading(false))
  }

  useEffect(() => { load() }, [role]) // eslint-disable-line react-hooks/exhaustive-deps

  const save = async (user: User, next: Partial<User>) => {
    setSaving(user.id)
    setError('')
    try {
      const updated = await updateAdminUser(user.id, {
        role: next.role ?? user.role,
        disabled: next.disabled ?? user.disabled,
      })
      setItems((current) => current.map((item) => item.id === updated.id ? updated : item))
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSaving(null)
    }
  }

  const resetPassword = async (user: User) => {
    const password = window.prompt(`为 ${user.username} 设置新密码（至少 6 位）`)
    if (password === null) return
    if (password.length < 6) {
      setError('密码至少需要 6 位')
      return
    }
    setResetting(user.id)
    setError('')
    try {
      await updateAdminUser(user.id, { role: user.role, disabled: user.disabled, password })
    } catch (err) {
      setError(extractError(err))
    } finally {
      setResetting(null)
    }
  }

  return (
    <div className="admin-users-page">
      <div className="page-header"><div><div className="page-eyebrow">平台管理</div><h1 className="page-title">用户与权限</h1></div></div>
      <form className="filter-bar" onSubmit={(event) => { event.preventDefault(); load() }}>
        <input className="filter-input" value={keyword} onChange={(event) => setKeyword(event.target.value)} placeholder="用户名或邮箱" />
        <select className="select-input" value={role} onChange={(event) => setRole(event.target.value)}>
          <option value="">全部角色</option><option value="admin">管理员</option><option value="teacher">教师</option><option value="student">学生</option>
        </select>
        <button className="button button-primary" type="submit">筛选</button>
      </form>
      {error && <div className="error-message">{error}</div>}
      <table className="data-table admin-users-table">
        <thead><tr><th>用户</th><th>邮箱</th><th>角色</th><th>状态</th><th>加入时间</th><th>操作</th></tr></thead>
        <tbody>{loading ? <tr><td colSpan={6} className="table-empty">加载中…</td></tr> : items.length === 0 ? <tr><td colSpan={6} className="table-empty">暂无用户</td></tr> : items.map((user) => (
          <tr key={user.id}>
            <td><strong>{user.username}</strong><small className="table-subtext">#{user.id}</small></td>
            <td>{user.email}</td>
            <td><select value={user.role === 'user' ? 'student' : user.role} disabled={saving === user.id} onChange={(event) => void save(user, { role: event.target.value as User['role'] })}><option value="admin">管理员</option><option value="teacher">教师</option><option value="student">学生</option></select></td>
            <td><button type="button" className={`status-toggle ${user.disabled ? 'disabled' : 'enabled'}`} disabled={saving === user.id} onClick={() => void save(user, { disabled: !user.disabled })}>{user.disabled ? '已禁用' : '正常'}</button></td>
            <td className="mono">{user.created_at.slice(0, 10)}</td>
            <td><button className="button button-secondary button-small" type="button" disabled={resetting === user.id} onClick={() => void resetPassword(user)}>{resetting === user.id ? '保存中…' : '重置密码'}</button></td>
          </tr>
        ))}</tbody>
      </table>
    </div>
  )
}
