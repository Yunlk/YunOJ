import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { extractError, getContestOverview, getContests } from '../api'
import PageHeader from '../components/PageHeader'
import { useAuth } from '../context/AuthContext'
import type { Contest } from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import { contestModeLabel, contestPhase, phaseLabel } from '../utils/contest'
import type { ContestPhase } from '../utils/contest'
import { formatTime } from '../utils/format'

/** 一次拉全量比赛后在客户端分组：分组视图无法与分页共存，且比赛总量远小于题目量。 */
const FETCH_SIZE = 200
/** 已结束的比赛只保留最近这些场，避免列表被历史比赛淹没。 */
const ENDED_LIMIT = 60
/** 我的排名最多为最近这些已结束比赛取总览。 */
const RANK_ENDED_LIMIT = 12

type RankState = {
  rank: number
  solved?: number
  totalScore?: number
}

type PhaseFilter = '' | ContestPhase

/**
 * 分组标题文案：upcoming 用「即将开始」（phaseLabel 给的是「未开始」，
 * 而那个函数被榜单等页面共用，这里不动它，只在本页覆盖文案）。
 */
function groupTitle(p: ContestPhase): string {
  return p === 'upcoming' ? '即将开始' : phaseLabel(p)
}

/** 在途的列表请求：StrictMode 双跑 effect 时复用，避免重复打接口。 */
let inFlightListRequest: Promise<Awaited<ReturnType<typeof getContests>>> | null = null

const PHASE_FILTERS: { key: PhaseFilter; label: string }[] = [
  { key: '', label: '全部' },
  { key: 'running', label: '进行中' },
  { key: 'upcoming', label: '即将开始' },
  { key: 'ended', label: '已结束' },
]

/** 分组切换的判定频率：30s 足够（比赛开始/结束不会更精确）。 */
const GROUP_REFRESH_MS = 30000

/**
 * 倒计时单元格：秒级刷新（与导航栏的比赛胶囊一致），
 * 时间来自 utils/clock 的 useClock（含服务端时间校正）+ formatRemaining（统一格式）。
 * 只有这个小组件每秒重渲染，列表本身仍按 GROUP_REFRESH_MS 重算分组。
 */
function Countdown({ target, label, tone }: { target: string; label: string; tone?: 'danger' }) {
  const now = useClock(1000)
  const targetMs = new Date(target).getTime()
  if (Number.isNaN(targetMs)) return <span className="muted">—</span>
  const remaining = targetMs - now
  if (remaining <= 0) return <span className="contest-time-ended">已到时间</span>
  return (
    <span className={`contest-countdown${tone === 'danger' ? ' danger' : ''}`} title={`截止 ${formatTime(target)}`}>
      <span className="contest-countdown-label">{label}</span>
      {formatRemaining(remaining)}
    </span>
  )
}

/** 报名状态的样式：直接读列表接口返回的 is_registered。 */
function regClass(contest: Contest, phase: ContestPhase): string {
  if (contest.is_registered) return 'is-registered'
  if (phase === 'ended') return 'is-closed'
  return 'is-open'
}

function regLabel(contest: Contest, phase: ContestPhase, loggedIn: boolean): string {
  if (contest.is_registered) return '已报名'
  if (!loggedIn) return phase === 'ended' ? '已结束' : '登录后报名'
  if (phase === 'ended') return '未参赛'
  return '未报名'
}

function rankTitle(rank: RankState): string {
  const parts = [`排名 #${rank.rank}`]
  if (typeof rank.solved === 'number') parts.push(`通过 ${rank.solved} 题`)
  if (typeof rank.totalScore === 'number') parts.push(`总分 ${rank.totalScore}`)
  return parts.join(' · ')
}

