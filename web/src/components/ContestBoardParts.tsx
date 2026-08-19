import type { ACMProblemState } from '../types'
import { formatContestDuration, teamAvatarUrl } from '../utils/contest'

/** 队伍头像（无头像时显示占位符）。 */
export function TeamAvatar({ contestId, teamId, avatar, size }: {
  contestId: number; teamId: number; avatar: string; size: 'sm' | 'lg'
}) {
  const url = teamAvatarUrl(contestId, teamId, avatar)
  const cls = size === 'lg' ? 'avatar-lg' : 'avatar-sm'
  if (!url) return <span className={`${cls} avatar-fallback`}>?</span>
  return <img src={url} alt="" className={cls} />
}

/**
 * ICPC 风格题目格：
 *   未提交：无底色；WA：浅红底 -N；AC：分值在上、通过时长在下；一血使用深绿底。
 * 排名仅在 AC 时变化（引擎语义），WA 红色负计数不影响排名。
 */
export function ACMCell({ state, startTime, score = 100, className = '' }: {
  state: ACMProblemState | undefined
  startTime: string
  score?: number
  className?: string
}) {
	const extraClass = className ? ` ${className}` : ''
  if (!state || (!state.solved && state.failed_attempts === 0)) {
    return <td className={`standings-cell${extraClass}`} />
  }
  if (state.solved) {
    const duration = state.solved_at ? formatContestDuration(state.solved_at, startTime) : ''
    return (
      <td className={`standings-cell ac-cell${state.first_blood ? ' fb-cell' : ''}${extraClass}`} title={state.first_blood ? '一血！全场第一个通过' : `通过时长 ${duration}`}>
        <span className="cell-score">{score}</span>
        <span className="cell-time">({duration})</span>
      </td>
    )
  }
  return (
    <td className={`standings-cell wa-cell${extraClass}`} title={`${state.failed_attempts} 次未通过尝试`}>
      -{state.failed_attempts}
    </td>
  )
}
