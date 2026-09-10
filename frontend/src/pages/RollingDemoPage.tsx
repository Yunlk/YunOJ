import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ACMTable } from './ContestStandingsPage'
import type { ACMStanding, ContestProblem, RollEvent } from '../types'
import { buildRevealTimings, type RevealPhase } from '../utils/reveal'
import { getStatusInfo } from '../utils/status'

const DEMO_START = '2026-08-28T09:00:00.000Z'
const TEAM_COUNT = 20
const EVENT_COUNT = 50

const DEMO_PROBLEMS: ContestProblem[] = [
  { problem_id: 901, display_id: 'A', sort_order: 1, title: '序列校准', score: 100, theme_color: 'blue' },
  { problem_id: 902, display_id: 'B', sort_order: 2, title: '信号分组', score: 100, theme_color: 'green' },
  { problem_id: 903, display_id: 'C', sort_order: 3, title: '路径折叠', score: 100, theme_color: 'orange' },
  { problem_id: 904, display_id: 'D', sort_order: 4, title: '矩阵回声', score: 100, theme_color: 'purple' },
  { problem_id: 905, display_id: 'E', sort_order: 5, title: '流量预测', score: 100, theme_color: 'cyan' },
  { problem_id: 906, display_id: 'F', sort_order: 6, title: '边界搜索', score: 100, theme_color: 'rose' },
]

const ACCEPTED_EVENTS = new Set([4, 9, 14, 19, 24, 29, 34, 39, 44, 49])

function createEmptyStanding(index: number): ACMStanding {
  return {
    rank: index + 1,
    team_id: 9100 + index,
    team_name: `演示队 ${String(index + 1).padStart(2, '0')}`,
    avatar: '',
    solved: 0,
    penalty: 0,
    problems: {},
  }
}

function cloneStandings(standings: ACMStanding[]): ACMStanding[] {
  return standings.map((standing) => ({
    ...standing,
    problems: Object.fromEntries(
      Object.entries(standing.problems).map(([displayId, state]) => [displayId, { ...state }]),
    ),
  }))
}

function rankStandings(standings: ACMStanding[]): ACMStanding[] {
  return standings
    .slice()
    .sort((left, right) => (
      right.solved - left.solved
      || left.penalty - right.penalty
      || left.team_id - right.team_id
    ))
    .map((standing, index) => ({ ...standing, rank: index + 1 }))
}

function failureStatus(index: number): string {
  if (index % 19 === 0) return 'memory_limit_exceeded'
  if (index % 17 === 0) return 'runtime_error'
  if (index % 13 === 0) return 'time_limit_exceeded'
  return 'wrong_answer'
}

function buildDemoData(): { initial: ACMStanding[]; events: RollEvent[] } {
  const initial = Array.from({ length: TEAM_COUNT }, (_, index) => createEmptyStanding(index))
  let current = cloneStandings(initial)
  let acceptedCursor = 0
  const startMs = new Date(DEMO_START).getTime()
  const events = Array.from({ length: EVENT_COUNT }, (_, index) => {
    const isAccepted = ACCEPTED_EVENTS.has(index)
    let teamIndex: number
    let problemIndex: number

    if (isAccepted) {
      const targetTeamId = 9100 + ((acceptedCursor * 2 + 1) % TEAM_COUNT)
      teamIndex = Math.max(0, current.findIndex((standing) => standing.team_id === targetTeamId))
      problemIndex = acceptedCursor % DEMO_PROBLEMS.length
      acceptedCursor += 1
    } else {
      teamIndex = (index * 7 + 2) % TEAM_COUNT
      problemIndex = (index * 3 + 1) % DEMO_PROBLEMS.length
      // 失败提交避开已经通过的格子，让每个事件都能在揭晓时留下明确结果。
      while (current[teamIndex].problems[DEMO_PROBLEMS[problemIndex].display_id]?.solved) {
        teamIndex = (teamIndex + 1) % TEAM_COUNT
      }
    }

    const team = current[teamIndex]
    const problem = DEMO_PROBLEMS[problemIndex]
    const displayId = problem.display_id
    const previous = team.problems[displayId]
    const elapsedSeconds = Math.min(59, Math.floor(index / 2) * 2)
    const createdAt = new Date(startMs + elapsedSeconds * 1000).toISOString()
    const status = isAccepted ? 'accepted' : failureStatus(index)
    const nextState = {
      ...(previous ?? { solved: false, failed_attempts: 0 }),
      last_status: status,
      failed_attempts: (previous?.failed_attempts ?? 0) + (isAccepted ? 0 : 1),
    }

    if (isAccepted) {
      nextState.solved = true
      nextState.solved_at = createdAt
      nextState.first_blood = acceptedCursor === 1
      team.solved += 1
      team.penalty += Math.round(elapsedSeconds / 60) + (previous?.failed_attempts ?? 0) * 20
      team.last_ac = createdAt
    }

    const nextStandings = cloneStandings(current)
    const nextTeam = nextStandings.find((standing) => standing.team_id === team.team_id)
    if (nextTeam) {
      nextTeam.problems[displayId] = nextState
      if (isAccepted) {
        nextTeam.solved = team.solved
        nextTeam.penalty = team.penalty
        nextTeam.last_ac = team.last_ac
      }
    }
    current = rankStandings(nextStandings)

    return {
      submission_id: 98000 + index,
      problem_id: problem.problem_id,
      status,
      team_id: team.team_id,
      team_name: team.team_name,
      team_avatar: '',
      created_at: createdAt,
      standings: cloneStandings(current),
    }
  })

  return { initial: rankStandings(initial), events }
}

