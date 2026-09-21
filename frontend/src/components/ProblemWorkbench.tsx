import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode } from 'react'
import { extractError } from '../api'
import type { RunTestResult } from '../api'
import type { Language, ProblemDetail, Sample } from '../types'
import { getStatusInfo } from '../utils/status'
import CodeEditor from './CodeEditor'
import type { CursorPosition } from './CodeEditor'
import ProblemStatement from './ProblemStatement'

const FONT_SIZES = [12, 13, 14, 16, 18]
const SPLIT_KEY = 'yunoj:workbench:split'
const MIN_PANE = 320
const SELF_TEST_LABELS: Record<string, string> = {
  pending: '等待中',
  running: '评测中',
  wrong_answer: '答案错误',
  presentation_error: '格式错误',
  time_limit_exceeded: '超时',
  memory_limit_exceeded: '超内存',
  output_limit_exceeded: '输出超限',
  runtime_error: '运行错误',
  compile_error: '编译错误',
  system_error: '系统错误',
  not_run: '未运行',
}

export interface WorkbenchTab {
  key: string
  label: string
  count?: number
}

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
  onSubmit: () => void
  onRun: (input: string, sampleIndex?: number) => Promise<RunTestResult>
  /** 左栏标签页（新模式）；不传时走兼容模式：左栏只放题面，右栏在编辑器/提交面板间切换 */
  tabs?: WorkbenchTab[]
  tab?: string
  onTabChange?: (key: string) => void
  panes?: Record<string, ReactNode>
  /**
   * rightPane 提供时替换右栏内容（例如提交后展示评测结果/测试点面板）。
   * 未提供时右栏是编辑器——这样「提交后看结果」仍在右侧，左栏保持题面不动。
   */
  rightPane?: ReactNode
  /** 题目标题下方元信息行里的额外动作（如「我的提交」开关） */
  metaActions?: ReactNode
  /** 题目标题下方的元信息行 */
  meta?: ReactNode
  canSubmit?: boolean
  submitLabel?: string
  submitDisabledReason?: string
  initialSample?: { sample: Sample; index: number } | null
  onInitialSampleConsumed?: () => void
  /* ---------- 兼容模式（比赛内做题页 ContestProblemPage 使用） ---------- */
  className?: string
  showSubmissions?: boolean
  headerActions?: ReactNode
  statementMeta?: ReactNode
  statementFooter?: ReactNode
  editorFooter?: ReactNode
  submissionPanel?: ReactNode
}

