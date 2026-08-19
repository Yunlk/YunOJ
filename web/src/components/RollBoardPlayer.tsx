import { useEffect, useMemo, useRef, useState } from 'react'
import { extractError, getContestRollBoard } from '../api'
import type { ACMStanding, RollBoard } from '../types'
import { formatTime } from '../utils/format'
import { minutesSinceStart, teamAvatarUrl } from '../utils/contest'

interface RollBoardPlayerProps {
  contestId: number
  onClose: () => void
}

const PLAY_INTERVAL_MS = 1500

function Avatar({ contestId, teamId, avatar, size }: { contestId: number; teamId: number; avatar: string; size: 'sm' | 'lg' }) {
  const url = teamAvatarUrl(contestId, teamId, avatar)
  const cls = size === 'lg' ? 'avatar-lg' : 'avatar-sm'
  if (!url) return <span className={`${cls} avatar-fallback`}>?</span>
  return <img src={url} alt="" className={cls} />
}

export default function RollBoardPlayer({ contestId, onClose }: RollBoardPlayerProps) {
  const [board, setBoard] = useState<RollBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // step = -1 表示初始封榜快照；step = i 表示已播放到第 i 条提交
  const [step, setStep] = useState(-1)
  const [playing, setPlaying] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    getContestRollBoard(contestId)
      .then((data) => {
        if (cancelled) return
        setBoard(data)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [contestId])

  useEffect(() => {
    if (!playing) return
    timer.current = window.setInterval(() => {
      setStep((s) => {
        if (board && s >= board.events.length - 1) {
          setPlaying(false)
          return s
        }
        return s + 1
      })
    }, PLAY_INTERVAL_MS)
    return () => {
      if (timer.current !== null) {
        window.clearInterval(timer.current)
        timer.current = null
      }
    }
  }, [playing, board])

  const standings: ACMStanding[] = useMemo(() => {
    if (!board) return []
    if (step < 0) return board.initial_standings
    return board.events[step]?.standings ?? []
  }, [board, step])

  if (loading) return <div className="page-loading">滚榜数据加载中…</div>
  if (error) return <div className="error-message">{error}</div>
  if (!board) return <div className="error-message">滚榜数据加载失败</div>

  const total = board.events.length
  const event = step >= 0 ? board.events[step] : null
  const startTime = board.contest.start_time
  const isLast = step >= total - 1

  const startPlay = () => {
    if (isLast) {
      // 播完后再次点击从封榜快照重新开始
      setStep(-1)
      setPlaying(true)
      return
    }
    setPlaying(true)
  }

  return (
    <div className="rollboard-overlay">
      <div className="rollboard-modal">
        <div className="rollboard-header">
          <div className="rollboard-title">
            <h2>滚榜 · {board.contest.title}</h2>
            {board.freeze_at && (
              <span className="muted">封榜于 {formatTime(board.freeze_at)}</span>
            )}
          </div>
          <div className="rollboard-controls">
            <button type="button" className="button button-secondary" onClick={() => setStep(-1)}>
              ⏮ 封榜
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={step <= -1}
              onClick={() => setStep((s) => Math.max(-1, s - 1))}
            >
              ◀
            </button>
            {playing ? (
              <button type="button" className="button button-primary" onClick={() => setPlaying(false)}>
                ⏸ 暂停
              </button>
            ) : (
              <button type="button" className="button button-primary" onClick={startPlay}>
                ▶ {isLast ? '重播' : '播放'}
              </button>
            )}
            <button
              type="button"
              className="button button-secondary"
              disabled={isLast}
              onClick={() => setStep((s) => Math.min(total - 1, s + 1))}
            >
              ▶
            </button>
            <button type="button" className="button button-secondary" onClick={() => setStep(total - 1)}>
              终榜 ⏭
            </button>
            <button type="button" className="button button-secondary" onClick={onClose}>
              关闭
            </button>
          </div>
        </div>

        <div className="rollboard-progress">
          <div className="rollboard-progress-bar">
            <div
              className="rollboard-progress-fill"
              style={{ width: `${total === 0 ? 0 : ((step + 1) / total) * 100}%` }}
            />
          </div>
          <span className="mono muted">
            {total === 0 ? '无冻结提交' : `${Math.max(0, step + 1)} / ${total}`}
          </span>
        </div>

        {event && (
          <div className="rollboard-event">
            <Avatar contestId={contestId} teamId={event.team_id} avatar={event.team_avatar} size="lg" />
            <div className="rollboard-event-main">
              <span className="rollboard-event-team">{event.team_name}</span>
              <span className="muted">提交 #{event.submission_id}</span>
            </div>
            <span className="rollboard-event-rank">
              第 {event.rank_before} 名 → 第 {event.rank_after} 名
            </span>
          </div>
        )}

        <div className="rollboard-table-wrap">
          <table className="data-table standings-table">
            <thead>
              <tr>
                <th style={{ width: 56 }}>#</th>
                <th>队伍</th>
                <th style={{ width: 70 }}>通过</th>
                <th style={{ width: 70 }}>罚时</th>
                {board.problems.map((p) => (
                  <th key={p.problem_id} title={p.title} style={{ width: 72 }}>
                    {p.display_id}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {standings.map((s) => {
                const active = event?.team_id === s.team_id
                const movedUp = active && event.rank_after < event.rank_before
                const movedDown = active && event.rank_after > event.rank_before
                return (
                  <tr key={s.team_id} className={active ? 'rollboard-active-row' : ''}>
                    <td className="mono standings-rank">
                      {active && movedUp && <span className="rank-arrow rank-up">▲</span>}
                      {active && movedDown && <span className="rank-arrow rank-down">▼</span>}
                      {s.rank}
                    </td>
                    <td className={active ? 'rollboard-active-team' : ''}>
                      <span className="standings-team">
                        <Avatar contestId={contestId} teamId={s.team_id} avatar={s.avatar} size="sm" />
                        <span>{s.team_name}</span>
                      </span>
                    </td>
                    <td className="mono">{s.solved}</td>
                    <td className="mono">{s.penalty}</td>
                    {board.problems.map((p) => {
                      const ps = s.problems[p.display_id]
                      if (!ps || (!ps.solved && ps.failed_attempts === 0)) {
                        return <td key={p.problem_id} className="standings-cell" />
                      }
                      if (ps.solved) {
                        const mins = ps.solved_at ? minutesSinceStart(ps.solved_at, startTime) : null
                        if (ps.first_blood) {
                          return (
                            <td key={p.problem_id} className="standings-cell fb-cell" title="一血！全场第一个通过">
                              ★ {mins ?? ''}
                            </td>
                          )
                        }
                        return (
                          <td key={p.problem_id} className="standings-cell ac-cell" title={`通过于第 ${mins ?? '?'} 分钟`}>
                            ✓ {mins ?? ''}
                          </td>
                        )
                      }
                      return (
                        <td key={p.problem_id} className="standings-cell wa-cell" title={`${ps.failed_attempts} 次未通过尝试`}>
                          -{ps.failed_attempts}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
