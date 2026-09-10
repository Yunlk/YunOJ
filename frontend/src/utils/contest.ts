import type { Contest } from '../types'

export function contestModeLabel(mode: string): string {
  if (mode === 'ACM') return 'ACM'
  if (mode === 'OI') return 'OI'
  if (mode === 'IOI') return 'IOI'
  if (mode === 'CF') return 'Codeforces'
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

/**
 * 报名方式说明。maxTeamSize 为 0/未设置时不显示人数上限：
 * 历史比赛（如 186）的 registration_mode 落库为空串、max_team_size 为 0，
 * 直接拼「最多 0 人」会误导用户。
 */
export function registrationModeLabel(mode: string, maxTeamSize: number): string {
  const size = maxTeamSize > 1 ? `（最多 ${maxTeamSize} 人）` : ''
  if (mode === 'individual') return '个人'
  if (mode === 'team') return `队伍${size}`
  if (mode === 'both') return `个人或队伍${size}`
  return '报名方式未设置'
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

/** 距离比赛开始的分钟数（用于 ACM 榜单单元格）。 */
export function minutesSinceStart(solvedAt: string, startTime: string): number {
  const t = new Date(solvedAt).getTime() - new Date(startTime).getTime()
  if (Number.isNaN(t)) return 0
  return Math.max(0, Math.round(t / 60000))
}

/** 以 ICPC 榜单常用的紧凑格式显示通过时长。 */
export function formatContestDuration(solvedAt: string, startTime: string): string {
  const t = new Date(solvedAt).getTime() - new Date(startTime).getTime()
  if (Number.isNaN(t)) return '0min'
  const minutes = Math.max(0, t / 60000)
  const value = minutes >= 60 ? minutes / 60 : minutes
  const unit = minutes >= 60 ? 'h' : 'min'
  const text = value.toFixed(2).replace(/\.?(0+)$/, '')
  return `${text}${unit}`
}

/** 将 ACM 累计罚时（分钟）格式化为榜单中的总时长。 */
export function formatContestMinutes(minutes: number): string {
  const value = minutes >= 60 ? minutes / 60 : Math.max(0, minutes)
  const unit = minutes >= 60 ? 'h' : 'min'
  const text = value.toFixed(2).replace(/\.?(0+)$/, '')
  return `${text}${unit}`
}

/** 队伍头像 URL；无头像返回 null（前端渲染首字母占位） */
export function teamAvatarUrl(contestId: number, teamId: number, avatar: string): string | null {
  if (!avatar) return null
  return `/api/contests/${contestId}/teams/${teamId}/avatar`
}

// ---------- Codeforces 风格赛制 ----------

/** 衰减下限：比赛结束时保留初始分的比例（与后端 contest.CFMinScoreRatio 保持一致）。 */
export const CF_MIN_SCORE_RATIO = 0.3

/**
 * 计算 at 时刻提交可得的分数：开赛满分，线性衰减到比赛结束时的 30%。
 * 与后端 contest.CFDecayScore 同一公式，用于前端展示"当前分值"。
 */
export function cfDecayScore(initial: number, at: number, start: number, end: number): number {
  if (initial <= 0) return 0
  if (!(end > start)) return initial
  let ratio = 1
  if (at > start) {
    const fraction = Math.min(1, (at - start) / (end - start))
    ratio = 1 - (1 - CF_MIN_SCORE_RATIO) * fraction
  }
  const floor = Math.round(initial * CF_MIN_SCORE_RATIO)
  const score = Math.round(initial * ratio)
  return Math.min(initial, Math.max(floor, score))
}
