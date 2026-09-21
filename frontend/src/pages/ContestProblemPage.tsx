import { useCallback, useEffect, useRef, useState } from 'react'
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
import ProblemAttachmentList from '../components/ProblemAttachmentList'
import ProblemWorkbench from '../components/ProblemWorkbench'
import ContestHackPanel from '../components/ContestHackPanel'
import SubmissionPanel from '../components/SubmissionPanel'
import DifficultyBadge from '../components/DifficultyBadge'
import { useAuth } from '../context/AuthContext'
import { preferredDraftLanguage, rememberDraftLanguage, useCodeDraft } from '../hooks/useCodeDraft'
import type { Contest, ContestProblemView, Language } from '../types'
import { formatRemaining, useClock } from '../utils/clock'
import { cfDecayScore } from '../utils/contest'
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
  // 函数题：预填题目给出的函数骨架（本地草稿优先，见 useCodeDraft）。
  const seedCode = useCallback(
    (lang: string) => view?.problem.initial_codes?.[lang] ?? '',
    [view],
  )
  const { code, setCode, flushDraft } = useCodeDraft(draftScope, language, seedCode)
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
    // 先只取比赛本身：未报名（且非管理员）时不应再请求题目，否则必然拿到 403，
    // 在控制台与网络面板留下一串失败请求。
    getContest(contestId)
      .then(async (contestResponse) => {
        if (cancelled) return
        const c = contestResponse.contest
        setContest(c)
        const allowed = contestResponse.is_registered || contestResponse.is_admin || user?.role === 'admin'
        if (!allowed) return
        const [problemView, items] = await Promise.all([getContestProblem(contestId, problemId), getLanguages()])
        if (cancelled) return
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
  }, [contestId, draftScope, problemId, user?.role])

  const changeLanguage = (next: string) => {
    flushDraft()
    rememberDraftLanguage(draftScope, next)
    setLanguage(next)
  }

  // 函数题骨架随题面一起到达，可能晚于「语言选定」：这时 useCodeDraft 已跑过一轮，
  // 需要补一次种子。只在编辑器还没有内容时补，避免覆盖选手已写的代码。
  const seededRef = useRef('')
  useEffect(() => {
    if (!view || !language) return
    const seed = view.problem.initial_codes?.[language]
    if (!seed) return
    const mark = `${problemId}:${language}`
    if (seededRef.current === mark) return
    seededRef.current = mark
    if (code.trim()) return
    setCode(seed)
  }, [code, language, problemId, setCode, view])

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
    (input: string, sampleIndex?: number) => runContestTest(
      contestId,
      problemId,
      language,
      code,
      input,
      optimize,
      sampleIndex,
    ),
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
  // 未报名且非管理员：渲染报名引导（语义正确的标题 + 下一步动作），不请求题目
  if (contest && !view) {
    return (
      <div className="state-page">
        <h1>请先报名参加该比赛</h1>
        <p>
          《{contest.title}》的题目与提交入口仅对已报名选手开放。报名后即可查看题面、提交代码并参与榜单。
        </p>
        <div className="state-page-actions">
          <Link to={`/contest/${contestId}/register`} className="button button-primary">
            报名参赛
          </Link>
          <Link to={`/contest/${contestId}`} className="button button-secondary">
            返回比赛
          </Link>
        </div>
      </div>
    )
  }
  if (!contest || !view) return <div className="page-loading">加载中…</div>

  const { problem, contest_problem: contestProblem } = view
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
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
      <span><DifficultyBadge value={problem.difficulty} /></span>
      <span>题号 {contestProblem.display_id}</span>
      {contest.mode === 'CF' ? (
        <span title={`初始满分 ${contestProblem.score}，随比赛进行线性衰减到 30%`}>
          当前分值 {cfDecayScore(contestProblem.score, now, startMs, endMs)}
          <span className="muted"> / 初始 {contestProblem.score}</span>
        </span>
      ) : (
        <span>满分 {contestProblem.score}</span>
      )}
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

  const hackSection = contest.hacking_enabled ? (
    <ContestHackPanel
      contestId={contestId}
      problemId={problemId}
      hackingEnabled={contest.hacking_enabled}
      running={running}
      solved={my?.status === 'passed'}
    />
  ) : null

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
      <div className="contest-focus-clock" role="timer" aria-live="off">
        {upcoming ? (
          <span>距离比赛开始 <strong>{formatRemaining(startMs - now)}</strong></span>
        ) : running ? (
          <span>距离比赛结束 <strong>{formatRemaining(endMs - now)}</strong></span>
        ) : (
          <span>比赛已结束</span>
        )}
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
        onSubmit={() => void submit()}
        onRun={runContestCode}
        showSubmissions={panel === 'submissions'}
        canSubmit={running}
        submitLabel={submitLabel}
        submitDisabledReason={submitDisabledReason}
        headerActions={(
          <>
            <Link
              to={user?.role === 'admin' ? `/contest/${contestId}/messages` : `/contest/${contestId}#contest-communications`}
              className="mini-btn"
            >
              {user?.role === 'admin' ? '消息管理' : '广播 / QA'}
            </Link>
            <Link to={`/contest/${contestId}`} className="mini-btn">返回比赛</Link>
          </>
        )}
        statementMeta={(
          <>
            {statementMeta}
            {hackSection}
          </>
        )}
        statementFooter={<ProblemAttachmentList problemId={problemId} />}
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
