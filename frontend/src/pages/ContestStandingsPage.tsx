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
import { formatRemaining, useClock } from '../utils/clock'
import { getStatusInfo, isPendingStatus } from '../utils/status'

// ---------- 排行榜 ----------

function ACMTable({ contestId, standings, problems, startTime, activeTeamId, activeProblemId, activeStatus, revealedStatus, activeAnimationKey }: {
  contestId: number
  standings: ACMStanding[]
  problems: ContestProblem[]
  startTime: string
  activeTeamId?: number
  activeProblemId?: number
  activeStatus?: string
  revealedStatus?: string
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
              <th key={p.problem_id} title={p.title} className={`problem-column problem-theme-${p.theme_color || 'blue'}`}>
                <span className={`standings-problem-swatch swatch-${p.theme_color || 'blue'}`} aria-hidden="true" />
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
                    statusOverride={activeCell ? revealedStatus : undefined}
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
              <th key={p.problem_id} title={p.title} className={`problem-column problem-theme-${p.theme_color || 'blue'}`}>
                <span className={`standings-problem-swatch swatch-${p.theme_color || 'blue'}`} aria-hidden="true" />
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

function DynamicRevealStatus({
  contest,
  now,
  rolling,
  dynamicPrelude,
  rollStep,
  rollTotal,
}: {
  contest: ContestStandings['contest']
  now: number
  rolling: boolean
  dynamicPrelude: boolean
  rollStep: number
  rollTotal: number
}) {
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
  const freezeMinutes = Math.max(0, contest.freeze_duration_minutes || 0)
  const freezeAtMs = freezeMinutes > 0 ? endMs - freezeMinutes * 60_000 : 0

  if (dynamicPrelude) {
    return (
      <div className="dynamic-countdown-banner dynamic-countdown-reveal" aria-live="polite">
        <div className="dynamic-countdown-main">
          <strong>检查提交结果</strong>
          <span className="dynamic-reveal-progress">从底部向上查看提交与通过情况</span>
        </div>
      </div>
    )
  }

  if (rolling) {
    return (
      <div className="dynamic-countdown-banner dynamic-countdown-reveal" aria-live="polite">
        <div className="dynamic-countdown-main">
          <strong>正在公布排名</strong>
          <span className="dynamic-reveal-progress">第 {Math.min(rollStep + 1, rollTotal)} / {rollTotal} 条提交</span>
        </div>
        <span className="muted">按评测完成顺序展示最终榜单</span>
      </div>
    )
  }

  if (now < startMs) {
    return (
      <div className="dynamic-countdown-banner dynamic-countdown-upcoming" aria-live="polite">
        <div className="dynamic-countdown-main">
          <strong>比赛尚未开始</strong>
          <b>{formatRemaining(startMs - now)}</b>
        </div>
        <span className="muted">动态榜将在比赛开始后实时同步</span>
      </div>
    )
  }

  if (now < endMs && freezeAtMs > 0 && now < freezeAtMs) {
    return (
      <div className="dynamic-countdown-banner dynamic-countdown-running" aria-live="polite">
        <div className="dynamic-countdown-main">
          <strong>距离封榜</strong>
          <b>{formatRemaining(freezeAtMs - now)}</b>
        </div>
        <span className="muted">封榜前提交和评测状态会实时同步</span>
      </div>
    )
  }

  if (now < endMs && freezeAtMs > 0) {
    return (
      <div className="dynamic-countdown-banner dynamic-countdown-freeze" aria-live="polite">
        <div className="dynamic-countdown-main">
          <strong>封榜中</strong>
          <b>{formatRemaining(endMs - now)}</b>
        </div>
      </div>
    )
  }

  return (
    <div className="dynamic-countdown-banner dynamic-countdown-waiting" aria-live="polite">
      <div className="dynamic-countdown-main">
        <strong>等待公布排名</strong>
      </div>
      <span className="muted">正在等待封榜提交完成评测</span>
    </div>
  )
}

type RevealMode = 'choice' | 'dynamic' | 'quick'

function RevealChoiceOverlay({ dynamicAvailable, onDynamic, onQuick }: {
  dynamicAvailable: boolean
  onDynamic: () => void
  onQuick: () => void
}) {
  return (
    <div className="reveal-choice-overlay" role="dialog" aria-modal="true" aria-label="比赛结束榜单展示方式">
      <div className="reveal-choice-panel">
        <div className="reveal-choice-actions">
          <button type="button" className="reveal-choice-button reveal-choice-button-primary" onClick={onDynamic} disabled={!dynamicAvailable}>
            动态榜单
          </button>
          <button type="button" className="reveal-choice-button" onClick={onQuick}>
            快速榜单
          </button>
        </div>
        {!dynamicAvailable && <p className="reveal-choice-hint">封榜提交尚未全部完成评测</p>}
      </div>
    </div>
  )
}

function animateStandingsFromBottom(onDone: () => void, delayMs = 0, speed = 1): () => void {
  const wrap = document.querySelector<HTMLElement>('.standings-wrap')
  if (!wrap) {
    onDone()
    return () => undefined
  }
  const distance = Math.max(0, wrap.scrollHeight - wrap.clientHeight)
  wrap.scrollTop = distance
  if (distance === 0) {
    onDone()
    return () => undefined
  }
  const duration = Math.max(3200, Math.min(15000, (2200 + distance * 3) * speed))
  let startedAt = 0
  let frame = 0
  const tick = (timestamp: number) => {
    if (startedAt === 0) startedAt = timestamp
    const progress = Math.min(1, (timestamp - startedAt) / duration)
    const eased = 1 - Math.pow(1 - progress, 2)
    wrap.scrollTop = distance * (1 - eased)
    if (progress < 1) frame = window.requestAnimationFrame(tick)
    else onDone()
  }
  const timer = window.setTimeout(() => {
    frame = window.requestAnimationFrame(tick)
  }, delayMs)
  return () => {
    window.clearTimeout(timer)
    if (frame) window.cancelAnimationFrame(frame)
  }
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
  const [revealMode, setRevealMode] = useState<RevealMode | null>(dynamicOnly ? 'choice' : null)
  const [dynamicPrelude, setDynamicPrelude] = useState(false)
  const [quickPreview, setQuickPreview] = useState(false)
  const now = useClock(1000)

  useEffect(() => {
    rollStarted.current = false
    setRevealMode(dynamicOnly ? 'choice' : null)
    setDynamicPrelude(false)
    setQuickPreview(false)
    setRolling(false)
    setRollStep(-1)
    setRollPhase('done')
  }, [contestId, dynamicOnly])

  const revealFinalStandings = useCallback(() => {
    setRevealMode('quick')
    setDynamicPrelude(false)
    setRolling(false)
    setRollStep(-1)
    setRollPhase('done')
    setStandings((current) => {
      if (!current) return current
      const events = current.roll_events
      const finalStandings = events && events.length > 0
        ? events[events.length - 1].standings
        : current.standings
      return {
        ...current,
        standings: finalStandings,
        roll_available: false,
        roll_events: undefined,
        roll_initial_standings: undefined,
        frozen_submissions: 0,
      }
    })
    setQuickPreview(true)
  }, [])

  const chooseDynamicReveal = useCallback(() => {
    setRevealMode('dynamic')
    setQuickPreview(false)
    setDynamicPrelude(true)
  }, [])

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

  // 动态页必须在封榜和比赛结束的边界主动刷新一次，否则页面可能一直停留
  // 在封榜前的 API 快照，错过 roll_available 的出现时刻。
  useEffect(() => {
    if (!dynamicOnly || !standings || standings.mode !== 'ACM') return
    const endMs = new Date(standings.contest.end_time).getTime()
    const freezeMinutes = Math.max(0, standings.contest.freeze_duration_minutes || 0)
    const freezeAtMs = freezeMinutes > 0 ? endMs - freezeMinutes * 60_000 : 0
    const nextBoundary = [freezeAtMs, endMs]
      .filter((value) => value > now)
      .sort((a, b) => a - b)[0]
    if (!nextBoundary) return
    const timer = window.setTimeout(() => load(true), Math.max(200, nextBoundary - now + 250))
    return () => window.clearTimeout(timer)
  }, [dynamicOnly, load, now, standings?.contest.end_time, standings?.contest.freeze_duration_minutes])

  // 选择动态榜单后，先从表格底部向上检查提交结果，再进入逐条滚榜。
  useEffect(() => {
    if (!dynamicPrelude) return
    return animateStandingsFromBottom(() => {
      rollStarted.current = true
      setDynamicPrelude(false)
      setLive(false)
      setLiveQueue([])
      setLiveEventId(null)
      setLivePhase('done')
      setRollStep(0)
      setRollPhase('focus')
      setRolling(true)
    })
  }, [dynamicPrelude])

  // 快速榜单直接使用最终排名，但仍从底部向上滚动一遍供预览。
  useEffect(() => {
    if (!quickPreview) return
    // 最终榜先完整停留片刻，再以较慢速度从底部向上扫过。
    return animateStandingsFromBottom(() => setQuickPreview(false), 1800, 1.8)
  }, [quickPreview])

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
  const revealedStatus = rollEvent && rollPhase === 'result'
    ? rollEvent.status
    : liveSubmission && livePhase === 'result'
      ? liveSubmission.status
      : undefined
  const activeColor = activeStatus ? getStatusInfo(activeStatus).color : 'gray'
  const contestEnded = now >= new Date(standings.contest.end_time).getTime()
  const revealChoiceVisible = dynamicOnly && isACM && contestEnded && revealMode === 'choice'
  const dynamicAvailable = Boolean(standings.roll_available && standings.roll_events && standings.roll_events.length > 0)
  const dynamicFreezeActive = dynamicOnly
    && isACM
    && standings.contest.freeze_duration_minutes > 0
    && now >= new Date(standings.contest.end_time).getTime() - standings.contest.freeze_duration_minutes * 60_000
    && now < new Date(standings.contest.end_time).getTime()
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
      {revealChoiceVisible && (
        <RevealChoiceOverlay
          dynamicAvailable={dynamicAvailable}
          onDynamic={chooseDynamicReveal}
          onQuick={revealFinalStandings}
        />
      )}
      {dynamicOnly && isACM && revealMode === 'choice' && !contestEnded && (
        <DynamicRevealStatus
          contest={standings.contest}
          now={now}
          rolling={rolling}
          dynamicPrelude={dynamicPrelude}
          rollStep={rollStep}
          rollTotal={standings.roll_events?.length ?? 0}
        />
      )}
      {dynamicOnly && isACM && revealMode === 'dynamic' && (rolling || (standings.roll_available && (standings.roll_events?.length ?? 0) > 0)) && (
        <div className="dynamic-reveal-toolbar">
          <button type="button" className="button button-secondary" onClick={revealFinalStandings}>
            直接揭晓最终榜单
          </button>
        </div>
      )}
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
          <div className={dynamicFreezeActive ? 'dynamic-freeze-board' : ''}>
            <ACMTable
              contestId={contestId}
              standings={visibleACM}
              problems={standings.problems}
              startTime={standings.contest.start_time}
              activeTeamId={activeTeamId}
              activeProblemId={activeProblemId}
              activeStatus={activeStatus}
              revealedStatus={revealedStatus}
              activeAnimationKey={activeAnimationKey}
            />
          </div>
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
          <Link
            to={data.is_admin ? `/contest/${contestId}/messages` : `/contest/${contestId}#contest-communications`}
            className="button button-secondary"
          >
            {data.is_admin ? '消息管理' : '广播 / QA'}
          </Link>
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
