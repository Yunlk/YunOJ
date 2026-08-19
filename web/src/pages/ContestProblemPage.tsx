import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  extractError,
  getContest,
  getContestMySubmissions,
  getContestProblem,
  getLanguages,
  runContestTest,
  submitToContest,
} from '../api'
import ProblemWorkbench from '../components/ProblemWorkbench'
import SubmissionPanel from '../components/SubmissionPanel'
import { useAuth } from '../context/AuthContext'
import { preferredDraftLanguage, rememberDraftLanguage, useCodeDraft } from '../hooks/useCodeDraft'
import type { Contest, ContestProblemView, Language } from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import { formatMemory, formatTimeLimit } from '../utils/format'

const MY_STATUS_LABELS: Record<string, string> = {
  untried: '未尝试',
  judging: '评测中',
  passed: '已通过',
  failed: '未通过',
}

export default function ContestProblemPage() {
  const { id, pid } = useParams()
  const { user } = useAuth()
  const contestId = Number(id)
  const problemId = Number(pid)
  const now = useClock(1000)

  const [contest, setContest] = useState<Contest | null>(null)
  const [view, setView] = useState<ContestProblemView | null>(null)
  const [languages, setLanguages] = useState<Language[]>([])
  const draftScope = `contest:${contestId}:problem:${problemId}:user:${user?.id ?? 'guest'}`
  const [language, setLanguage] = useState('')
  const { code, setCode, flushDraft } = useCodeDraft(draftScope, language)
  const [optimize, setOptimize] = useState(true)
  const [busy, setBusy] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [submitError, setSubmitError] = useState('')
  const [submittedId, setSubmittedId] = useState<number | null>(null)
  const [panel, setPanel] = useState<'editor' | 'submissions'>('editor')
  const [submissionRefreshKey, setSubmissionRefreshKey] = useState(0)

  useEffect(() => {
    let cancelled = false
    setLoadError('')
    Promise.all([getContest(contestId), getContestProblem(contestId, problemId), getLanguages()])
      .then(([contestResponse, problemView, items]) => {
        if (cancelled) return
        setContest(contestResponse.contest)
        setView(problemView)
        setLanguages(items)
        const preferred = preferredDraftLanguage(draftScope)
        setLanguage(items.some((item) => item.key === preferred) ? preferred : (items[0]?.key ?? ''))
      })
      .catch((err) => {
        if (!cancelled) setLoadError(extractError(err))
      })
    return () => {
      cancelled = true
    }
  }, [contestId, draftScope, problemId])

  const changeLanguage = (next: string) => {
    flushDraft()
    rememberDraftLanguage(draftScope, next)
    setLanguage(next)
  }

  const submit = async () => {
    if (!contest) return
    const current = Date.now()
    if (current < new Date(contest.start_time).getTime()) {
      setSubmitError('比赛尚未开始，无法提交')
      return
    }
    if (current >= new Date(contest.end_time).getTime()) {
      setSubmitError('比赛已经结束，无法提交')
      return
    }
    if (!language) {
      setSubmitError('请选择语言')
      return
    }
    if (!code.trim()) {
      setSubmitError('代码不能为空')
      return
    }
    setBusy(true)
    setSubmitError('')
    setSubmittedId(null)
    try {
      flushDraft()
      const result = await submitToContest(contestId, problemId, language, code, optimize)
      setSubmittedId(result.id)
      setSubmissionRefreshKey((key) => key + 1)
      setPanel('submissions')
    } catch (err) {
      setSubmitError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const runContestCode = useCallback(
    (input: string) => runContestTest(contestId, problemId, language, code, input, optimize),
    [code, contestId, language, optimize, problemId],
  )

  const loadContestSubmissions = useCallback(
    ({ page, size, problemId: filteredProblemId }: {
      page: number
      size: number
      problemId: number
      userId: number
      contestId?: number
    }) => getContestMySubmissions({
      id: contestId,
      page,
      size,
      problem_id: filteredProblemId,
    }),
    [contestId],
  )

  if (loadError) return <div className="error-message">{loadError}</div>
  if (!contest || !view) return <div className="page-loading">加载中…</div>

  const { problem, contest_problem: contestProblem } = view
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
  const progress = Math.min(100, Math.max(0, ((now - startMs) / Math.max(1, endMs - startMs)) * 100))
  const running = now >= startMs && now < endMs
  const upcoming = now < startMs
  const my = view.my
  const submitLabel = running ? '提交' : upcoming ? '未开始' : '已结束'
  const submitDisabledReason = running
    ? undefined
    : upcoming
      ? '比赛尚未开始，当前只能查看题面。'
      : '比赛已结束，不再接受提交；仍可使用自测。'

  const statementMeta = (
    <div className="workbench-meta-line">
      <span>题号 {contestProblem.display_id}</span>
      <span>满分 {contestProblem.score}</span>
      <span>时间限制 {formatTimeLimit(problem.time_limit_ms)}</span>
      <span>内存限制 {formatMemory(problem.memory_limit_kb)}</span>
      <span>
        提交 {my?.submissions ?? 0}
        {my?.remaining !== undefined ? ` / 剩余 ${my.remaining}` : ''} 次
      </span>
      {my && my.status !== 'untried' && (
        <span>
          最近：{MY_STATUS_LABELS[my.status] ?? my.status}
          {my.score > 0 ? `（${my.score} 分）` : ''}
        </span>
      )}
    </div>
  )

  const problemNavigation = (
    <div className="contest-problem-nav">
      {view.prev_problem_id ? (
        <Link className="button button-secondary" to={`/contest/${contestId}/problem/${view.prev_problem_id}`}>
          ← 上一题
        </Link>
      ) : <span />}
      {view.next_problem_id ? (
        <Link className="button button-secondary" to={`/contest/${contestId}/problem/${view.next_problem_id}`}>
          下一题 →
        </Link>
      ) : <span />}
    </div>
  )

  return (
    <div className="contest-problem-page">
      <div className="contest-topbar">
        <div className="contest-topbar-title">
          <Link to={`/contest/${contestId}`} className="problem-link">← {contest.title}</Link>
          <span className="contest-topbar-pid">{contestProblem.display_id}</span>
          <span>{problem.title}</span>
        </div>
        <div className="contest-topbar-time">
          {upcoming ? (
            <span>距开始 {formatRemaining(startMs - now)}</span>
          ) : running ? (
            <span className="danger">剩余 {formatRemaining(endMs - now)}</span>
          ) : (
            <span>已结束</span>
          )}
          <div className="contest-progress slim">
            <div className="contest-progress-fill" style={{ width: `${progress}%` }} />
          </div>
        </div>
      </div>

      <ProblemWorkbench
        className="contest-workbench"
        problem={problem}
        title={`${contestProblem.display_id} ${problem.title}`}
        languages={languages}
        language={language}
        onLanguageChange={changeLanguage}
        code={code}
        onCodeChange={setCode}
        optimize={optimize}
        onOptimizeChange={setOptimize}
        submitting={busy}
        submitError={submitError}
        submittedId={submittedId}
        onSubmit={() => void submit()}
        onRun={runContestCode}
        showSubmissions={panel === 'submissions'}
        canSubmit={running}
        submitLabel={submitLabel}
        submitDisabledReason={submitDisabledReason}
        headerActions={<Link to={`/contest/${contestId}`} className="mini-btn">返回比赛</Link>}
        statementMeta={statementMeta}
        editorFooter={problemNavigation}
        submissionPanel={(
          <SubmissionPanel
            title={`${contest.title} · ${contestProblem.display_id} · ${user?.role === 'admin' ? '全部提交' : '我的提交'}`}
            problemId={problemId}
            userId={user?.id ?? null}
            contestId={contestId}
            refreshKey={submissionRefreshKey}
            focusSubmissionId={submittedId}
            showScore
            timeLimitMs={problem.time_limit_ms}
            memoryLimitKb={problem.memory_limit_kb}
            onBack={() => setPanel('editor')}
            load={loadContestSubmissions}
          />
        )}
      />
    </div>
  )
}