/** 进行中 / 即将开始的比赛行：赛制、时间、倒计时、报名状态、我的排名。 */
function ContestRows({
  phase,
  items,
  rankMap,
  loggedIn,
}: {
  phase: ContestPhase
  items: Contest[]
  rankMap: Record<number, RankState>
  loggedIn: boolean
}) {
  const navigate = useNavigate()
  return (
    <div className="table-frame">
      <table className="data-table contest-table">
        <colgroup>
          <col className="col-id" />
          <col />
          <col className="col-mode" />
          <col className="col-time" />
          <col className="col-phase" />
          <col className="col-reg" />
          <col className="col-rank" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>比赛</th>
            <th>赛制</th>
            <th>时间</th>
            <th>{phase === 'running' ? '剩余时间' : '距开始'}</th>
            <th>报名</th>
            <th className="cell-right">我的排名</th>
            <th className="cell-actions">
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((contest) => {
            const rank = rankMap[contest.id]
            return (
              <tr key={contest.id} className="clickable-row" onClick={() => navigate(`/contest/${contest.id}`)}>
                <td className="cell-id">{contest.id}</td>
                <td className="contest-title-cell">
                  <Link
                    to={`/contest/${contest.id}`}
                    className="problem-link"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {contest.title}
                  </Link>
                  {contest.visibility === 'private' && <span className="tag-chip contest-row-chip">私有</span>}
                </td>
                <td>
                  <span className="tag-chip">{contestModeLabel(contest.mode)}</span>
                </td>
                <td className="mono contest-time-cell">
                  <span title="开始时间">{formatTime(contest.start_time)}</span>
                  <span className="muted" title="结束时间">
                    至 {formatTime(contest.end_time)}
                  </span>
                </td>
                <td>
                  {phase === 'running' ? (
                    <Countdown target={contest.end_time} label="剩余" tone="danger" />
                  ) : (
                    <Countdown target={contest.start_time} label="距开始" />
                  )}
                </td>
                <td>
                  <span className={`contest-reg-badge ${regClass(contest, phase)}`}>
                    {regLabel(contest, phase, loggedIn)}
                  </span>
                </td>
                <td className="cell-right cell-num">
                  {rank ? <span title={rankTitle(rank)}>#{rank.rank}</span> : <span className="muted">—</span>}
                </td>
                <td className="cell-actions">
                  <Link
                    to={`/contest/${contest.id}`}
                    className="button button-ghost button-sm"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {phase === 'running' ? '进题' : '详情'}
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

/** 已结束的比赛：紧凑行，重点是我的参与情况与名次。 */
function EndedRows({
  items,
  rankMap,
  loggedIn,
}: {
  items: Contest[]
  rankMap: Record<number, RankState>
  loggedIn: boolean
}) {
  const navigate = useNavigate()
  return (
    <div className="table-frame">
      <table className="data-table contest-table">
        <colgroup>
          <col className="col-id" />
          <col />
          <col className="col-mode" />
          <col className="col-time" />
          <col className="col-reg" />
          <col className="col-rank" />
          <col className="col-actions" />
        </colgroup>
        <thead>
          <tr>
            <th>#</th>
            <th>比赛</th>
            <th>赛制</th>
            <th>比赛时间</th>
            <th>参与</th>
            <th className="cell-right">我的排名</th>
            <th className="cell-actions">
              <span className="visually-hidden">操作</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((contest) => {
            const rank = rankMap[contest.id]
            return (
              <tr key={contest.id} className="clickable-row" onClick={() => navigate(`/contest/${contest.id}`)}>
                <td className="cell-id">{contest.id}</td>
                <td className="contest-title-cell">
                  <Link
                    to={`/contest/${contest.id}`}
                    className="problem-link"
                    onClick={(event) => event.stopPropagation()}
                  >
                    {contest.title}
                  </Link>
                  {contest.visibility === 'private' && <span className="tag-chip contest-row-chip">私有</span>}
                </td>
                <td>
                  <span className="tag-chip">{contestModeLabel(contest.mode)}</span>
                </td>
                <td className="mono contest-time-cell">
                  <span title="开始时间">{formatTime(contest.start_time)}</span>
                  <span className="muted" title="结束时间">
                    至 {formatTime(contest.end_time)}
                  </span>
                </td>
                <td>
                  <span className={`contest-reg-badge ${regClass(contest, 'ended')}`}>
                    {regLabel(contest, 'ended', loggedIn)}
                  </span>
                </td>
                <td className="cell-right cell-num">
                  {rank ? <span title={rankTitle(rank)}>#{rank.rank}</span> : <span className="muted">—</span>}
                </td>
                <td className="cell-actions">
                  <Link
                    to={`/contest/${contest.id}`}
                    className="button button-ghost button-sm"
                    onClick={(event) => event.stopPropagation()}
                  >
                    查看
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export default function ContestList() {
  const [searchParams, setSearchParams] = useSearchParams()
  const { user } = useAuth()
  const phaseFilter = (searchParams.get('phase') ?? '') as PhaseFilter
  const onlyMine = searchParams.get('mine') === '1'

  const [contests, setContests] = useState<Contest[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rankMap, setRankMap] = useState<Record<number, RankState>>({})
  const now = useClock(GROUP_REFRESH_MS)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    // 复用同一份在途请求：StrictMode 下 effect 会跑两次，没有这层去重就会白打一次列表请求
    if (!inFlightListRequest) {
      inFlightListRequest = getContests({ page: 1, size: FETCH_SIZE }).finally(() => {
        inFlightListRequest = null
      })
    }
    inFlightListRequest
      .then((data) => {
        if (cancelled) return
        const seen = new Set<number>()
        setContests(data.items.filter((c) => (seen.has(c.id) ? false : seen.add(c.id))))
        setTotal(data.total)
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
  }, [])

  // 分组：进行中 → 即将开始 → 已结束；同组内按“最紧迫优先”排序。
  const groups = useMemo(() => {
    const running: Contest[] = []
    const upcoming: Contest[] = []
    const ended: Contest[] = []
    for (const contest of contests) {
      const phase = contestPhase(contest, now)
      if (phase === 'running') running.push(contest)
      else if (phase === 'upcoming') upcoming.push(contest)
      else ended.push(contest)
    }
    running.sort((a, b) => new Date(a.end_time).getTime() - new Date(b.end_time).getTime())
    upcoming.sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())
    ended.sort((a, b) => new Date(b.end_time).getTime() - new Date(a.end_time).getTime())
    return { running, upcoming, ended, endedTotal: ended.length }
  }, [contests, now])

  // 已结束组只渲染最近 ENDED_LIMIT 场
  const endedShown = useMemo(() => groups.ended.slice(0, ENDED_LIMIT), [groups])

  // 报名状态：直接用列表接口返回的 contest.is_registered
  // （后端已在 /contests 里批量算好），不再对每一行打 /contests/{id}/registration。
  // 只有「我的排名」还需要单场数据，仍然按需查总览。

  // 我的排名：只查「已报名 + 进行中 / 最近结束」的比赛，赛前该字段没有意义。
  // 用 ref 记录已发起过的比赛，避免分组变化时重复请求；
  // 请求结果不再因 effect 重跑而丢弃，否则中途重跑会让这一行的排名永远不显示。
  const rankFetchedRef = useRef<Set<number>>(new Set())
  useEffect(() => {
    const targets = [...groups.running, ...endedShown.slice(0, RANK_ENDED_LIMIT)].filter(
      (contest) => contest.is_registered && !rankFetchedRef.current.has(contest.id),
    )
    for (const contest of targets) {
      rankFetchedRef.current.add(contest.id)
      getContestOverview(contest.id)
        .then((overview) => {
          const summary = overview.my_summary
          if (!summary || !summary.visible) return
          setRankMap((prev) => ({
            ...prev,
            [contest.id]: { rank: summary.rank, solved: summary.solved, totalScore: summary.total_score },
          }))
        })
        .catch(() => {
          /* 排名是附加信息，取不到就不显示 */
        })
    }
  }, [groups, endedShown, contests])

  const visibleGroups = [
    { phase: 'running' as ContestPhase, items: groups.running },
    { phase: 'upcoming' as ContestPhase, items: groups.upcoming },
    { phase: 'ended' as ContestPhase, items: endedShown },
  ]
    .filter((group) => (phaseFilter ? group.phase === phaseFilter : true))
    .map((group) => ({
      ...group,
      items: onlyMine && user ? group.items.filter((contest) => contest.is_registered) : group.items,
    }))

  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key)
      else next.set(key, value)
    }
    setSearchParams(next)
  }

  const shown = visibleGroups.reduce((sum, group) => sum + group.items.length, 0)
  const hasRows = visibleGroups.some((group) => group.items.length > 0)
  const loggedIn = Boolean(user)

  return (
    <div>
      <PageHeader
        title="比赛"
        description="列表按状态分组，进行中的比赛显示实时剩余时间；报名、赛中进题与赛后看榜都在比赛详情中完成。"
        actions={
          <Link to="/ranking" className="button button-secondary">
            全站排名
          </Link>
        }
      />

      {error && <div className="error-message">{error}</div>}

      <div className="toolbar">
        <span className="toolbar-label">状态</span>
        <div className="segmented" role="group" aria-label="按比赛状态筛选">
          {PHASE_FILTERS.map((item) => (
            <button
              key={item.key || 'all'}
              type="button"
              aria-pressed={phaseFilter === item.key}
              onClick={() => patchParams({ phase: item.key || null })}
            >
              {item.label}
              <span className="segmented-count">
                {item.key === ''
                  ? groups.running.length + groups.upcoming.length + groups.ended.length
                  : groups[item.key].length}
              </span>
            </button>
          ))}
        </div>
        <span className="toolbar-spacer" />
        <label className="check-row">
          <input
            type="checkbox"
            checked={onlyMine}
            disabled={!loggedIn}
            onChange={(event) => patchParams({ mine: event.target.checked ? '1' : null })}
          />
          <span>只看我报名的</span>
        </label>
        <Link to="/contest/new" className="button button-ghost button-sm">
          新建比赛
        </Link>
      </div>

      <div className="table-summary">
        <span>
          {loading
            ? '加载中…'
            : `共 ${total} 场比赛：进行中 ${groups.running.length} · 即将开始 ${groups.upcoming.length} · 已结束 ${groups.endedTotal}`}
        </span>
        <span className="muted">{onlyMine ? `已筛选：我报名了 ${shown} 场` : `当前显示 ${shown} 场`}</span>
      </div>

      {loading ? (
        <div className="empty-state">
          <span className="empty-state-title">加载比赛…</span>
        </div>
      ) : !hasRows ? (
        <div className="empty-state">
          <span className="empty-state-title">没有符合条件的比赛</span>
          <span className="empty-state-hint">
            {phaseFilter || onlyMine ? '可以放宽筛选条件后再看一次。' : '比赛创建后会出现在这里。'}
          </span>
          {(phaseFilter || onlyMine) && (
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => patchParams({ phase: null, mine: null })}
            >
              清除筛选
            </button>
          )}
        </div>
      ) : (
        visibleGroups.map((group) =>
          // 空分组只留一行说明：避免渲染空表格导致“表格 0 行”，也省掉一屏空白。
          group.items.length === 0 ? (
            <section className="contest-group" key={group.phase} aria-label={`${groupTitle(group.phase)}的比赛`}>
              <h2 className="contest-group-title">
                <span className={`phase-badge phase-${group.phase}`}>{groupTitle(group.phase)}</span>
                <span className="contest-group-count">暂无</span>
              </h2>
            </section>
          ) : (
            <section className="contest-group" key={group.phase} aria-label={`${groupTitle(group.phase)}的比赛`}>
              <h2 className="contest-group-title">
                <span className={`phase-badge phase-${group.phase}`}>{groupTitle(group.phase)}</span>
                <span className="contest-group-count">{group.items.length} 场</span>
              </h2>
              {group.phase === 'ended' ? (
                <EndedRows items={group.items} rankMap={rankMap} loggedIn={loggedIn} />
              ) : (
                <ContestRows
                  phase={group.phase}
                  items={group.items}
                  rankMap={rankMap}
                  loggedIn={loggedIn}
                />
              )}
            </section>
          ),
        )
      )}

      {!loading && !phaseFilter && groups.endedTotal > endedShown.length && (
        <p className="muted contest-list-note">
          已结束的比赛仅显示最近 {endedShown.length} 场，可用「已结束」状态筛选查看同范围内的历史比赛。
        </p>
      )}
    </div>
  )
}
