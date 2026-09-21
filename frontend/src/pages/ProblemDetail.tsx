import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  createProblemDiscussion,
  createSubmission,
  extractError,
  getLanguages,
  getProblem,
  getProblemLearning,
  getProblemNeighbors,
  getSubmissions,
  runTest,
  toggleProblemFavorite,
} from '../api'
import DifficultyBadge from '../components/DifficultyBadge'
import Markdown from '../components/Markdown'
import ProblemAttachmentList from '../components/ProblemAttachmentList'
import ProblemStatement from '../components/ProblemStatement'
import ProblemWorkbench from '../components/ProblemWorkbench'
import SubmissionPanel from '../components/SubmissionPanel'
import { useAuth } from '../context/AuthContext'
import { preferredDraftLanguage, rememberDraftLanguage, useCodeDraft } from '../hooks/useCodeDraft'
import type { Language, ProblemDetail as ProblemDetailType, ProblemEditorial, Sample } from '../types'
import { formatMemory, formatTime, formatTimeLimit } from '../utils/format'

type PaneTab = 'statement' | 'editorial' | 'discussions'

/**
 * 单题页：默认就是「题面 + 编辑器」工作台，不再需要先点「进入 IDE 模式」。
 * 左栏切换 题目 / 题解 / 讨论；提交后**右栏**切换为评测结果（测试点、结论），
 * 与旧版布局一致：题面位置不动，结果出现在代码那一侧。
 */
