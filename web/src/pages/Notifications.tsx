import { useEffect, useState } from 'react'
import { extractError, getNotifications, markNotificationRead } from '../api'
import type { Notification } from '../types'
import { formatTime } from '../utils/format'

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [error, setError] = useState('')
  useEffect(() => { getNotifications().then(setItems).catch((err) => setError(extractError(err))) }, [])
  const read = async (item: Notification) => {
    if (item.read) return
    try { await markNotificationRead(item.id); setItems((current) => current.map((value) => value.id === item.id ? { ...value, read: true } : value)) } catch (err) { setError(extractError(err)) }
  }
  return <div className="notifications-page"><div className="page-header"><h1 className="page-title">通知中心</h1></div>{error && <div className="error-message">{error}</div>}<div className="notification-list">{items.length === 0 ? <div className="empty-state">暂无通知</div> : items.map((item) => <article className={`notification-item ${item.read ? '' : 'unread'}`} key={item.id} onClick={() => void read(item)}><div className="notification-item-head"><strong>{item.title}</strong><time>{formatTime(item.created_at)}</time></div><p>{item.content}</p><small>{item.kind} · {item.read ? '已读' : '未读'}</small></article>)}</div></div>
}