function statusLabel(status: string): string {
  if (status === 'accepted') return 'AC'
  if (status === 'wrong_answer') return 'WA'
  return getStatusInfo(status).label
}

function phaseLabel(phase: RevealPhase | 'done'): string {
  if (phase === 'focus') return '聚焦提交'
  if (phase === 'judging') return '评测中'
  if (phase === 'result') return '公布结果'
  if (phase === 'settled') return '排名移动'
  return '演示完成'
}

export default function RollingDemoPage() {
  const demo = useMemo(buildDemoData, [])
  const timings = useMemo(() => buildRevealTimings(demo.events), [demo.events])
  const [step, setStep] = useState(-1)
  const [phase, setPhase] = useState<RevealPhase | 'done'>('done')
  const [playing, setPlaying] = useState(false)

  const startRolling = useCallback(() => {
    setStep(0)
    setPhase('focus')
    setPlaying(true)
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(startRolling, 700)
    return () => window.clearTimeout(timer)
  }, [startRolling])

  useEffect(() => {
    if (!playing || step < 0) return
    const event = demo.events[step]
    const timing = timings[step]
    if (!event || !timing) return
    const duration = phase === 'focus' ? timing.focus
      : phase === 'judging' ? timing.judging
        : phase === 'result' ? timing.result
          : timing.settled
    const timer = window.setTimeout(() => {
      if (phase === 'focus') setPhase('judging')
      else if (phase === 'judging') setPhase('result')
      else if (phase === 'result') setPhase('settled')
      else if (step >= demo.events.length - 1) {
        setPlaying(false)
        setPhase('done')
      } else {
        setStep((current) => current + 1)
        setPhase('focus')
      }
    }, duration)
    return () => window.clearTimeout(timer)
  }, [demo.events, phase, playing, step, timings])

  const event = step >= 0 ? demo.events[step] : undefined
  const status = event && phase !== 'focus' && phase !== 'judging' ? event.status : undefined
  const activeStatus = event
    ? phase === 'focus' ? 'pending' : phase === 'judging' ? 'running' : event.status
    : undefined
  const activeColor = activeStatus ? getStatusInfo(activeStatus).color : 'gray'
  const visibleStandings = !event || phase === 'focus' || phase === 'judging' || phase === 'result'
    ? (step > 0 ? demo.events[step - 1].standings : demo.initial)
    : event.standings

  useEffect(() => {
    if (!event) return
    const row = document.querySelector(`[data-team-id="${event.team_id}"]`)
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }, [event, phase])

  return (
    <div className="rolling-demo-page">
      <div className="page-header rolling-demo-header">
        <div>
          <p className="page-eyebrow">前端演示 · 不连接接口</p>
          <h1 className="page-title">滚榜现场</h1>
          <p className="field-hint">模拟首分钟内 50 次提交，按聚焦、评测、结果和排名移动逐条揭晓。</p>
        </div>
        <div className="rolling-demo-actions">
          <button type="button" className="button button-primary" onClick={startRolling} disabled={playing}>
            {playing ? '演示进行中' : '重新播放'}
          </button>
          <Link to="/ranking" className="button button-secondary">返回榜单</Link>
        </div>
      </div>

      <div className="rolling-demo-summary card">
        <div>
          <span className="rolling-demo-label">当前阶段</span>
          <strong>{phaseLabel(phase)}</strong>
        </div>
        <div>
          <span className="rolling-demo-label">进度</span>
          <strong>{event ? `${step + 1} / ${EVENT_COUNT}` : `0 / ${EVENT_COUNT}`}</strong>
        </div>
        <div>
          <span className="rolling-demo-label">事件时间</span>
          <strong>{event ? `00:${event.created_at ? event.created_at.slice(17, 19) : '00'}` : '等待开始'}</strong>
        </div>
        <div>
          <span className="rolling-demo-label">事件构成</span>
          <strong>10 AC · 40 未通过</strong>
        </div>
      </div>

      {event && (
        <div className={`standings-focus standings-focus-${activeColor} standings-focus-roll rolling-demo-focus`} aria-live="polite">
          <strong>{event.team_name}</strong>
          <span className="field-hint">提交 #{event.submission_id} · 题目 {DEMO_PROBLEMS.find((problem) => problem.problem_id === event.problem_id)?.display_id}</span>
          <span className="focus-status">{status ? statusLabel(status) : phaseLabel(phase)}</span>
        </div>
      )}

      <section className="rolling-demo-board card">
        <div className="rolling-demo-board-heading">
          <div>
            <span className="page-eyebrow">ACM 计分</span>
            <h2>首分钟提交回放</h2>
          </div>
          <span className="section-hint">表格沿用正式滚榜的排名移动动画</span>
        </div>
        <ACMTable
          contestId={0}
          standings={visibleStandings}
          problems={DEMO_PROBLEMS}
          startTime={DEMO_START}
          activeTeamId={event?.team_id}
          activeProblemId={event?.problem_id}
          activeStatus={activeStatus}
          revealedStatus={phase === 'result' ? event?.status : undefined}
          activeAnimationKey={event ? `demo-${event.submission_id}-${phase}` : undefined}
        />
      </section>
    </div>
  )
}
