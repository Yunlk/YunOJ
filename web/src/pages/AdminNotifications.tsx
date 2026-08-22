import { FormEvent, useEffect, useState } from 'react'
import { createNotification, deleteNotification, extractError, getNotifications } from '../api'
import type { Notification } from '../types'

function formatTime(value: string) {
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

export default function AdminNotifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [kind, setKind] = useState('system')
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    try {
      setItems(await getNotifications())
    } catch (err) {
      setError(extractError(err))
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!title.trim() || !content.trim()) {
      setError('标题和内容不能为空')
      return
    }
    setSaving(true)
    setError('')
    try {
      const item = await createNotification({ title: title.trim(), content: content.trim(), kind })
      setItems((current) => [item, ...current])
      setTitle('')
      setContent('')
    } catch (err) {
      setError(extractError(err))
    } finally {
      setSaving(false)
    }
  }

  const remove = async (item: Notification) => {
    if (!window.confirm(`删除通知“${item.title}”？`)) return
    try {
      await deleteNotification(item.id)
      setItems((current) => current.filter((entry) => entry.id !== item.id))
    } catch (err) {
      setError(extractError(err))
    }
  }

  return (
    <div className="admin-notifications-page">
      <div className="page-header">
        <div>
          <p className="page-eyebrow">运营中心</p>
          <h1 className="page-title">全站通知</h1>
        </div>
      </div>
      {error && <div className="error-message">{error}</div>}
      <form className="card notification-compose" onSubmit={submit}>
        <div className="section-header"><h2>发布通知</h2><span>所有已登录用户都会在通知中心看到</span></div>
        <div className="form-row">
          <label>标题<input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={128} /></label>
          <label>类型<select value={kind} onChange={(event) => setKind(event.target.value)}><option value="system">系统</option><option value="announcement">公告</option><option value="maintenance">维护</option></select></label>
        </div>
        <label>内容<textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} maxLength={65536} /></label>
        <div className="form-actions"><button className="button button-primary" disabled={saving}>{saving ? '发布中…' : '发布通知'}</button></div>
      </form>
      <section className="card">
        <div className="section-header"><h2>已发布通知</h2><button className="button button-secondary" type="button" onClick={() => void load()}>刷新</button></div>
        <div className="notification-list">{items.length === 0 ? <div className="empty-state">暂无通知</div> : items.map((item) => <article className="notification-item" key={item.id}><div className="notification-item-head"><strong>{item.title}</strong><time>{formatTime(item.created_at)}</time></div><p>{item.content}</p><div className="notification-admin-meta"><small>{item.kind} · {item.author_name || '管理员'}</small><button className="button button-danger" type="button" onClick={() => void remove(item)}>删除</button></div></article>)}</div>
      </section>
    </div>
  )
}