/**
 * 题目工作台：左「题面/提交/题解/讨论」+ 右「编辑器/自测」。
 * 分栏宽度记忆在本地，窄屏自动切换为单栏标签模式。
 */
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
  onSubmit,
  onRun,
  tabs,
  tab,
  onTabChange,
  panes,
  rightPane,
  metaActions,
  meta,
  canSubmit = true,
  submitLabel = '提交',
  submitDisabledReason,
  initialSample = null,
  onInitialSampleConsumed,
  className = '',
  showSubmissions = false,
  headerActions,
  statementMeta,
  statementFooter,
  editorFooter,
  submissionPanel,
}: ProblemWorkbenchProps) {
  const hackMode = problem.type === 'hack'
  // 函数题：题目下发了函数骨架时，工具栏提供「恢复函数」把编辑器还原成骨架。
  // 只在有骨架、且当前内容与骨架不同时可用（避免点了没反应）。
  const skeleton = problem.initial_codes?.[language] ?? ''
  const canRestoreSkeleton = problem.type === 'function' && skeleton !== '' && code !== skeleton
  const restoreSkeleton = () => {
    if (!canRestoreSkeleton) return
    if (!window.confirm('把编辑器内容恢复成题目给出的函数骨架？当前代码会被替换。')) return
    onCodeChange(skeleton)
  }
  // 兼容模式：未提供 panes 时，左栏只放题面，右栏在编辑器与提交面板之间切换
  const legacy = !panes
  const [split, setSplit] = useState(() => {
    const raw = Number(window.localStorage.getItem(SPLIT_KEY))
    return raw >= 0.2 && raw <= 0.8 ? raw : 0.46
  })
  const [narrow, setNarrow] = useState(() => window.matchMedia('(max-width: 1024px)').matches)
  const [mobilePane, setMobilePane] = useState<'left' | 'editor'>('left')
  const [fontSize, setFontSize] = useState(14)
  const [cursor, setCursor] = useState<CursorPosition>({ line: 1, column: 1 })
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState('')
  const [testResult, setTestResult] = useState<RunTestResult | null>(null)
  const [testInput, setTestInput] = useState('')
  const [sampleIndexForRun, setSampleIndexForRun] = useState<number | null>(null)
  const consumedSample = useRef<{ sample: Sample; index: number } | null>(null)
  const shellRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<{ pointerId: number } | null>(null)

  // 窄屏（平板/手机）退化为单栏切换
  useEffect(() => {
    const query = window.matchMedia('(max-width: 1024px)')
    const update = () => setNarrow(query.matches)
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])

  const runWithInput = useCallback(
    async (input: string, sampleIndex?: number) => {
      // 先把抽屉打开并回填输入，再校验：否则「代码为空」这类提示会藏在关闭的抽屉里，
      // 用户点了运行却看不到任何反馈。
      if (narrow) setMobilePane('editor')
      setDrawerOpen(true)
      setTestInput(input)
      setSampleIndexForRun(sampleIndex ?? null)
      setTestError('')
      setTestResult(null)
      if (!language) {
        setTestError('请先选择编程语言')
        return
      }
      if (!code.trim()) {
        setTestError('代码为空，先写一点代码再运行自测')
        return
      }
      setTesting(true)
      try {
        setTestResult(await onRun(input, sampleIndex))
      } catch (err) {
        setTestError(extractError(err))
      } finally {
        setTesting(false)
      }
    },
    [code, language, narrow, onRun],
  )

  useEffect(() => {
    if (!initialSample || consumedSample.current === initialSample) return
    consumedSample.current = initialSample
    void runWithInput(initialSample.sample.input, initialSample.index)
    onInitialSampleConsumed?.()
  }, [initialSample, onInitialSampleConsumed, runWithInput])

  const startDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (narrow) return
    dragRef.current = { pointerId: event.pointerId }
    event.currentTarget.setPointerCapture(event.pointerId)
    event.currentTarget.classList.add('dragging')
  }

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current
    const shell = shellRef.current
    if (!drag || drag.pointerId !== event.pointerId || !shell) return
    const rect = shell.getBoundingClientRect()
    const maxRatio = 1 - MIN_PANE / rect.width
    const minRatio = MIN_PANE / rect.width
    const ratio = Math.min(Math.max((event.clientX - rect.left) / rect.width, minRatio), maxRatio)
    setSplit(ratio)
  }

  const stopDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return
    dragRef.current = null
    event.currentTarget.classList.remove('dragging')
    event.currentTarget.releasePointerCapture(event.pointerId)
    window.localStorage.setItem(SPLIT_KEY, String(split))
  }

  const selfTestVerdict = (() => {
    if (!testResult) return null
    if (testResult.compile_error || testResult.status === 'compile_error') {
      return { label: '编译错误', color: getStatusInfo('compile_error').color }
    }
    if (sampleIndexForRun !== null && testResult.status === 'accepted') {
      return { label: `样例 ${sampleIndexForRun + 1} 通过`, color: getStatusInfo('accepted').color }
    }
    if (testResult.status === 'accepted') {
      return { label: '运行成功', color: getStatusInfo('accepted').color }
    }
    const info = getStatusInfo(testResult.status)
    return { label: SELF_TEST_LABELS[testResult.status] ?? info.label, color: info.color }
  })()

  const selectedLanguage = languages.find((item) => item.key === language)
  const leftStyle: CSSProperties | undefined = narrow ? undefined : { flexBasis: `${split * 100}%` }

  /** 提交反馈：编辑器视图放在状态栏下方；右栏换成评测面板时同样要显示，
   *  否则提交错误这类关键信息会随编辑器一起被卸载。
   *  提交成功不再额外提示「已提交 #id」——右栏评测面板里就是刚提交的那条。 */
  const submitNotices = (
    <>
      {submitDisabledReason && <div className="wb-notice warning-message">{submitDisabledReason}</div>}
      {submitError && <div className="wb-notice error-message">{submitError}</div>}
    </>
  )

  const editorPane = (
    <div className="wb-editor-pane">
      <div className="wb-editor-toolbar">
        <span className="wb-code-label">{hackMode ? 'Hack 数据' : '代码'}</span>
        <div className="wb-toolbar-right">
          {canRestoreSkeleton && (
            <button
              type="button"
              className="button button-ghost button-sm"
              onClick={restoreSkeleton}
              title="把编辑器内容恢复成题目给出的函数骨架"
            >
              恢复函数
            </button>
          )}
          {!hackMode && (
            <div className="wb-settings">
              <button type="button" className="button button-ghost button-sm" onClick={() => setSettingsOpen((v) => !v)}>
                字号 {fontSize}
              </button>
              {settingsOpen && (
                <>
                  <div className="wb-settings-backdrop" onClick={() => setSettingsOpen(false)} />
                  <div className="menu wb-settings-panel">
                    {FONT_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        className={`menu-item${fontSize === size ? ' active' : ''}`}
                        onClick={() => {
                          setFontSize(size)
                          setSettingsOpen(false)
                        }}
                      >
                        {size} px
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
          {!hackMode && (
            <select
              className="select-input"
              value={language}
              onChange={(event) => onLanguageChange(event.target.value)}
              aria-label="编程语言"
            >
              {languages.length === 0 && <option value="">加载语言中…</option>}
              {languages.map((item) => (
                <option key={item.key} value={item.key}>
                  {item.name} · {item.version}
                </option>
              ))}
            </select>
          )}
          {hackMode && <span className="field-hint">提交输入数据以攻击目标程序</span>}
          {!hackMode && selectedLanguage?.supports_optimize && (
            <label className="check-row">
              <input
                type="checkbox"
                checked={optimize}
                onChange={(event) => onOptimizeChange(event.target.checked)}
              />
              O2
            </label>
          )}
          {!hackMode && (
            <button
              type="button"
              className="button button-secondary button-sm"
              onClick={() => void runWithInput(testInput)}
              disabled={testing || !canSubmit}
            >
              自测运行
            </button>
          )}
          <button
            type="button"
            className="button button-primary button-sm"
            onClick={onSubmit}
            disabled={submitting || !canSubmit}
          >
            {submitting ? '提交中…' : hackMode && submitLabel === '提交' ? '提交 Hack' : submitLabel}
          </button>
        </div>
      </div>

      <div className="wb-editor-body">
        <CodeEditor
          language={language}
          monacoLanguage={hackMode ? 'plaintext' : selectedLanguage?.monaco}
          value={code}
          onChange={onCodeChange}
          onCtrlEnter={canSubmit ? onSubmit : undefined}
          onCursorChange={setCursor}
          fontSize={fontSize}
        />
      </div>

      <div className="wb-statusbar">
        <span>
          Ln {cursor.line}, Col {cursor.column}
        </span>
        <span>{hackMode ? 'Hack 输入数据' : selectedLanguage ? `${selectedLanguage.name} · ${selectedLanguage.version}` : ''}</span>
        {!hackMode && selectedLanguage?.supports_optimize && <span>{optimize ? 'O2' : '无优化'}</span>}
        <span className="wb-status-right">Ctrl+Enter 提交</span>
      </div>

      {submitNotices}

      {!hackMode && (
        <div className={drawerOpen ? 'wb-drawer open' : 'wb-drawer'}>
          <div className="wb-drawer-head">
            <button
              type="button"
              className="wb-drawer-toggle"
              onClick={() => setDrawerOpen((v) => !v)}
              aria-expanded={drawerOpen}
            >
              <span aria-hidden="true">{drawerOpen ? '▾' : '▴'}</span> 自测
              {selfTestVerdict && (
                <span className={`status-badge status-${selfTestVerdict.color} wb-drawer-verdict`}>
                  {selfTestVerdict.label}
                </span>
              )}
              {testing && <span className="field-hint">运行中…</span>}
            </button>
            {drawerOpen && (
              <button
                type="button"
                className="button button-ghost button-sm"
                onClick={() => void runWithInput(testInput)}
                disabled={testing}
              >
                运行
              </button>
            )}
          </div>
          {drawerOpen && (
            <div className="wb-drawer-body">
              <div className="wb-drawer-pane">
                <div className="wb-drawer-label">输入</div>
                <textarea
                  className="wb-drawer-input"
                  value={testInput}
                  onChange={(event) => setTestInput(event.target.value)}
                  placeholder="粘贴测试输入，或点题面样例里的「运行」"
                  aria-label="自测输入"
                />
              </div>
              <div className="wb-drawer-pane">
                <div className="wb-drawer-label">
                  输出
                  {testResult && (
                    <span className="wb-drawer-meta">
                      {testResult.time_ms} ms · {testResult.memory_kb} KB
                    </span>
                  )}
                </div>
                <div className="wb-drawer-output">
                  {testError && <div className="error-message">{testError}</div>}
                  {!testError && !testResult && <div className="field-hint">运行后在此显示结果</div>}
                  {testResult?.compile_error && <pre className="code-block">{testResult.compile_error}</pre>}
                  {testResult && !testResult.compile_error && (
                    <pre className="io-output">{testResult.stdout || '（无输出）'}</pre>
                  )}
                  {testResult?.stderr && (
                    <>
                      <div className="wb-drawer-label">标准错误</div>
                      <pre className="io-output">{testResult.stderr}</pre>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className={`wb ${narrow ? `wb-narrow wb-pane-${mobilePane}` : ''} ${className}`.trim()}>
      {narrow && (
        <div className="tabs wb-narrow-tabs" role="tablist" aria-label="作答视图">
          <button
            type="button"
            role="tab"
            className={`tab${mobilePane === 'left' ? ' active' : ''}`}
            aria-selected={mobilePane === 'left'}
            onClick={() => setMobilePane('left')}
          >
            题目
          </button>
          <button
            type="button"
            role="tab"
            className={`tab${mobilePane === 'editor' ? ' active' : ''}`}
            aria-selected={mobilePane === 'editor'}
            onClick={() => setMobilePane('editor')}
          >
            {(legacy && showSubmissions) || (!legacy && rightPane) ? '评测' : '代码'}
          </button>
        </div>
      )}

      <div className="wb-shell" ref={shellRef}>
        {legacy ? (
          <section className="wb-left" style={leftStyle} aria-label="题目信息">
            <div className="wb-left-head">
              <h1 className="wb-title">{title}</h1>
              {headerActions && <div className="wb-meta-actions">{headerActions}</div>}
            </div>
            <div className="wb-left-body">
              {statementMeta}
              <ProblemStatement problem={problem} onRunSample={hackMode ? undefined : (sample, index) => void runWithInput(sample.input, index)} />
              {statementFooter}
            </div>
          </section>
        ) : (
          <section className="wb-left" style={leftStyle} aria-label="题目信息">
            <div className="wb-left-head">
              <h1 className="wb-title">{title}</h1>
              {meta && <div className="wb-meta-row">{meta}</div>}
              {metaActions && <div className="wb-head-actions">{metaActions}</div>}
            </div>
            <div className="tabs wb-tabs" role="tablist" aria-label="题目视图">
              {(tabs ?? []).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === item.key}
                  className={`tab${tab === item.key ? ' active' : ''}`}
                  onClick={() => onTabChange?.(item.key)}
                >
                  {item.label}
                  {typeof item.count === 'number' && item.count > 0 && (
                    <span className="tab-count">{item.count}</span>
                  )}
                </button>
              ))}
            </div>
            <div className="wb-left-body">{panes?.[tab ?? '']}</div>
          </section>
        )}

        {!narrow && (
          <div
            className="wb-divider"
            role="separator"
            aria-orientation="vertical"
            aria-label="调整题面与代码宽度"
            onPointerDown={startDrag}
            onPointerMove={moveDrag}
            onPointerUp={stopDrag}
            onPointerCancel={stopDrag}
            onDoubleClick={() => {
              setSplit(0.46)
              window.localStorage.setItem(SPLIT_KEY, '0.46')
            }}
          />
        )}

        <section className="wb-right" aria-label="代码与运行">
          {legacy ? (
            showSubmissions ? submissionPanel : editorPane
          ) : rightPane ? (
            <>
              {submitNotices}
              {rightPane}
            </>
          ) : (
            editorPane
          )}
          {legacy && editorFooter && !showSubmissions && <div className="wb-editor-footer">{editorFooter}</div>}
        </section>
      </div>
    </div>
  )
}
