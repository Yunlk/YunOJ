import type { Contest } from '../types'

export function contestModeLabel(mode: string): string {
  if (mode === 'acm') return 'ACM'
  if (mode === 'oi') return 'OI'
  if (mode === 'ioi') return 'IOI'
  return mode
}

export function contestFeedbackLabel(feedback: string): string {
  if (feedback === 'blind') return '盲评'
  return '实时'
}

export function scoreModeLabel(mode: string): string {
  if (mode === 'best') return '取最优'
  return '取最后一次'
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
