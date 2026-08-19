import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  createSubmission,
  extractError,
  getLanguages,
  getProblem,
  runTest,
  uploadTests,
} from '../api'
import type { RunTestResult } from '../api'
import CodeEditor from '../components/CodeEditor'
import type { CursorPosition } from '../components/CodeEditor'
import Markdown from '../components/Markdown'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import type { Language, ProblemDetail as ProblemDetailType, Sample } from '../types'
import { copyText, tokenCompare } from '../utils/clipboard'
import { formatMemory, formatRunTime, formatTimeLimit } from '../utils/format'

type ViewMode = 'normal' | 'ide'

const FONT_SIZES = [12, 13, 14, 16, 18]

function difficultyInfo(d: number): { label: string; className: string } {
  if (d <= 3) return { label: '简单', className: 'diff-easy' }
  if (d <= 6) return { label: '中等', className: 'diff-medium' }
  return { label: '困难', className: 'diff-hard' }
}

export default function ProblemDetail() {
  const { id } = useParams()
  const { user } = useAuth()

  const [problem, setProblem] = useState<ProblemDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [languages, setLanguages] = useState<Language[]>([])
  const [language, setLanguage] = useState('')
  const [code, setCode] = useState('')
  const [optimize, setOptimize] = useState(true)
  const [fontSize, setFontSize] = useState(14)
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [submittedId, setSubmittedId] = useState<number | null>(null)

  // 视图与 IDE 状态
  const [mode, setMode] = useState<ViewMode>('normal')
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })

  // 运行控制台（输入/运行/输出）
  const [testInput, setTestInput] = useState('')
  const [expectedForRun, setExpectedForRun] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState<RunTestResult | null>(null)

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
    getLanguages()
      .then((ls) => {
        if (cancelled) return
        setLanguages(ls)
        if (ls.length > 0) setLanguage((prev) => prev || ls[0].key)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

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
      const res = await createSubmission(Number(id), language, code, optimize)
      setCode('')
      setSubmittedId(res.id)
    } catch (err) {
      setSubmitError(extractError(err))
    } finally {
      setSubmitting(false)
    }
  }

  // 用指定输入运行（样例的「运行」按钮也会走到这里）
  const runWithInput = async (input: string) => {
    if (!language) return
    if (!code.trim()) {
      setTestError('代码不能为空')
      return
    }
    setMode('ide')
    setConsoleOpen(true)
    setTestInput(input)
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      setTestResult(await runTest(Number(id), language, code, input, optimize))
    } catch (err) {
      setTestError(extractError(err))
    } finally {
      setTesting(false)
    }
  }

  // 样例面板的「运行」：载入该样例输入并运行，同时记录期望输出用于比对
  const runSample = (sample: Sample) => {
    setExpectedForRun(sample.output)
    void runWithInput(sample.input)
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
  const languageName = languages.find((l) => l.key === language)?.name ?? ''
  const diff = difficultyInfo(problem.difficulty)

  // 样例运行结果的前端即时比对（token 比较，与后端一致）
  const samplePassed =
    testResult && expectedForRun !== null && testResult.status === 'accepted'
      ? tokenCompare(expectedForRun, testResult.stdout)
      : null

  /* ---------- 样例面板（左右并排，各带 运行/复制） ---------- */
  const samplePanels = (samples: Sample[]) => (
    <div className="samples-grid">
      {samples.map((s, i) => (
        <div key={i} className="sample-panel-group">
          <div className="sample-panel">
            <div className="sample-panel-head">
              <span className="sample-panel-title">输入 #{i + 1}</span>
              <span className="sample-panel-actions">
                <button type="button" className="mini-btn" onClick={() => runSample(s)}>
                  运行
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => void copyText(s.input)}
                >
                  复制
                </button>
              </span>
            </div>
            <pre className="sample-panel-content">{s.input}</pre>
          </div>
          <div className="sample-panel">
            <div className="sample-panel-head">
              <span className="sample-panel-title">输出 #{i + 1}</span>
              <span className="sample-panel-actions">
                <button type="button" className="mini-btn" onClick={() => runSample(s)}>
                  运行
                </button>
                <button
                  type="button"
                  className="mini-btn"
                  onClick={() => void copyText(s.output)}
                >
                  复制
                </button>
              </span>
            </div>
            <pre className="sample-panel-content">{s.output}</pre>
          </div>
        </div>
      ))}
    </div>
  )

  /* ---------- 题面正文（两种视图共用） ---------- */
  const statementBody = (
    <>
      {problem.statement && (
        <section className="section">
          <h2 className="section-title">题目描述</h2>
          <Markdown>{problem.statement}</Markdown>
        </section>
      )}
      {problem.input_format && (
        <section className="section">
          <h2 className="section-title">输入格式</h2>
          <Markdown>{problem.input_format}</Markdown>
        </section>
      )}
      {problem.output_format && (
        <section className="section">
          <h2 className="section-title">输出格式</h2>
          <Markdown>{problem.output_format}</Markdown>
        </section>
      )}
      {problem.samples.length > 0 && (
        <section className="section">
          <h2 className="section-title">输入输出样例</h2>
          {samplePanels(problem.samples)}
        </section>
      )}
      {problem.hint && (
        <section className="section">
          <h2 className="section-title">说明 / 提示</h2>
          <Markdown>{problem.hint}</Markdown>
        </section>
      )}
    </>
  )

  /* ---------- 运行控制台（IDE 底部：输入 | 输出） ---------- */
  const runConsole = (
    <div className="run-console">
      <div className="run-console-bar">
        <span className="console-label">输入</span>
        <button
          type="button"
          className="console-run-button"
          onClick={() => void runWithInput(testInput)}
          disabled={testing}
        >
          {testing ? '运行中…' : '▶ 运行'}
        </button>
        <span className="console-label">输出</span>
        {samplePassed !== null && (
          <span className={samplePassed ? 'console-badge passed' : 'console-badge failed'}>
            {samplePassed ? '样例通过' : '样例未通过'}
          </span>
        )}
      </div>
      <div className="run-console-body">
        <textarea
          className="console-input"
          value={testInput}
          onChange={(e) => {
            setTestInput(e.target.value)
            setExpectedForRun(null)
          }}
          placeholder="输入测试数据…"
          spellCheck={false}
        />
        <div className="console-divider" />
        <div className="console-output">
          {testError && <div className="error-message">{testError}</div>}
          {testResult?.compile_error && (
            <pre className="code-block compile-error">{testResult.compile_error}</pre>
          )}
          {testResult && !testResult.compile_error && (
            <>
              <div className="test-result-meta">
                <StatusBadge status={testResult.status} />
                <span className="run-meta">
                  {formatRunTime(testResult.time_ms)} · {formatMemory(testResult.memory_kb)}
                </span>
              </div>
              <pre className="io-output">{testResult.stdout || '（无输出）'}</pre>
              {testResult.stderr && (
                <>
                  <div className="io-label">标准错误</div>
                  <pre className="io-output">{testResult.stderr}</pre>
                </>
              )}
            </>
          )}
          {!testError && !testResult && (
            <div className="console-empty">运行后在此显示输出</div>
          )}
        </div>
      </div>
    </div>
  )

  /* ---------- IDE 工作台视图 ---------- */
  if (mode === 'ide') {
    return (
      <div className="problem-page">
        <div className="workbench">
          {/* 左：题面（独立纵向滚动） */}
          <div className="workbench-problem">
            <div className="workbench-problem-head">
              <h1 className="workbench-title">
                P{problem.id} {problem.title}
              </h1>
              <div className="workbench-problem-actions">
                <button
                  type="button"
                  className={mdCopied ? 'mini-btn copied' : 'mini-btn'}
                  onClick={() => void copyMarkdown()}
                >
                  复制 Markdown
                </button>
                {isAdmin && (
                  <Link to={`/problem/${problem.id}/edit`} className="mini-btn">
                    编辑
                  </Link>
                )}
                <button type="button" className="mini-btn" onClick={() => setMode('normal')}>
                  退出 IDE 模式
                </button>
              </div>
            </div>
            <div className="workbench-problem-body">
              {statementBody}
              {isAdmin && (
                <section className="section">
                  <h2 className="section-title">上传测试数据</h2>
                  <div className="upload-area">
                    <input
                      type="file"
                      accept=".zip"
                      onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
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
              )}
            </div>
          </div>

          {/* 右：IDE */}
          <div className="workbench-ide">
            <div className="ide-toolbar">
              <span className="ide-code-label">代码</span>
              <div className="ide-toolbar-right">
                <button
                  type="button"
                  className={consoleOpen ? 'toolbar-button active' : 'toolbar-button'}
                  onClick={() => setConsoleOpen((v) => !v)}
                >
                  自测
                </button>
                <div className="settings-wrap">
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => setSettingsOpen((v) => !v)}
                  >
                    设置
                  </button>
                  {settingsOpen && (
                    <>
                      <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />
                      <div className="settings-pop">
                        <div className="settings-pop-title">字号</div>
                        {FONT_SIZES.map((sz) => (
                          <button
                            key={sz}
                            type="button"
                            className={fontSize === sz ? 'font-size-opt active' : 'font-size-opt'}
                            onClick={() => {
                              setFontSize(sz)
                              setSettingsOpen(false)
                            }}
                          >
                            {sz}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <select
                  className="select-input"
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  aria-label="语言"
                >
                  {languages.length === 0 && <option value="">加载语言中…</option>}
                  {languages.map((l) => (
                    <option key={l.key} value={l.key}>
                      {l.name}
                    </option>
                  ))}
                </select>
                <label className="o2-check">
                  <input
                    type="checkbox"
                    checked={optimize}
                    onChange={(e) => setOptimize(e.target.checked)}
                  />
                  O2 优化
                </label>
                <button
                  type="button"
                  className="button button-primary ide-submit-button"
                  onClick={submit}
                  disabled={submitting}
                >
                  {submitting ? '提交中…' : '提交'}
                </button>
              </div>
            </div>

            <div className="ide-editor-body">
              <CodeEditor
                language={language}
                value={code}
                onChange={setCode}
                onCtrlEnter={submit}
                onCursorChange={setCursor}
                fontSize={fontSize}
              />
            </div>

            {consoleOpen && runConsole}

            <div className="ide-statusbar">
              <span>
                Ln {cursor.line}, Col {cursor.column}
              </span>
              <span>{languageName}</span>
              <span>{optimize ? 'O2' : '无优化'}</span>
              <span>字号 {fontSize}</span>
              <span className="ide-status-right">Ctrl+Enter 提交</span>
            </div>

            {submitError && <div className="ide-message error-message">{submitError}</div>}
            {submittedId !== null && (
              <div className="ide-submitted">
                已提交 <Link to={`/submission/${submittedId}`}>#{submittedId}</Link>
              </div>
            )}
          </div>
        </div>
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

      {/* 下方：左宽右窄两栏 */}
      <div className="problem-detail-grid">
        <div className="statement-card">
          <div className="statement-card-header">
            <span className="statement-label">题目描述</span>
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
          <div className="statement-content">{statementBody}</div>
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
              <span className={`difficulty-badge ${diff.className}`}>{diff.label}</span>
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

          <div className="side-card">
            <div className="side-card-title">标签</div>
            <div className="side-row">
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
          </div>
        </div>
      </div>
    </div>
  )
}
