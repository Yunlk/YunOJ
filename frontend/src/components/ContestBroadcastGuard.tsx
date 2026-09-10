import { useCallback, useEffect, useMemo, useState } from 'react'
import { getContestCommunications, getContestRegistration } from '../api'
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

/**
 * 参赛者在任何比赛子页面都必须确认未读的出题组广播。
 *
 * `/contests/{id}/communications` 只对「已报名或管理员」开放，未报名请求必然 403，
 * 所以先做一次轻量的报名接口确认参赛身份，再决定是否轮询广播：
 * - 管理员 → 直接放行（不看广播）；
 * - 已报名 → 正常轮询，行为与以前一致；
 * - 未报名 / 未登录 / 身份确认失败 → 完全不发答疑请求，改为一句报名提示。
 *
 * 状态判定刻意写成「只有确认已报名才置 true」，避免出现「既没确认又不是 false」的中间态：
 * 那样会让提示不出现、也没有任何请求，页面看起来像没功能。
 */
export default function ContestBroadcastGuard({ contestId }: { contestId: number }) {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const [announcements, setAnnouncements] = useState<ContestAnnouncement[]>([])
  const [readVersion, setReadVersion] = useState(0)
  const [registered, setRegistered] = useState(false)

  useEffect(() => {
    if (!user || isAdmin || !contestId) {
      setRegistered(false)
      return
    }
    let cancelled = false
    getContestRegistration(contestId)
      .then((data) => {
        if (cancelled) return
        setRegistered(data.is_registered)
      })
      .catch(() => {
        if (!cancelled) setRegistered(false)
      })
    return () => {
      cancelled = true
    }
  }, [user, isAdmin, contestId])

  const load = useCallback(async () => {
    // 只有确认已报名的参赛者才去读广播，避免未报名用户拿到 403
    if (!registered || !user || isAdmin || !contestId) return
    try {
      const data = await getContestCommunications(contestId)
      setAnnouncements(data.announcements)
    } catch {
      // 身份或网络变化导致的失败不影响正常页面
    }
  }, [contestId, user, isAdmin, registered])

  useEffect(() => {
    if (!registered) {
      setAnnouncements([])
      return
    }
    void load()
    const timer = window.setInterval(() => void load(), 3000)
    return () => window.clearInterval(timer)
  }, [load, registered])

  const unread = useMemo(
    () => (user ? announcements.filter((item) => !isRead(user.id, contestId, item)) : []),
    [announcements, contestId, readVersion, user],
  )
  const current = unread[0]

  const acknowledge = () => {
    if (!current || !user) return
    try {
      localStorage.setItem(readKey(user.id, contestId, current.id), '1')
    } catch {
      // 存储被禁用时仍允许继续阅读，下一次页面加载会再次提醒。
    }
    setReadVersion((version) => version + 1)
  }

  if (current && user && !isAdmin) {
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

  // 已登录、非管理员、未报名（或身份尚未确认）：给出可见入口而不是空白
  if (user && !isAdmin && !registered) {
    return (
      <p className="contest-broadcast-hint" role="note">
        报名本场比赛后可查看出题组广播与题目答疑。
      </p>
    )
  }

  return null
}
