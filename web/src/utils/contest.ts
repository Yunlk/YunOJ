import type { Contest } from '../types'

export function contestModeLabel(mode: string): string {
  if (mode === 'ACM') return 'ACM'
  if (mode === 'OI') return 'OI'
  if (mode === 'IOI') return 'IOI'
  return mode
}

export function contestFeedbackLabel(feedback: string): string {
  if (feedback === 'blind') return '盲评'
  return '实时'
}

export function scoreModeLabel(mode: string): string {
  if (mode === 'all_or_nothing') return '整题通过才计分'
  if (mode === 'partial') return '按测试点部分计分'
  return mode
}

export type ContestPhase = 'upcoming' | 'running' | 'ended'

export function contestPhase(c: Contest, now = Date.now()): ContestPhase {
  const start = new Date(c.start_time).getTime()
  const end = new Date(c.end_time).getTime()
  if (now < start) return 'upcoming'
  if (now > end) return 'ended'
  return 'running'
}

export function phaseLabel(p: ContestPhase): string {
  if (p === 'upcoming') return '未开始'
  if (p === 'running') return '进行中'
  return '已结束'
}

export function phaseClass(p: ContestPhase): string {
  if (p === 'upcoming') return 'phase-upcoming'
  if (p === 'running') return 'phase-running'
  return 'phase-ended'
}

/** RFC3339 -> datetime-local 输入框值（本地时区） */
export function toLocalInput(s: string): string {
  if (!s) return ''
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** datetime-local 输入框值 -> RFC3339 */
export function fromLocalInput(s: string): string {
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return d.toISOString()
}

/** 距离比赛开始的分钟数（滚榜里的 solved_at） */
export function minutesSinceStart(solvedAt: string, startTime: string): number {
  const t = new Date(solvedAt).getTime() - new Date(startTime).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.round(t / 60000))
}

/** 队伍头像 URL；无头像返回 null（前端渲染首字母占位） */
export function teamAvatarUrl(contestId: number, teamId: number, avatar: string): string | null {
  if (!avatar) return null
  return `/api/contests/${contestId}/teams/${teamId}/avatar`
}