export default function ProblemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const assignmentIdParam = Number(searchParams.get('assignment_id') ?? '0')
  const assignmentId = assignmentIdParam > 0 ? assignmentIdParam : undefined

  const [problem, setProblem] = useState<ProblemDetailType | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [editorial, setEditorial] = useState<ProblemEditorial | null>(null)
  const [discussions, setDiscussions] = useState<import('../types').ProblemDiscussion[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [actionError, setActionError] = useState('')

  const [languages, setLanguages] = useState<Language[]>([])
  const draftScope = `${assignmentId ? `assignment:${assignmentId}:` : ''}problem:${id}:user:${user?.id ?? 'guest'}`
  const [language, setLanguage] = useState('')
  // 函数题：打开时预填题目给的函数骨架（本地草稿优先，见 useCodeDraft）。
  const seedCode = useCallback(
    (lang: string) => problem?.initial_codes?.[lang] ?? '',
    [problem],
  )
  const { code, setCode, flushDraft } = useCodeDraft(draftScope, language, seedCode)
  const [optimize, setOptimize] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submittedId, setSubmittedId] = useState<number | null>(null)
  const [submissionRefreshKey, setSubmissionRefreshKey] = useState(0)

  const [tab, setTab] = useState<PaneTab>('statement')
  // 右栏视图：编辑器 / 评测结果（提交后自动切到评测结果，点「返回代码」切回）
  const [rightView, setRightView] = useState<'editor' | 'submissions'>('editor')
  const [pendingSample, setPendingSample] = useState<{ sample: Sample; index: number } | null>(null)
  const [neighbors, setNeighbors] = useState<{ prev: number; next: number }>({ prev: 0, next: 0 })
  const [discussionDraft, setDiscussionDraft] = useState('')
  const [discussionBusy, setDiscussionBusy] = useState(false)

  const [mdCopied, setMdCopied] = useState(false)
  const mdCopiedTimer = useRef<number | null>(null)

  // ---- 数据加载 ----
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProblem(id!)
      .then((p) => {
        if (!cancelled) setProblem(p)
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
  }, [id])

  useEffect(() => {
    let cancelled = false
    getProblemLearning(id!)
      .then((data) => {
        if (cancelled) return
        setFavorite(data.favorite)
        setEditorial(data.editorial ?? null)
        setDiscussions(data.discussions ?? [])
      })
      .catch(() => {})
    getProblemNeighbors(id!)
      .then((data) => {
        if (!cancelled) setNeighbors(data)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    getLanguages()
      .then((ls) => {
        if (cancelled) return
        setLanguages(ls)
        const preferred = preferredDraftLanguage(draftScope)
        const next = ls.some((item) => item.key === preferred) ? preferred : (ls[0]?.key ?? '')
        setLanguage(next)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [draftScope])

  useEffect(() => {
    return () => {
      if (mdCopiedTimer.current !== null) window.clearTimeout(mdCopiedTimer.current)
    }
  }, [])

  // 切换题目时回到题面标签与编辑器，并清空上一题的提交结果提示
  useEffect(() => {
    setTab('statement')
    setRightView('editor')
    setSubmittedId(null)
    setSubmitError('')
  }, [id])

  const changeLanguage = (next: string) => {
    flushDraft()
    rememberDraftLanguage(draftScope, next)
    setLanguage(next)
  }

  // 函数题的骨架随题目详情一起到达，可能比「语言选定」更晚：
  // 这时 useCodeDraft 已经跑过一轮，需要补一次种子。
  // 只在该语言还没有任何内容时补，避免覆盖选手正在写（或已清空）的代码。
  const seededRef = useRef('')
  useEffect(() => {
    if (!problem || !language) return
    const seed = problem.initial_codes?.[language]
    if (!seed) return
    const mark = `${problem.id}:${language}`
    if (seededRef.current === mark) return
    seededRef.current = mark
    if (code.trim()) return
    setCode(seed)
  }, [code, language, problem, setCode])

  const submit = async () => {
    if (!user) {
      setSubmitError('请先登录后再提交')
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
    setSubmitting(true)
    setSubmitError('')
    setSubmittedId(null)
    try {
      flushDraft()
      const res = await createSubmission(Number(id), language, code, optimize, assignmentId)
      setSubmittedId(res.id)
      setSubmissionRefreshKey((key) => key + 1)
      // 结果出现在右栏（测试点/结论），左栏题面保持不动——与旧版布局一致
      setRightView('submissions')
    } catch (err) {
      setSubmitError(extractError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const runProblemTest = useCallback(
    (input: string, sampleIndex?: number) => runTest(Number(id), language, code, input, optimize, sampleIndex),
    [code, id, language, optimize],
  )

  const toggleFavorite = async () => {
    if (!user) {
      setActionError('请先登录后收藏题目')
      return
    }
    try {
      setFavorite(await toggleProblemFavorite(Number(id)))
      setActionError('')
    } catch (err) {
      setActionError(extractError(err))
    }
  }

  const copyMarkdown = async () => {
    if (!problem) return
    const parts = [`# P${problem.id} ${problem.title}`, '', '## 题目描述', '', problem.statement]
    if (problem.input_format) parts.push('', '## 输入格式', '', problem.input_format)
    if (problem.output_format) parts.push('', '## 输出格式', '', problem.output_format)
    if (problem.samples.length > 0) {
      parts.push('', '## 样例')
      problem.samples.forEach((s, i) => {
        parts.push('', `### 样例 ${i + 1}`, '', '```', s.input, '```', '', '```', s.output, '```')
      })
    }
    if (problem.hint) parts.push('', '## 提示', '', problem.hint)
    const { copyText } = await import('../utils/clipboard')
    await copyText(parts.join('\n'))
    setMdCopied(true)
    if (mdCopiedTimer.current !== null) window.clearTimeout(mdCopiedTimer.current)
    mdCopiedTimer.current = window.setTimeout(() => setMdCopied(false), 1500)
  }

  const submitDiscussion = async () => {
    if (!user) {
      setActionError('请先登录后参与讨论')
      return
    }
    if (!discussionDraft.trim()) return
    setDiscussionBusy(true)
    try {
      const created = await createProblemDiscussion(Number(id), discussionDraft.trim())
      setDiscussions((list) => [...list, created])
      setDiscussionDraft('')
      setActionError('')
    } catch (err) {
      setActionError(extractError(err))
    } finally {
      setDiscussionBusy(false)
    }
  }

  const loadProblemSubmissions = useCallback(
    ({ page, size, problemId, userId }: { page: number; size: number; problemId: number; userId: number }) =>
      getSubmissions({ page, size, problem_id: String(problemId), user_id: String(userId) }),
    [],
  )

  const goTo = (target: number) => {
    if (target > 0) navigate(`/problem/${target}${assignmentId ? `?assignment_id=${assignmentId}` : ''}`)
  }

  if (loading) {
    return <div className="page-loading">题目加载中…</div>
  }

  if (error || !problem) {
    return (
      <div className="empty-state">
        <div className="empty-state-title">题目加载失败</div>
        <p className="empty-state-hint">{error || '题目不存在或已被撤下'}</p>
        <Link to="/problems" className="button button-primary">
          返回题库
        </Link>
      </div>
    )
  }

  const isAdmin = user?.role === 'admin'

  const statementPane = (
    <div className="wb-statement">
      {actionError && <div className="error-message">{actionError}</div>}
      <ProblemStatement
        problem={problem}
        onRunSample={(sample, index) => setPendingSample({ sample, index })}
      />
      <ProblemAttachmentList problemId={problem.id} />
    </div>
  )

  // 右栏评测面板：提交后替换编辑器显示，点「返回代码」切回编辑器
  const submissionsPane = (
    <SubmissionPanel
      title={`P${problem.id} · 我的提交`}
      problemId={problem.id}
      userId={user?.id ?? null}
      refreshKey={submissionRefreshKey}
      focusSubmissionId={submittedId}
      timeLimitMs={problem.time_limit_ms}
      memoryLimitKb={problem.memory_limit_kb}
      // 题目关闭「显示分数」后不出现得分列（与后端脱敏保持一致）
      showScore={problem.show_score !== false}
      onBack={() => setRightView('editor')}
      load={loadProblemSubmissions}
    />
  )

  const editorialPane = editorial ? (
    <article className="wb-editorial">
      <Markdown>{editorial.content}</Markdown>
      <p className="field-hint">最后更新：{formatTime(editorial.updated_at)}</p>
    </article>
  ) : (
    <div className="empty-state">
      <div className="empty-state-title">暂无题解</div>
      <p className="empty-state-hint">管理员发布题解后会显示在这里。</p>
    </div>
  )

  const discussionsPane = (
    <div className="wb-discussions">
      <form
        className="discussion-form"
        onSubmit={(e) => {
          e.preventDefault()
          void submitDiscussion()
        }}
      >
        <textarea
          value={discussionDraft}
          onChange={(e) => setDiscussionDraft(e.target.value)}
          placeholder={user ? '写下你的思路、疑问或反例…' : '登录后可参与讨论'}
          disabled={!user || discussionBusy}
          aria-label="发表讨论"
        />
        <div className="discussion-form-actions">
          <span className="field-hint">支持 Markdown 与 LaTeX</span>
          <button type="submit" className="button button-primary button-sm" disabled={!user || discussionBusy || !discussionDraft.trim()}>
            {discussionBusy ? '发布中…' : '发布'}
          </button>
        </div>
      </form>
      {discussions.length === 0 ? (
        <div className="empty-state">
          <div className="empty-state-title">还没有讨论</div>
          <p className="empty-state-hint">第一个分享思路的人往往收获最多。</p>
        </div>
      ) : (
        <ul className="discussion-list">
          {discussions.map((d) => (
            <li key={d.id} className="discussion-item">
              <div className="discussion-head">
                <strong>{d.username}</strong>
                <time dateTime={d.created_at}>{formatTime(d.created_at)}</time>
              </div>
              <Markdown>{d.content}</Markdown>
            </li>
          ))}
        </ul>
      )}
    </div>
  )

  return (
    <div className="wb-page">
      <header className="wb-topbar">
        <nav className="wb-breadcrumb" aria-label="面包屑">
          <Link to="/problems">题库</Link>
          <span className="breadcrumb-sep">/</span>
          <span>P{problem.id}</span>
        </nav>
        <div className="wb-topbar-actions">
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => goTo(neighbors.prev)}
            disabled={neighbors.prev === 0}
            title={neighbors.prev ? `上一题 P${neighbors.prev}` : '已经是第一题'}
          >
            ← 上一题
          </button>
          <button
            type="button"
            className="button button-ghost button-sm"
            onClick={() => goTo(neighbors.next)}
            disabled={neighbors.next === 0}
            title={neighbors.next ? `下一题 P${neighbors.next}` : '已经是最后一题'}
          >
            下一题 →
          </button>
        </div>
      </header>

      <ProblemWorkbench
        problem={problem}
        title={`P${problem.id} ${problem.title}`}
        languages={languages}
        language={language}
        onLanguageChange={changeLanguage}
        code={code}
        onCodeChange={setCode}
        optimize={optimize}
        onOptimizeChange={setOptimize}
        submitting={submitting}
        submitError={submitError}
        onSubmit={() => void submit()}
        onRun={runProblemTest}
        tab={tab}
        onTabChange={(key) => setTab(key as PaneTab)}
        tabs={[
          { key: 'statement', label: '题目' },
          { key: 'editorial', label: '题解' },
          { key: 'discussions', label: '讨论', count: discussions.length },
        ]}
        panes={{
          statement: statementPane,
          editorial: editorialPane,
          discussions: discussionsPane,
        }}
        // 提交后右栏切到评测结果（测试点/结论），左栏题面不动
        rightPane={rightView === 'submissions' ? submissionsPane : undefined}
        // 有历史提交时，右上角提供「我的提交」入口，便于随时回看
        metaActions={
          user ? (
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={() => setRightView((v) => (v === 'submissions' ? 'editor' : 'submissions'))}
            >
              {rightView === 'submissions' ? '返回代码' : '我的提交'}
            </button>
          ) : undefined
        }
        initialSample={pendingSample}
        onInitialSampleConsumed={() => setPendingSample(null)}
        meta={
          <div className="wb-meta">
            <DifficultyBadge value={problem.difficulty} />
            {problem.provider && <span className="wb-meta-item">提供者 {problem.provider}</span>}
            <span className="wb-meta-item">时间限制 {formatTimeLimit(problem.time_limit_ms)}</span>
            <span className="wb-meta-item">内存限制 {formatMemory(problem.memory_limit_kb)}</span>
            <span className="wb-meta-item">
              通过 {problem.accepted_count} / 提交 {problem.submission_count}
            </span>
            <div className="wb-meta-actions">
              <button type="button" className="button button-ghost button-sm" onClick={() => void toggleFavorite()}>
                {favorite ? '★ 已收藏' : '☆ 收藏'}
              </button>
              <button
                type="button"
                className={mdCopied ? 'button button-ghost button-sm copied' : 'button button-ghost button-sm'}
                onClick={() => void copyMarkdown()}
              >
                {mdCopied ? '已复制' : '复制 Markdown'}
              </button>
              {isAdmin && (
                <Link to={`/problem/${problem.id}/edit`} className="button button-ghost button-sm">
                  编辑
                </Link>
              )}
            </div>
          </div>
        }
      />
    </div>
  )
}
