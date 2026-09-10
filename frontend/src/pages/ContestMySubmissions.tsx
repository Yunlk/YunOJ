import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { extractError, getContestMySubmissions, getContestRegistration } from '../api'
import PageHeader from '../components/PageHeader'
import Pagination from '../components/Pagination'
import StatusBadge from '../components/StatusBadge'
import SubmissionFlags from '../components/SubmissionFlags'
import { useAuth } from '../context/AuthContext'
import type { Contest, SubmissionListItem } from '../types'
import { serverNow } from '../utils/clock'
import { contestModeLabel, contestPhase, phaseLabel } from '../utils/contest'
import { formatMemory, formatRunTime, formatTime } from '../utils/format'

const PAGE_SIZE = 20

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: '', label: '全部状态' },
  { value: 'accepted', label: '已通过' },
  { value: 'wrong_answer', label: '答案错误' },
  { value: 'presentation_error', label: '格式错误' },
  { value: 'time_limit_exceeded', label: '超时' },
  { value: 'memory_limit_exceeded', label: '超内存' },
  { value: 'output_limit_exceeded', label: '输出超限' },
  { value: 'runtime_error', label: '运行错误' },
  { value: 'compile_error', label: '编译错误' },
  { value: 'system_error', label: '系统错误' },
]

