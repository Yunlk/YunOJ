import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import {
  extractError, getContest, getContestStandings,
} from '../api'
import { ACMCell, TeamAvatar } from '../components/ContestBoardParts'
import type {
  ACMStanding, ContestDetail as ContestDetailData, ContestProblem, ContestStandings, OIStanding,
} from '../types'
import { formatTime } from '../utils/format'
import { formatContestMinutes } from '../utils/contest'
import { getStatusInfo, isPendingStatus } from '../utils/status'

// ---------- 排行榜 ----------

function ACMTable({ contestId, standings, problems, startTime, activeTeamId, activeProblemId, activeStatus, activeAnimationKey }: {
  contestId: number
  standings: ACMStanding[]
  problems: ContestProblem[]
  startTime: string
  activeTeamId?: number
  activeProblemId?: number
  activeStatus?: string
  activeAnimationKey?: string
}) {
  const previousTops = useRef(new Map<number, number>())

  // FLIP：保留队伍行节点，通过位移过渡让排名变化连续移动，而不是瞬间跳位。
  useLayoutEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>('.standings-table tbody tr[data-team-id]'))
    const nextTops = new Map<number, number>()
    rows.forEach((row) => {
      const teamId = Number(row.dataset.teamId)
      const top = row.getBoundingClientRect().top
      nextTops.set(teamId, top)
      const previousTop = previousTops.current.get(teamId)
      const delta = previousTop === undefined ? 0 : previousTop - top
      if (Math.abs(delta) > 1) {
        row.style.transition = 'none'
        row.style.transform = `translateY(${delta}px)`
        window.requestAnimationFrame(() => {
          row.style.transition = 'transform 720ms cubic-bezier(0.22, 1, 0.36, 1)'
          row.style.transform = 'translateY(0)'
        })
      }
    })
    previousTops.current = nextTops
  }, [standings, activeAnimationKey, activeTeamId])

  const activeColor = activeStatus ? getStatusInfo(activeStatus).color : ''

  return (
    <div className="standings-wrap">
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th className="rank-column">#</th>
            <th className="team-column">队伍</th>
            <th className="total-column">总分</th>
            {problems.map((p) => (
              <th key={p.problem_id} title={p.title} className="problem-column">
                <span className="standings-problem-id">{p.display_id}</span>
                <span className="standings-problem-title">{p.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 ? (
            <tr><td colSpan={3 + problems.length} className="table-empty">暂无队伍</td></tr>
          ) : (
              standings.map((s) => (
              <tr
                key={s.team_id}
                data-team-id={s.team_id}
                className={activeTeamId === s.team_id ? `standings-active-row standings-row-${activeColor}` : ''}
              >
                <td className="mono rank-column">{s.rank}</td>
                <td className="team-column">
                  <span className="standings-team">
                    <TeamAvatar contestId={contestId} teamId={s.team_id} avatar={s.avatar} size="sm" />
                    <span>{s.team_name}</span>
                  </span>
                </td>
                <td className="mono standings-total-cell total-column">
                  <span className="cell-score">{problems.reduce((sum, p) => {
                    const state = s.problems[p.display_id]
                    return sum + (state?.solved ? (p.score ?? p.total_score ?? 100) : 0)
                  }, 0)}</span>
                  <span className="cell-time">({formatContestMinutes(s.penalty)})</span>
                </td>
                {problems.map((p) => {
                  const activeCell = activeTeamId === s.team_id && activeProblemId === p.problem_id
                  if (activeCell && (activeStatus === 'pending' || activeStatus === 'running')) {
                    return <td key={p.problem_id} className={`standings-cell judging-cell active-evaluation-cell standings-cell-${activeColor}`}>评测中</td>
                  }
                  return <ACMCell
                    key={p.problem_id}
                    state={s.problems[p.display_id]}
                    startTime={startTime}
                    score={p.score ?? p.total_score ?? 100}
                    className={activeCell ? `active-evaluation-cell standings-cell-${activeColor}` : ''}
                  />
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function submissionStatusLabel(status?: string): string {
  if (status === 'pending') return '等待评测'
  if (status === 'running') return '评测中'
  if (status === 'accepted') return 'AC'
  if (status === 'wrong_answer') return 'WA'
  if (status === 'presentation_error') return 'PE'
  if (status === 'compile_error') return 'CE'
  if (status === 'time_limit_exceeded') return 'TLE'
  if (status === 'memory_limit_exceeded') return 'MLE'
  if (status === 'runtime_error') return 'RE'
  if (status === 'output_limit_exceeded') return 'OLE'
  if (status === 'system_error') return 'SE'
  return status || ''
}

function OITable({ contestId, standings, problems }: {
  contestId: number
  standings: OIStanding[]
  problems: ContestProblem[]
}) {
  return (
    <div className="standings-wrap">
      <table className="data-table standings-table">
        <thead>
          <tr>
            <th className="rank-column">#</th>
            <th className="team-column">队伍</th>
            <th className="total-column">总分</th>
            {problems.map((p) => (
              <th key={p.problem_id} title={p.title} className="problem-column">
                <span className="standings-problem-id">{p.display_id}</span>
                <span className="standings-problem-title">{p.title}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {standings.length === 0 ? (
            <tr><td colSpan={3 + problems.length} className="table-empty">暂无队伍</td></tr>
          ) : (
            standings.map((s) => (
              <tr key={s.team_id}>
                <td className="mono rank-column">{s.rank}</td>
                <td className="team-column">
                  <span className="standings-team">
                    <TeamAvatar contestId={contestId} teamId={s.team_id} avatar={s.avatar} size="sm" />
                    <span>{s.team_name}</span>
                  </span>
                </td>
                <td className="mono standings-total total-column">{s.total_score}</td>
                {problems.map((p) => {
                  const score = s.problem_scores[p.display_id]
                  const subs = s.problem_submissions[p.display_id]
                  if (score === undefined) return <td key={p.problem_id} className="standings-cell" />
                  return (
                    <td key={p.problem_id} className="standings-cell score-cell">
                      {score}
                      {subs > 0 && <span className="muted"> ({subs} 次)</span>}
                    </td>
                  )
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function StandingsPanel({ contestId, dynamicOnly = false }: { contestId: number; dynamicOnly?: boolean }) {
  const [standings, setStandings] = useState<ContestStandings | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [live, setLive] = useState(false)
  const [liveItems, setLiveItems] = useState<Record<number, NonNullable<ContestStandings['latest_submission']>>>({})
  const [liveQueue, setLiveQueue] = useState<number[]>([])
  const [liveEventId, setLiveEventId] = useState<number | null>(null)
  const [livePhase, setLivePhase] = useState<'focus' | 'judging' | 'result' | 'settled' | 'done'>('done')
  const liveKnownStatuses = useRef(new Map<number, string>())
  const liveEnqueued = useRef(new Set<number>())
  const liveInitialized = useRef(false)
  const rollStarted = useRef(false)
  const [rollStep, setRollStep] = useState(-1)
  const [rollPhase, setRollPhase] = useState<'focus' | 'judging' | 'result' | 'settled' | 'done'>('done')
  const [rolling, setRolling] = useState(false)

  const load = useCallback((silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    getContestStandings(contestId)
      .then((s) => {
        // 比赛进行中且未封榜：保持 3 秒轮询，随提交实时更新
        const now = Date.now()
        const start = new Date(s.contest.start_time).getTime()
        const end = new Date(s.contest.end_time).getTime()
        const running = now >= start && now < end
        const frozen = Boolean(s.freeze_at)
        // 封榜期间仍保持轮询，比赛结束后自动拉取揭晓事件。
        const pendingReveal = dynamicOnly && frozen && !rollStarted.current
          && (now < end || (!s.roll_available && (s.frozen_submissions ?? 0) > 0))
        const incoming = s.live_submissions ?? (s.latest_submission ? [s.latest_submission] : [])
        const waitingForJudge = incoming.some((item) => isPendingStatus(item.status))
        setLive(running || pendingReveal || waitingForJudge)

        // 轮询到的最新总榜不能直接覆盖当前画面。每条提交在显示终态后
        // 再应用 standings_after，否则 AC 会在“评测中”阶段提前改变名次。
        const preserveAnimatedBoard = liveInitialized.current && s.mode === 'ACM'
          && !s.roll_available && !frozen
        setStandings((current) => preserveAnimatedBoard && current
          ? { ...s, standings: current.standings }
          : s)

        const mergedItems: Record<number, NonNullable<ContestStandings['latest_submission']>> = {}
        incoming.forEach((item) => { mergedItems[item.submission_id] = item })
        setLiveItems((current) => ({ ...current, ...mergedItems }))

        if (!liveInitialized.current) {
          const pendingIds: number[] = []
          incoming.forEach((item) => {
            liveKnownStatuses.current.set(item.submission_id, item.status)
            if (isPendingStatus(item.status)) {
              pendingIds.push(item.submission_id)
              liveEnqueued.current.add(item.submission_id)
            } else {
              // 初次打开榜单不回放全部历史提交。
              liveEnqueued.current.add(item.submission_id)
            }
          })
          liveInitialized.current = true
          if (pendingIds.length > 0) setLiveQueue(pendingIds)
        } else {
          const newIds: number[] = []
          incoming.forEach((item) => {
            liveKnownStatuses.current.set(item.submission_id, item.status)
            if (!liveEnqueued.current.has(item.submission_id)) {
              liveEnqueued.current.add(item.submission_id)
              newIds.push(item.submission_id)
            }
          })
          if (newIds.length > 0) setLiveQueue((queue) => [...queue, ...newIds])
        }
        if (dynamicOnly && s.roll_available && s.roll_events && s.roll_events.length > 0 && !rollStarted.current) {
          rollStarted.current = true
          setLive(false)
          setLiveQueue([])
          setLiveEventId(null)
          setLivePhase('done')
          setRollStep(0)
          setRollPhase('focus')
          setRolling(true)
        }
      })
      .catch((err) => setError(extractError(err)))
      .finally(() => {
        if (!silent) setLoading(false)
      })
  }, [contestId, dynamicOnly])

  useEffect(() => {
    load()
  }, [load])

  // 比赛中每 3 秒静默刷新榜单（AC 后排名/格子即时变化；WA 显示红色 -N 不影响排名）
  useEffect(() => {
    if (!live) return
    const t = window.setInterval(() => load(true), 3000)
    return () => window.clearInterval(t)
  }, [live, load])

  useEffect(() => {
    if (liveEventId !== null || liveQueue.length === 0) return
    setLiveEventId(liveQueue[0])
    setLiveQueue((queue) => queue.slice(1))
    setLivePhase('focus')
  }, [liveEventId, liveQueue])

  const liveEvent = liveEventId === null ? undefined : liveItems[liveEventId]

  useEffect(() => {
    if (!liveEvent) return
    if (livePhase === 'judging' && (isPendingStatus(liveEvent.status) || !liveEvent.standings_after)) {
      return
    }
    const duration = livePhase === 'focus' ? 480 : livePhase === 'judging' ? 320 : livePhase === 'result' ? 900 : 700
    const timer = window.setTimeout(() => {
      if (livePhase === 'focus') setLivePhase('judging')
      else if (livePhase === 'judging') setLivePhase('result')
      else if (livePhase === 'result') {
        setStandings((current) => current && liveEvent.standings_after
          ? { ...current, standings: liveEvent.standings_after }
          : current)
        setLivePhase('settled')
      }
      else if (livePhase === 'settled') {
        setLiveEventId(null)
        setLivePhase('done')
      }
    }, duration)
    return () => window.clearTimeout(timer)
  }, [liveEvent, livePhase])

  useEffect(() => {
    if (!rolling || !standings?.roll_events || rollStep < 0) return
    const event = standings.roll_events[rollStep]
    if (!event) {
      setRolling(false)
      setRollPhase('done')
      return
    }
    const duration = rollPhase === 'focus' ? 900 : rollPhase === 'judging' ? 1200 : rollPhase === 'result' ? 1000 : 700
    const timer = window.setTimeout(() => {
      if (rollPhase === 'focus') setRollPhase('judging')
      else if (rollPhase === 'judging') setRollPhase('result')
      else if (rollPhase === 'result') setRollPhase('settled')
      else if (rollPhase === 'settled') {
        if (rollStep >= standings.roll_events!.length - 1) {
          setRolling(false)
          setRollPhase('done')
          const finalStandings = event.standings
          setStandings((current) => current ? {
            ...current,
            standings: finalStandings,
            roll_available: false,
            roll_events: undefined,
            roll_initial_standings: undefined,
            frozen_submissions: 0,
          } : current)
        } else {
          setRollStep((step) => step + 1)
          setRollPhase('focus')
        }
      }
    }, duration)
    return () => window.clearTimeout(timer)
  }, [rolling, rollPhase, rollStep, standings])

  useEffect(() => {
    const event = rolling && standings?.roll_events && rollStep >= 0 ? standings.roll_events[rollStep] : null
    const liveSubmission = !rolling ? liveEvent : null
    const teamID = event?.team_id ?? liveSubmission?.team_id
    if (teamID === undefined) return
    const row = document.querySelector(`[data-team-id="${teamID}"]`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [rolling, rollStep, rollPhase, standings, liveEvent, livePhase])

  if (loading) return <div className="page-loading">排行榜加载中…</div>
  if (error && !standings) {
    return (
      <div className="card notice-card">
        <p>{error}</p>
        <button type="button" className="button button-secondary" onClick={() => load()}>重试</button>
      </div>
    )
  }
  if (!standings) return null

  const isACM = standings.mode === 'ACM'
  const frozen = Boolean(standings.freeze_at)
  const rollEvent = rolling && standings.roll_events && rollStep >= 0 ? standings.roll_events[rollStep] : undefined
  const liveSubmission = !rolling ? liveEvent : undefined
  const liveDisplayStatus = liveEvent
    ? (livePhase === 'focus' ? 'pending' : livePhase === 'judging' ? 'running' : liveEvent.status)
    : undefined
  const activeTeamId = rollEvent?.team_id ?? liveSubmission?.team_id
  const activeProblemId = rollEvent?.problem_id ?? liveSubmission?.problem_id
  const activeStatus = rollEvent
    ? (rollPhase === 'focus' ? 'pending' : rollPhase === 'judging' ? 'running' : rollEvent.status)
    : liveDisplayStatus
  const activeAnimationKey = rollEvent
    ? `roll-${rollEvent.submission_id}-${rollPhase}`
    : liveSubmission
      ? `live-${liveSubmission.submission_id}-${livePhase}`
      : undefined
  const activeColor = activeStatus ? getStatusInfo(activeStatus).color : 'gray'
  let visibleACM = standings.standings as ACMStanding[]
  if (rolling && rollEvent && rollStep >= 0 && rollPhase !== 'settled') {
    visibleACM = rollStep === 0 ? (standings.roll_initial_standings ?? visibleACM) : standings.roll_events![rollStep - 1].standings
  } else if (rolling && rollEvent && rollPhase === 'settled') {
    visibleACM = rollEvent.standings
  }
  if (!dynamicOnly && standings.roll_available && standings.roll_events && standings.roll_events.length > 0) {
    visibleACM = standings.roll_events[standings.roll_events.length - 1].standings
  }

  return (
    <div>
      {!dynamicOnly && <div className="standings-toolbar">
        {!dynamicOnly && live && !frozen && <span className="live-indicator"><span className="live-dot" />榜单实时更新中</span>}
        {!dynamicOnly && frozen && !live && !rolling && <span className="muted">榜单已冻结</span>}
        {!dynamicOnly && rolling && <span className="live-indicator"><span className="live-dot" />动态揭晓</span>}
        {!dynamicOnly && <button type="button" className="link-button" onClick={() => load(true)}>刷新</button>}
      </div>}
      {!dynamicOnly && isACM && frozen && (
        <div className="notice-card freeze-notice">
          已封榜（{formatTime(standings.freeze_at!)}）
          {standings.frozen_submissions !== undefined && standings.frozen_submissions > 0
            ? `：另有 ${standings.frozen_submissions} 条提交暂未公开`
            : ''}
        </div>
      )}
      {isACM ? (
        <>
          {!dynamicOnly && (rollEvent || liveSubmission) && (
            <div className={`standings-focus standings-focus-${activeColor}${rolling ? ' standings-focus-roll' : ''}`}>
              <TeamAvatar contestId={contestId} teamId={activeTeamId!} avatar={rollEvent?.team_avatar ?? liveSubmission?.team_avatar ?? ''} size="sm" />
              <strong>{rollEvent?.team_name ?? liveSubmission?.team_name}</strong>
              <span className="muted">{rollEvent ? `提交 #${rollEvent.submission_id}` : `提交 #${liveSubmission?.submission_id}`}</span>
              <span className="focus-status">{submissionStatusLabel(activeStatus)}</span>
            </div>
          )}
          <ACMTable
            contestId={contestId}
            standings={visibleACM}
            problems={standings.problems}
            startTime={standings.contest.start_time}
            activeTeamId={activeTeamId}
            activeProblemId={activeProblemId}
            activeStatus={activeStatus}
            activeAnimationKey={activeAnimationKey}
          />
        </>
      ) : (
        <OITable
          contestId={contestId}
          standings={standings.standings as OIStanding[]}
          problems={standings.problems}
        />
      )}
    </div>
  )
}

// ---------- 页面 ----------

export default function ContestStandingsPage() {
  const { id } = useParams()
  const location = useLocation()
  const contestId = Number(id)
  const [data, setData] = useState<ContestDetailData | null>(null)
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    getContest(contestId)
      .then(setData)
      .catch((err) => setError(extractError(err)))
  }, [contestId])

  useEffect(() => {
    reload()
  }, [reload])

  if (error) return <div className="error-message">{error}</div>
  if (!data) return <div className="page-loading">加载中…</div>

  const mode = data.contest.mode
  const dynamicOnly = location.pathname.endsWith('/dynamic')

  return (
    <div>
      {!dynamicOnly && <div className="page-header">
        <h1 className="page-title">排行榜 · {data.contest.title}</h1>
        <div className="contest-badges">
          <Link to={`/contest/${contestId}`} className="button button-secondary">← 返回总览</Link>
          {mode === 'ACM' && (
            <Link
              className="button button-secondary"
              to={`/contest/${contestId}/standings/dynamic`}
              target="_blank"
              rel="noreferrer"
              title="在新标签页打开只显示榜单的动态揭晓页"
            >
              动态榜单 ↗
            </Link>
          )}
        </div>
      </div>}
      <StandingsPanel contestId={contestId} dynamicOnly={dynamicOnly} />
    </div>
  )
}
