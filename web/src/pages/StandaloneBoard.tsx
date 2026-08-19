import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { getContestStandings } from '../api'
import { ACMCell, TeamAvatar } from '../components/ContestBoardParts'
import type { ACMStanding, ContestStandings } from '../types'
import { useClock } from '../utils/clock'
import { formatTime } from '../utils/format'

/**
 * 独立榜单展示页（/contest/:id/board）：无导航栏、大字体投影模式，
 * 比赛中每 3 秒自动刷新；封榜后显示冻结状态。
 */
export default function StandaloneBoard() {
  const { id } = useParams()
  const contestId = Number(id)
  const [standings, setStandings] = useState<ContestStandings | null>(null)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const now = useClock(1000)

  const load = useCallback(() => {
    getContestStandings(contestId)
      .then((s) => {
        setStandings(s)
        const start = new Date(s.contest.start_time).getTime()
        const end = new Date(s.contest.end_time).getTime()
        const t = Date.now()
        setLive(t >= start && t < end && !s.freeze_at)
      })
      .catch(() => {
        setError('加载失败')
      })
  }, [contestId])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!live) return
    const t = window.setInterval(load, 3000)
    return () => window.clearInterval(t)
  }, [live, load])

  if (error) return <div className="board-standalone"><div className="board-error">{error}</div></div>
  if (!standings) return <div className="board-standalone"><div className="board-error">加载中…</div></div>

  const isACM = standings.mode === 'ACM'
  const frozen = Boolean(standings.freeze_at)

  return (
    <div className="board-standalone">
      <header className="board-header">
        <h1>{standings.contest.title}</h1>
        <div className="board-meta">
          {live && <span className="live-indicator"><span className="live-dot" />实时</span>}
          {frozen && <span className="board-frozen">已封榜{frozen && standings.frozen_submissions ? ` · ${standings.frozen_submissions} 条待揭晓` : ''}</span>}
          <span className="board-clock">{formatTime(new Date(now).toISOString())}</span>
        </div>
      </header>
      {isACM ? (
        <table className="board-table">
          <thead>
            <tr>
              <th style={{ width: 70 }}>#</th>
              <th>队伍</th>
              <th style={{ width: 90 }}>通过</th>
              <th style={{ width: 90 }}>罚时</th>
              {standings.problems.map((p) => (
                <th key={p.problem_id}>{p.display_id}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {(standings.standings as ACMStanding[]).map((s) => (
              <tr key={s.team_id}>
                <td className="board-rank">{s.rank}</td>
                <td>
                  <span className="standings-team">
                    <TeamAvatar contestId={contestId} teamId={s.team_id} avatar={s.avatar} size="sm" />
                    <span>{s.team_name}</span>
                  </span>
                </td>
                <td>{s.solved}</td>
                <td>{s.penalty}</td>
                {standings.problems.map((p) => (
                  <ACMCell key={p.problem_id} state={s.problems[p.display_id]} startTime={standings.contest.start_time} />
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <div className="board-error">该比赛为 {standings.mode} 赛制，展示页仅支持 ACM 榜单</div>
      )}
    </div>
  )
}