export default function ContestMySubmissions() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const contestId = Number(id)
  const isAdmin = user?.role === 'admin'
  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const status = searchParams.get('status') ?? ''
  const problemId = searchParams.get('problem_id') ?? ''
  const [problemInput, setProblemInput] = useState(problemId)

  const [contest, setContest] = useState<Contest | null>(null)
  const [items, setItems] = useState<SubmissionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  // undefined = 身份校验中；true = 可查看（管理员或已报名）；false = 未报名，不发请求
  const [allowed, setAllowed] = useState<boolean | undefined>(isAdmin ? true : undefined)

  useEffect(() => setProblemInput(problemId), [problemId])

  // /contests/{id}/submissions 只对「已报名或管理员」开放（未报名必然 403）。
  // 先用轻量的报名接口确认身份，再决定是否发起提交列表请求；
  // 未报名时完全不请求，改为引导报名。
  useEffect(() => {
    if (isAdmin) {
      setAllowed(true)
      return
    }
    if (!user) {
      setAllowed(false)
      return
    }
    let cancelled = false
    setAllowed(undefined)
    getContestRegistration(contestId)
      .then((data) => {
        if (cancelled) return
        setContest(data.contest)
        setAllowed(data.is_registered)
      })
      .catch(() => {
        if (!cancelled) setAllowed(false)
      })
    return () => {
      cancelled = true
    }
  }, [contestId, isAdmin, user])

  // 盲评期间后端禁止按判题状态筛选，前端同步隐藏该筛选（与后端 blindResultsActive 一致）。
  const blindActive = Boolean(
    contest && contest.feedback === 'blind' && !isAdmin && serverNow() < new Date(contest.end_time).getTime(),
  )
  const effectiveStatus = blindActive ? '' : status

  useEffect(() => {
    if (allowed !== true) {
      setItems([])
      setTotal(0)
      setLoading(false)
      setError('')
      return
    }
    let cancelled = false
    setLoading(true)
    setError('')
    getContestMySubmissions({
      id: contestId,
      page,
      size: PAGE_SIZE,
      status: effectiveStatus || undefined,
      problem_id: problemId ? Number(problemId) : undefined,
    })
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
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
  }, [allowed, contestId, page, effectiveStatus, problemId])

  const patchParams = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams)
    for (const [key, value] of Object.entries(patch)) {
      if (!value) next.delete(key)
      else next.set(key, value)
    }
    next.set('page', '1')
    setSearchParams(next)
  }

  const hasFilters = Boolean(effectiveStatus || problemId)
  const blocked = allowed === false
  const colSpan = isAdmin ? 9 : 8
  const contestPhaseNow = contest ? contestPhase(contest) : null

  const acceptedCount = useMemo(
    () => (loading ? 0 : items.filter((item) => item.status === 'accepted').length),
    [items, loading],
  )

  return (
    <div>
      <nav className="breadcrumb" aria-label="面包屑">
        <Link to="/contests">比赛</Link>
        <span className="breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <Link to={`/contest/${contestId}`}>{contest?.title ?? `比赛 ${contestId}`}</Link>
        <span className="breadcrumb-sep" aria-hidden="true">
          /
        </span>
        <span>{isAdmin ? '全部提交' : '我的提交'}</span>
      </nav>

      <PageHeader
        title={isAdmin ? '比赛全部提交' : '我的比赛提交'}
        eyebrow={contest ? contestModeLabel(contest.mode) : undefined}
        description={
          contest
            ? `${contest.title} · ${contestPhaseNow ? phaseLabel(contestPhaseNow) : ''} · 按时间倒序显示${isAdmin ? '全场' : '我的'}提交记录。`
            : isAdmin
              ? '查看本场比赛所有选手的提交与评测状态。'
              : '查看自己在本场比赛中的提交与评测状态。'
        }
        actions={
          <div className="contest-badges">
            <Link to={`/contest/${contestId}`} className="button button-secondary">
              ← 返回总览
            </Link>
            <Link
              to={isAdmin ? `/contest/${contestId}/messages` : `/contest/${contestId}#contest-communications`}
              className="button button-secondary"
            >
              {isAdmin ? '消息管理' : '广播 / QA'}
            </Link>
          </div>
        }
      />

      {error && <div className="error-message">{error}</div>}

      {blocked ? (
        <div className="empty-state">
          <span className="empty-state-title">
            {user ? '报名本场比赛后才能查看提交记录' : '登录并报名本场比赛后才能查看提交记录'}
          </span>
          <span className="empty-state-hint">
            提交列表只对已报名的参赛者与管理员开放，这里不会向后端发起无权请求。
          </span>
          <div className="contest-badges">
            <Link to={`/contest/${contestId}/register`} className="button button-primary button-sm">
              去报名
            </Link>
            <Link to={`/contest/${contestId}`} className="button button-secondary button-sm">
              返回总览
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="toolbar">
            <label className="toolbar-field">
              <span className="toolbar-label">结论</span>
              <select
                className="select-input"
                value={effectiveStatus}
                disabled={blindActive}
                onChange={(event) => patchParams({ status: event.target.value || null })}
                aria-label="按判题结论筛选"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value || 'all'} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <form
              className="toolbar-field"
              onSubmit={(event) => {
                event.preventDefault()
                patchParams({ problem_id: problemInput.trim() || null })
              }}
            >
              <label className="toolbar-label" htmlFor="contest-problem-filter">
                题目 ID
              </label>
              <input
                id="contest-problem-filter"
                type="number"
                min={1}
                className="contest-problem-filter"
                value={problemInput}
                onChange={(event) => setProblemInput(event.target.value)}
                placeholder="如 437"
              />
              <button type="submit" className="button button-secondary button-sm">
                筛选
              </button>
            </form>

            <span className="toolbar-spacer" />
            {blindActive && <span className="muted">盲评期间不可按结论筛选</span>}
            {hasFilters && (
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={() => {
                  setProblemInput('')
                  patchParams({ status: null, problem_id: null })
                }}
              >
                重置
              </button>
            )}
          </div>

          <div className="table-summary">
            <span>{loading ? '加载中…' : `共 ${total} 条提交${hasFilters ? '（已筛选）' : ''}`}</span>
            <span className="muted">{loading ? '' : `本页通过 ${acceptedCount} 条`}</span>
          </div>

          <div className="table-frame">
            <table className="data-table contest-submissions-table">
              <thead>
                <tr>
                  <th style={{ width: 84 }}>#</th>
                  {isAdmin && <th style={{ width: 130 }}>用户</th>}
                  <th>题目</th>
                  <th style={{ width: 96 }}>语言</th>
                  <th style={{ width: 118 }}>状态</th>
                  <th style={{ width: 72 }} className="cell-right">
                    得分
                  </th>
                  <th style={{ width: 96 }} className="cell-right">
                    耗时
                  </th>
                  <th style={{ width: 96 }} className="cell-right">
                    内存
                  </th>
                  <th style={{ width: 160 }}>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={colSpan} className="table-empty">
                      加载中…
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={colSpan} className="table-empty">
                      <div className="empty-state-inline">
                        <span>{hasFilters ? '没有符合条件的提交' : '暂无提交'}</span>
                        {hasFilters ? (
                          <button
                            type="button"
                            className="button button-ghost button-sm"
                            onClick={() => {
                              setProblemInput('')
                              patchParams({ status: null, problem_id: null })
                            }}
                          >
                            清除筛选
                          </button>
                        ) : (
                          <Link to={`/contest/${contestId}`} className="button button-ghost button-sm">
                            返回总览选一题
                          </Link>
                        )}
                      </div>
                    </td>
                  </tr>
                ) : (
                  items.map((submission) => (
                    <tr
                      key={submission.id}
                      className="clickable-row"
                      onClick={() => navigate(`/submission/${submission.id}`)}
                    >
                      <td className="cell-id">
                        <Link
                          to={`/submission/${submission.id}`}
                          className="problem-link"
                          onClick={(event) => event.stopPropagation()}
                        >
                          {submission.id}
                        </Link>
                      </td>
                      {isAdmin && <td>{submission.username}</td>}
                      <td>
                        {submission.problem_title}
                        {problemId && Number(problemId) === submission.problem_id && (
                          <span className="tag-chip contest-row-chip">已筛选</span>
                        )}
                      </td>
                      <td className="mono">{submission.language}</td>
                      <td>
                        <StatusBadge status={submission.status} />
                        <SubmissionFlags
                          pretestOnly={submission.pretest_only}
                          systemTested={submission.system_tested}
                          isHacked={submission.is_hacked}
                        />
                      </td>
                      <td className="cell-right cell-num">{submission.score}</td>
                      <td className="cell-right cell-num">{formatRunTime(submission.time_ms)}</td>
                      <td className="cell-right cell-num">{formatMemory(submission.memory_kb)}</td>
                      <td className="mono">{formatTime(submission.created_at)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <Pagination
            page={page}
            total={total}
            size={PAGE_SIZE}
            onChange={(next) => {
              const params = new URLSearchParams(searchParams)
              params.set('page', String(next))
              setSearchParams(params)
            }}
          />
        </>
      )}
    </div>
  )
}
