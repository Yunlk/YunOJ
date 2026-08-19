import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { extractError } from '../api'
import type { RunTestResult } from '../api'
import type { Language, ProblemDetail, Sample } from '../types'
import { tokenCompare } from '../utils/clipboard'
import { formatMemory, formatRunTime } from '../utils/format'
import CodeEditor from './CodeEditor'
import type { CursorPosition } from './CodeEditor'
import ProblemStatement from './ProblemStatement'
import StatusBadge from './StatusBadge'

const FONT_SIZES = [12, 13, 14, 16, 18]

interface ProblemWorkbenchProps {
  problem: ProblemDetail
  title: string
  languages: Language[]
  language: string
  onLanguageChange: (language: string) => void
  code: string
  onCodeChange: (code: string) => void
  optimize: boolean
  onOptimizeChange: (optimize: boolean) => void
  submitting: boolean
  submitError: string
  submittedId: number | null
  onSubmit: () => void
  onRun: (input: string) => Promise<RunTestResult>
  showSubmissions: boolean
  submissionPanel: ReactNode
  canSubmit?: boolean
  submitLabel?: string
  submitDisabledReason?: string
  headerActions?: ReactNode
  statementMeta?: ReactNode
  statementFooter?: ReactNode
  editorFooter?: ReactNode
  className?: string
  initialSample?: Sample | null
  onInitialSampleConsumed?: () => void
}

