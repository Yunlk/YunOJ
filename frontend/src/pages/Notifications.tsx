import { useEffect, useMemo, useState } from 'react'
import { extractError, getNotifications, markAllNotificationsRead, markNotificationRead } from '../api'
import PageHeader from '../components/PageHeader'
import type { Notification } from '../types'
import { formatTime } from '../utils/format'

const MINUTE = 60 * 1000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** 友好时间：今天/昨天/几天前，超过一周回落到日期。 */
function friendlyTime(value: string): string {
  const time = new Date(value).getTime()
  if (Number.isNaN(time)) return value
  const diff = Date.now() - time
  if (diff < 0) return formatTime(value)
  if (diff < MINUTE) return '刚刚'
  if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`
  if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`
  if (diff < 2 * DAY) return '昨天'
  if (diff < 7 * DAY) return `${Math.floor(diff / DAY)} 天前`
  return formatTime(value).slice(0, 10)
}

const KIND_LABELS: Record<string, string> = {
  system: '系统',
  contest: '比赛',
  assignment: '作业',
  group: '教学空间',
  reply: '回复',
  announcement: '公告',
}

const kindLabel = (kind: string): string => KIND_LABELS[kind] ?? (kind || '通知')

export default function Notifications() {
  const [items, setItems] = useState<Notification[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busyId, setBusyId] = useState<number | null>(null)
  const [markingAll, setMarkingAll] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    getNotifications()
      .then((data) => { if (!cancelled) setItems(data) })
      .catch((err) => { if (!cancelled) setError(extractError(err)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  const unreadCount = useMemo(() => items.filter((item) => !item.read).length, [items])
  const unread = useMemo(() => items.filter((item) => !item.read), [items])

  const markOne = async (item: Notification) => {
    if (item.read) return
    setBusyId(item.id)
    setError('')
    try {
      await markNotificationRead(item.id)
      setItems((current) => current.map((value) => (value.id === item.id ? { ...value, read: true } : value)))
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusyId(null)
    }
  }

  // 一次请求完成批量已读；成功后本地全部置为已读，未读数随之归零
  const markAll = async () => {
    if (unread.length === 0) return
    setMarkingAll(true)
    setError('')
    try {
      await markAllNotificationsRead()
      setItems((current) => current.map((value) => ({ ...value, read: true })))
    } catch (err) {
      setError(extractError(err))
      try {
        setItems(await getNotifications())
      } catch {
        /* 重新拉取失败时保留原列表，避免误报已读 */
      }
    } finally {
      setMarkingAll(false)
    }
  }

  return (
    <div className="notifications-page">
      <PageHeader
        title="通知中心"
        description="查看系统、比赛和教学空间发来的消息。"
        actions={items.length > 0 && (
          <button
            type="button"
            className="button button-secondary button-sm"
            disabled={unreadCount === 0 || markingAll}
            onClick={() => void markAll()}
          >
            {markingAll ? '处理中…' : `全部标为已读${unreadCount > 0 ? ` (${unreadCount})` : ''}`}
          </button>
        )}
      />

      {error && <div className="error-message">{error}</div>}

      <div className="table-summary">
        <span>
          {loading ? '通知加载中…' : `共 ${items.length} 条通知，${unreadCount} 条未读`}
        </span>
      </div>

      {!loading && items.length === 0 ? (
        <div className="empty-state">
          <span className="empty-state-title">暂无通知</span>
          <span className="empty-state-hint">系统消息、比赛公告和教学空间通知都会出现在这里。</span>
        </div>
      ) : (
        <ul className="nt-list">
          {items.map((item) => (
            <li key={item.id} className={`nt-item ${item.read ? '' : 'nt-item-unread'}`.trim()}>
              <span className="nt-dot" aria-hidden="true" />
              <div className="nt-body">
                <div className="nt-head">
                  {!item.read && <span className="visually-hidden">未读：</span>}
                  <strong className="nt-title">{item.title}</strong>
                  {!item.read && <span className="badge badge-info">未读</span>}
                  <time className="nt-time" dateTime={item.created_at} title={formatTime(item.created_at)}>
                    {friendlyTime(item.created_at)}
                  </time>
                </div>
                {item.content && <p className="nt-content">{item.content}</p>}
                <div className="nt-meta">
                  <span className="badge">{kindLabel(item.kind)}</span>
                  {item.author_name && <span className="pf-muted">来自 {item.author_name}</span>}
                  {!item.read && (
                    <button
                      type="button"
                      className="button button-ghost button-sm"
                      disabled={busyId === item.id}
                      aria-label={`标为已读：${item.title}`}
                      onClick={() => void markOne(item)}
                    >
                      {busyId === item.id ? '处理中…' : '标为已读'}
                    </button>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
