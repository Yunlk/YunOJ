import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import {
  createSubmission,
  extractError,
  getLanguages,
  getProblemLearning,
  getProblem,
  toggleProblemFavorite,
  createProblemDiscussion,
  getSubmissions,
  runTest,
  uploadTests,
} from '../api'
import ProblemStatement from '../components/ProblemStatement'
import Markdown from '../components/Markdown'
import ProblemWorkbench from '../components/ProblemWorkbench'
import SubmissionPanel from '../components/SubmissionPanel'
import DifficultyBadge from '../components/DifficultyBadge'
import { useAuth } from '../context/AuthContext'
import { preferredDraftLanguage, rememberDraftLanguage, useCodeDraft } from '../hooks/useCodeDraft'
import type { Language, ProblemDetail as ProblemDetailType, Sample } from '../types'
import { copyText } from '../utils/clipboard'
import { formatMemory, formatTimeLimit } from '../utils/format'

type ViewMode = 'normal' | 'ide' | 'submissions'

export default function ProblemDetail() {
  const { id } = useParams()
  const [searchParams] = useSearchParams()
  const { user } = useAuth()

  const assignmentIdParam = Number(searchParams.get('assignment_id') ?? '0')
  const assignmentId = assignmentIdParam > 0 ? assignmentIdParam : undefined

  const [problem, setProblem] = useState<ProblemDetailType | null>(null)
  const [favorite, setFavorite] = useState(false)
  const [discussions, setDiscussions] = useState<import('../types').ProblemDiscussion[]>([])
  const [editorial, setEditorial] = useState<import('../types').ProblemEditorial | null>(null)
  const [discussionText, setDiscussionText] = useState('')
  const [discussionError, setDiscussionError] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [languages, setLanguages] = useState<Language[]>([])
  const draftScope = `${assignmentId ? `assignment:${assignmentId}:` : ''}problem:${id}:user:${user?.id ?? 'guest'}`
  const [language, setLanguage] = useState('')
  const { code, setCode, flushDraft } = useCodeDraft(draftScope, language)
  const [optimize, setOptimize] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submittedId, setSubmittedId] = useState<number | null>(null)
  const [submissionRefreshKey, setSubmissionRefreshKey] = useState(0)

  const [mode, setMode] = useState<ViewMode>('normal')
  const [pendingSample, setPendingSample] = useState<Sample | null>(null)

  // 复制 Markdown 按钮的绿色反馈
  const [mdCopied, setMdCopied] = useState(false)
  const mdCopiedTimer = useRef<number | null>(null)

  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploading, setUploading] = useState(false)
  const [uploadMsg, setUploadMsg] = useState('')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getProblem(id!)
      .then((p) => {
        if (cancelled) return
        setProblem(p)
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
        setDiscussions(data.discussions)
        setEditorial(data.editorial ?? null)
      })
      .catch(() => {})
    return () => { cancelled = true }
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

  const changeLanguage = (next: string) => {
    flushDraft()
    rememberDraftLanguage(draftScope, next)
    setLanguage(next)
  }

  useEffect(() => {
    return () => {
      if (mdCopiedTimer.current !== null) window.clearTimeout(mdCopiedTimer.current)
    }
  }, [])

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
      setMode('submissions')
    } catch (err) {
      setSubmitError(extractError(err))
    } finally {
      setSubmitting(false)
    }
  }

  const runProblemTest = useCallback(
    (input: string) => runTest(Number(id), language, code, input, optimize),
    [code, id, language, optimize],
  )

  const toggleFavorite = async () => {
    if (!user) { setDiscussionError('请先登录后收藏题目'); return }
    try { setFavorite(await toggleProblemFavorite(Number(id))) } catch (err) { setDiscussionError(extractError(err)) }
  }

  const postDiscussion = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!user) { setDiscussionError('请先登录后参与讨论'); return }
    if (!discussionText.trim()) return
    try {
      const item = await createProblemDiscussion(Number(id), discussionText.trim())
      setDiscussions((current) => [item, ...current])
      setDiscussionText('')
      setDiscussionError('')
    } catch (err) { setDiscussionError(extractError(err)) }
  }

  const runSampleFromDetail = (sample: Sample) => {
    setPendingSample(sample)
    setMode('ide')
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
    await copyText(parts.join('\n'))
    // 绿色反馈：按钮短暂变绿表示复制成功
    setMdCopied(true)
    if (mdCopiedTimer.current !== null) window.clearTimeout(mdCopiedTimer.current)
    mdCopiedTimer.current = window.setTimeout(() => setMdCopied(false), 1500)
  }

  const onUpload = async () => {
    if (!uploadFile) {
      setUploadMsg('请先选择 zip 文件')
      return
    }
    setUploading(true)
    setUploadMsg('')
    try {
      const res = await uploadTests(id!, uploadFile)
      setUploadMsg(`上传成功，共 ${res.count} 个测试点`)
      setUploadFile(null)
    } catch (err) {
      setUploadMsg(extractError(err))
    } finally {
      setUploading(false)
    }
  }

  const loadProblemSubmissions = useCallback(
    ({ page, size, problemId, userId }: { page: number; size: number; problemId: number; userId: number }) =>
      getSubmissions({
        page,
        size,
        problem_id: String(problemId),
        user_id: String(userId),
      }),
    [],
  )

  if (loading) {
    return <div className="page-loading">加载中…</div>
  }

  if (error || !problem) {
    return (
      <div className="no-permission">
        <h1>加载失败</h1>
        <p>{error || '题目不存在'}</p>
        <Link to="/" className="button button-primary">
          返回题目列表
        </Link>
      </div>
    )
  }

  const isAdmin = user?.role === 'admin'
  /* ---------- IDE 工作台视图 ---------- */
  if (mode === 'ide' || mode === 'submissions') {
    return (
      <div className="problem-page problem-workspace-page">
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
          submittedId={submittedId}
          onSubmit={() => void submit()}
          onRun={runProblemTest}
          showSubmissions={mode === 'submissions'}
          initialSample={pendingSample}
          onInitialSampleConsumed={() => setPendingSample(null)}
          statementMeta={(
            <div className="workbench-meta-line">
              <span><DifficultyBadge value={problem.difficulty} /></span>
              <span>时间限制 {formatTimeLimit(problem.time_limit_ms)}</span>
              <span>内存限制 {formatMemory(problem.memory_limit_kb)}</span>
              <span>提交 {problem.submission_count}</span>
              <span>通过 {problem.accepted_count}</span>
            </div>
          )}
          headerActions={(
            <>
              <button
                type="button"
                className={mdCopied ? 'mini-btn copied' : 'mini-btn'}
                onClick={() => void copyMarkdown()}
              >
                复制 Markdown
              </button>
              {isAdmin && (
                <Link to={`/problem/${problem.id}/edit`} className="mini-btn">编辑</Link>
              )}
              <button type="button" className="mini-btn" onClick={() => setMode('normal')}>
                退出 IDE 模式
              </button>
            </>
          )}
          statementFooter={isAdmin ? (
            <section className="section">
              <h2 className="section-title">上传测试数据</h2>
              <div className="upload-area">
                <input
                  type="file"
                  accept=".zip"
                  onChange={(event) => setUploadFile(event.target.files?.[0] ?? null)}
                />
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={onUpload}
                  disabled={uploading}
                >
                  {uploading ? '上传中…' : '上传 zip'}
                </button>
                {uploadMsg && <span className="muted">{uploadMsg}</span>}
              </div>
            </section>
          ) : undefined}
          submissionPanel={(
              <SubmissionPanel
                title={`P${problem.id} · 我的提交`}
                problemId={problem.id}
                userId={user?.id ?? null}
                refreshKey={submissionRefreshKey}
                focusSubmissionId={submittedId}
                timeLimitMs={problem.time_limit_ms}
                memoryLimitKb={problem.memory_limit_kb}
                onBack={() => setMode('ide')}
                load={loadProblemSubmissions}
              />
          )}
        />
      </div>
    )
  }

  /* ---------- 普通题目详情视图 ---------- */
  return (
    <div className="problem-page">
      {/* 顶部题目概览卡片 */}
      <div className="overview-card">
        <div className="overview-top">
          <h1 className="overview-title">
            P{problem.id} {problem.title}
          </h1>
          <div className="overview-stats">
            <span className="overview-stat">
              <b>{problem.submission_count}</b> 提交数
            </span>
            <span className="overview-stat">
              <b>{problem.accepted_count}</b> 通过数
            </span>
            <span className="overview-stat">
              <b>{formatTimeLimit(problem.time_limit_ms)}</b> 时间限制
            </span>
            <span className="overview-stat">
              <b>{formatMemory(problem.memory_limit_kb)}</b> 内存限制
            </span>
          </div>
        </div>
        <div className="overview-bottom">
          <div className="overview-tabs">
            <span className="overview-tab active">题目描述</span>
            <Link to={`/problem/${problem.id}/submit-file`} className="overview-tab">
              提交答案
            </Link>
          </div>
          <div className="overview-actions">
            <button type="button" className="button button-secondary" onClick={() => void toggleFavorite()}>{favorite ? '已收藏' : '收藏题目'}</button>
            <button
              type="button"
              className="button button-primary"
              onClick={() => setMode('ide')}
            >
              进入 IDE 模式
            </button>
          </div>
        </div>
      </div>

      <section className={`problem-learning-grid${editorial ? '' : ' single-column'}`}>
        {editorial && <div className="side-card problem-editorial-card"><div className="side-card-title">官方题解</div><Markdown>{editorial.content}</Markdown></div>}
        <div className="side-card problem-discussion-card"><div className="side-card-title">题目讨论 <span className="muted">{discussions.length}</span></div><form className="discussion-form" onSubmit={postDiscussion}><textarea value={discussionText} onChange={(event) => setDiscussionText(event.target.value)} placeholder="分享思路、提问或补充说明…" rows={3} /><button className="button button-secondary" type="submit">发布讨论</button></form>{discussionError && <div className="error-message">{discussionError}</div>}<div className="discussion-list">{discussions.length === 0 ? <p className="muted">还没有讨论。</p> : discussions.map((item) => <article className="discussion-item" key={item.id}><div><strong>{item.username}</strong><time>{item.created_at.slice(0, 16).replace('T', ' ')}</time></div><p>{item.content}</p></article>)}</div></div>
      </section>

      {/* 下方：左宽右窄两栏 */}
      <div className="problem-detail-grid">
        <div className="statement-card">
          <div className="statement-card-header">
            <span className="statement-label">题面</span>
            <div className="statement-actions">
              <button
                type="button"
                className={mdCopied ? 'mini-btn copied' : 'mini-btn'}
                onClick={() => void copyMarkdown()}
              >
                复制 Markdown
              </button>
              <button type="button" className="mini-btn" onClick={() => setMode('ide')}>
                进入 IDE 模式
              </button>
              {isAdmin && (
                <Link to={`/problem/${problem.id}/edit`} className="mini-btn">
                  编辑
                </Link>
              )}
            </div>
          </div>
          <div className="statement-content">
            <ProblemStatement problem={problem} onRunSample={runSampleFromDetail} />
          </div>
        </div>

        <div className="sidebar">
          <div className="side-card">
            <div className="side-card-title">题目信息</div>
            <div className="side-row">
              <span className="side-label">题目编号</span>
              <span className="mono">P{problem.id}</span>
            </div>
            <div className="side-row">
              <span className="side-label">难度</span>
              <DifficultyBadge value={problem.difficulty} />
            </div>
            <div className="side-row">
              <span className="side-label">标签</span>
              <span className="tag-list">
                {problem.tags.length > 0
                  ? problem.tags.map((t) => (
                      <span key={t} className="tag-chip">
                        {t}
                      </span>
                    ))
                  : '暂无标签'}
              </span>
            </div>
            <div className="side-row">
              <span className="side-label">提交</span>
              <Link to="/status" className="side-link">
                提交记录
              </Link>
            </div>
          </div>

        </div>
      </div>
    </div>
  )
}
