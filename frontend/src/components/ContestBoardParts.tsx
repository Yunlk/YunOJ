import type { ACMProblemState } from '../types'
import { formatContestDuration, teamAvatarUrl } from '../utils/contest'
import { getStatusInfo } from '../utils/status'

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
 *   未提交：无底色；失败结果显示最终状态；AC：分值在上、通过时长在下；一血使用深绿底。
 * 排名仅在 AC 时变化（引擎语义），WA 红色负计数不影响排名。
 */
export function ACMCell({ state, startTime, score = 100, className = '', statusOverride }: {
  state: ACMProblemState | undefined
  startTime: string
  score?: number
  className?: string
  statusOverride?: string
}) {
	const extraClass = className ? ` ${className}` : ''
  if (statusOverride && !state?.solved) {
    const statusInfo = getStatusInfo(statusOverride)
    return (
      <td
        className={`standings-cell result-cell standings-cell-${statusInfo.color}${extraClass}`}
        title={statusInfo.label}
      >
        {shortStatusLabel(statusOverride)}
      </td>
    )
  }
  if (!state || (!state.solved && state.failed_attempts === 0 && !state.last_status)) {
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
  const status = state.last_status || 'wrong_answer'
  const statusInfo = getStatusInfo(status)
  return (
    <td
      className={`standings-cell result-cell standings-cell-${statusInfo.color}${extraClass}`}
      title={`${statusInfo.label}${state.failed_attempts > 0 ? `，${state.failed_attempts} 次未通过尝试` : ''}`}
    >
      {shortStatusLabel(status)}
    </td>
  )
}

function shortStatusLabel(status: string): string {
  switch (status) {
    case 'accepted': return 'AC'
    case 'wrong_answer': return 'WA'
    case 'presentation_error': return 'PE'
    case 'compile_error': return 'CE'
    case 'time_limit_exceeded': return 'TLE'
    case 'memory_limit_exceeded': return 'MLE'
    case 'runtime_error': return 'RE'
    case 'output_limit_exceeded': return 'OLE'
    case 'system_error': return 'SE'
    case 'not_run': return '未运行'
    default: return status
  }
}
