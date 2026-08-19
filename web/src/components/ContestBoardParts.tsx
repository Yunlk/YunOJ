import type { ACMProblemState } from '../types'
import { minutesSinceStart, teamAvatarUrl } from '../utils/contest'

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
 *   未提交：无底色；WA：浅红底 -N；AC：浅绿底 ✓分钟；一血：深绿底白字 ★分钟。
 * 排名仅在 AC 时变化（引擎语义），WA 红色负计数不影响排名。
 */
export function ACMCell({ state, startTime }: { state: ACMProblemState | undefined; startTime: string }) {
  if (!state || (!state.solved && state.failed_attempts === 0)) {
    return <td className="standings-cell" />
  }
  if (state.solved) {
    const mins = state.solved_at ? minutesSinceStart(state.solved_at, startTime) : null
    if (state.first_blood) {
      return (
        <td className="standings-cell fb-cell" title="一血！全场第一个通过">
          ★ {mins ?? ''}
        </td>
      )
    }
    return (
      <td className="standings-cell ac-cell" title={`通过于第 ${mins ?? '?'} 分钟`}>
        ✓ {mins ?? ''}
      </td>
    )
  }
  return (
    <td className="standings-cell wa-cell" title={`${state.failed_attempts} 次未通过尝试`}>
      -{state.failed_attempts}
    </td>
  )
}
