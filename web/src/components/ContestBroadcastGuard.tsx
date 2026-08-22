import { useCallback, useEffect, useMemo, useState } from 'react'
import { getContestCommunications } from '../api'
import Markdown from './Markdown'
import { useAuth } from '../context/AuthContext'
import type { ContestAnnouncement } from '../types'

const READ_PREFIX = 'yunoj:contest-broadcast-read:v1'

function readKey(userId: number, contestId: number, announcementId: number): string {
  return `${READ_PREFIX}:${userId}:${contestId}:${announcementId}`
}

function isRead(userId: number, contestId: number, announcement: ContestAnnouncement): boolean {
  try {
    return localStorage.getItem(readKey(userId, contestId, announcement.id)) === '1'
  } catch {
    return false
  }
}

/** 参赛者在任何比赛子页面都必须确认未读的出题组广播。 */
export default function ContestBroadcastGuard({ contestId }: { contestId: number }) {
  const { user } = useAuth()
  const [announcements, setAnnouncements] = useState<ContestAnnouncement[]>([])
  const [readVersion, setReadVersion] = useState(0)

  const load = useCallback(async () => {
    if (!user || user.role === 'admin' || !contestId) return
    try {
      const data = await getContestCommunications(contestId)
      setAnnouncements(data.announcements)
    } catch {
      // 未报名用户和比赛设置页不应因为通信接口的 401/403 影响正常页面。
    }
  }, [contestId, user])

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load])

  const unread = useMemo(
    () => user ? announcements.filter((item) => !isRead(user.id, contestId, item)) : [],
    [announcements, contestId, readVersion, user],
  )
  const current = unread[0]

  if (!user || user.role === 'admin' || !current) return null

  const acknowledge = () => {
    try {
      localStorage.setItem(readKey(user.id, contestId, current.id), '1')
    } catch {
      // 存储被禁用时仍允许继续阅读，下一次页面加载会再次提醒。
    }
    setReadVersion((version) => version + 1)
  }

  return (
    <div className="contest-broadcast-overlay" role="dialog" aria-modal="true" aria-live="assertive">
      <div className="contest-broadcast-modal">
        <div className="contest-broadcast-kicker">出题组广播 · {unread.length} 条未读</div>
        <h2>{current.title || '比赛重要通知'}</h2>
        <div className="contest-broadcast-content"><Markdown>{current.content}</Markdown></div>
        <div className="contest-broadcast-footer">
          <span className="muted">阅读后才能继续操作比赛页面</span>
          <button type="button" className="button button-primary" onClick={acknowledge}>我已阅读，继续比赛</button>
        </div>
      </div>
    </div>
  )
}