export default function ProblemWorkbench({
  problem,
  title,
  languages,
  language,
  onLanguageChange,
  code,
  onCodeChange,
  optimize,
  onOptimizeChange,
  submitting,
  submitError,
  submittedId,
  onSubmit,
  onRun,
  showSubmissions,
  submissionPanel,
  canSubmit = true,
  submitLabel = '提交',
  submitDisabledReason,
  headerActions,
  statementMeta,
  statementFooter,
  editorFooter,
  className = '',
  initialSample = null,
  onInitialSampleConsumed,
}: ProblemWorkbenchProps) {
  const [consoleOpen, setConsoleOpen] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [mobilePane, setMobilePane] = useState<'statement' | 'editor'>('statement')
  const [fontSize, setFontSize] = useState(14)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })
  const [testInput, setTestInput] = useState('')
  const [expectedForRun, setExpectedForRun] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState<RunTestResult | null>(null)
  const consumedSample = useRef<Sample | null>(null)

  const runWithInput = useCallback(async (input: string) => {
    if (!language) {
      setTestError('请选择语言')
      return
    }
    if (!code.trim()) {
      setTestError('代码不能为空')
      return
    }
    setConsoleOpen(true)
    setTestInput(input)
    setTesting(true)
    setTestError('')
    setTestResult(null)
    try {
      setTestResult(await onRun(input))
    } catch (err) {
      setTestError(extractError(err))
    } finally {
      setTesting(false)
    }
  }, [code, language, onRun])

  const runSample = useCallback((sample: Sample) => {
    setExpectedForRun(sample.output)
    void runWithInput(sample.input)
  }, [runWithInput])

  useEffect(() => {
    if (!initialSample || consumedSample.current === initialSample) return
    consumedSample.current = initialSample
    runSample(initialSample)
    onInitialSampleConsumed?.()
  }, [initialSample, onInitialSampleConsumed, runSample])

  const samplePassed =
    testResult && expectedForRun !== null && testResult.status === 'accepted'
      ? tokenCompare(expectedForRun, testResult.stdout)
      : null
  const selectedLanguage = languages.find((item) => item.key === language)
  const languageName = selectedLanguage
    ? `${selectedLanguage.name} · ${selectedLanguage.version}`
    : ''

  return (
    <div className={`workbench workbench-mobile-${mobilePane} ${className}`.trim()}>
      <div className="workbench-mobile-tabs" role="tablist" aria-label="作答视图">
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'statement'}
          className={mobilePane === 'statement' ? 'active' : ''}
          onClick={() => setMobilePane('statement')}
        >
          题目
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mobilePane === 'editor'}
          className={mobilePane === 'editor' ? 'active' : ''}
          onClick={() => setMobilePane('editor')}
        >
          {showSubmissions ? '评测' : '代码'}
        </button>
      </div>
      <div className="workbench-problem">
        <div className="workbench-problem-head">
          <h1 className="workbench-title">{title}</h1>
          {headerActions && <div className="workbench-problem-actions">{headerActions}</div>}
        </div>
        <div className="workbench-problem-body">
          {statementMeta}
          <ProblemStatement problem={problem} onRunSample={runSample} />
          {statementFooter}
        </div>
      </div>

      <div className="workbench-ide">
        {showSubmissions ? submissionPanel : (
          <>
            <div className="ide-toolbar">
              <span className="ide-code-label">代码</span>
              <div className="ide-toolbar-right">
                <button
                  type="button"
                  className={consoleOpen ? 'toolbar-button active' : 'toolbar-button'}
                  onClick={() => setConsoleOpen((value) => !value)}
                >
                  自测
                </button>
                <div className="settings-wrap">
                  <button
                    type="button"
                    className="toolbar-button"
                    onClick={() => setSettingsOpen((value) => !value)}
                  >
                    设置
                  </button>
                  {settingsOpen && (
                    <>
                      <div className="settings-backdrop" onClick={() => setSettingsOpen(false)} />
                      <div className="settings-pop">
                        <div className="settings-pop-title">字号</div>
                        {FONT_SIZES.map((size) => (
                          <button
                            key={size}
                            type="button"
                            className={fontSize === size ? 'font-size-opt active' : 'font-size-opt'}
                            onClick={() => {
                              setFontSize(size)
                              setSettingsOpen(false)
                            }}
                          >
                            {size}
                          </button>
                        ))}
                      </div>
                    </>
                  )}
                </div>
                <select
                  className="select-input"
                  value={language}
                  onChange={(event) => onLanguageChange(event.target.value)}
                  aria-label="语言"
                >
                  {languages.length === 0 && <option value="">加载语言中…</option>}
                  {languages.map((item) => (
                    <option key={item.key} value={item.key}>{item.name} · {item.version}</option>
                  ))}
                </select>
                {selectedLanguage?.supports_optimize && (
                  <label className="o2-check">
                    <input
                      type="checkbox"
                      checked={optimize}
                      onChange={(event) => onOptimizeChange(event.target.checked)}
                    />
                    O2 优化
                  </label>
                )}
                <button
                  type="button"
                  className="button button-primary ide-submit-button"
                  onClick={onSubmit}
                  disabled={submitting || !canSubmit}
                >
                  {submitting ? '提交中…' : submitLabel}
                </button>
              </div>
            </div>

            <div className="ide-editor-body">
              <CodeEditor
                language={language}
                monacoLanguage={selectedLanguage?.monaco}
                value={code}
                onChange={onCodeChange}
                onCtrlEnter={canSubmit ? onSubmit : undefined}
                onCursorChange={setCursor}
                fontSize={fontSize}
              />
            </div>

            {consoleOpen && (
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
                    onChange={(event) => {
                      setTestInput(event.target.value)
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
                    {!testError && !testResult && <div className="console-empty">运行后在此显示输出</div>}
                  </div>
                </div>
              </div>
            )}

            <div className="ide-statusbar">
              <span>Ln {cursor.line}, Col {cursor.column}</span>
              <span>{languageName}</span>
              {selectedLanguage?.supports_optimize && <span>{optimize ? 'O2' : '无优化'}</span>}
              <span>字号 {fontSize}</span>
              <span className="ide-status-right">Ctrl+Enter 提交</span>
            </div>
            {submitDisabledReason && <div className="ide-disabled-reason">{submitDisabledReason}</div>}
            {submitError && <div className="ide-message error-message">{submitError}</div>}
            {submittedId !== null && (
              <div className="ide-submitted">
                已提交 <Link to={`/submission/${submittedId}`}>#{submittedId}</Link>
              </div>
            )}
            {editorFooter && <div className="ide-context-footer">{editorFooter}</div>}
          </>
        )}
      </div>
    </div>
  )
}
