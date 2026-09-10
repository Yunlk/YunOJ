import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractError, getSubmission, rejudgeSubmission } from '../api'
import PageHeader from '../components/PageHeader'
import StatusBadge from '../components/StatusBadge'
import SubmissionFlags from '../components/SubmissionFlags'
import { useAuth } from '../context/AuthContext'
import type { CaseResult, SubmissionDetail as SubmissionDetailType } from '../types'
import { formatMemory, formatRunTime, formatTime } from '../utils/format'
import { getStatusInfo, isPendingStatus, type StatusColor } from '../utils/status'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_MS = 120000

/** 后端脱敏后会返回的隐藏判定状态。 */
const HIDDEN_STATUSES = new Set(['not_run', 'hidden'])

/** 与 Status 页一致的判定色块：只从令牌取色，页面 CSS 不写死颜色。 */
function verdictVars(color: StatusColor): React.CSSProperties {
  return {
    ['--verdict-color' as string]: `var(--verdict-${color})`,
  }
}

function isFailedCase(c: CaseResult): boolean {
  return c.status !== 'accepted'
}

/** 复制文本：优先 Clipboard API，非安全上下文回退到 execCommand。 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // 继续走回退方案
  }
  try {
    const ta = document.createElement('textarea')
    ta.value = text
    ta.setAttribute('readonly', '')
    ta.style.position = 'fixed'
    ta.style.top = '-1000px'
    document.body.appendChild(ta)
    ta.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(ta)
    return ok
  } catch {
    return false
  }
}

export default function SubmissionDetail() {
  const { id } = useParams()
  const { user } = useAuth()

  const [sub, setSub] = useState<SubmissionDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [rejudging, setRejudging] = useState(false)
  const [rejudgeMsg, setRejudgeMsg] = useState('')
  const [copied, setCopied] = useState<'code' | 'error' | ''>('')

  const timerRef = useRef<number | null>(null)
  const copyTimerRef = useRef<number | null>(null)
  const startRef = useRef<number>(Date.now())
  const caseTableRef = useRef<HTMLTableElement>(null)

  const load = useCallback(async () => {
    try {
      const data = await getSubmission(id!)
      setSub(data)
      setError('')
      if (isPendingStatus(data.status)) {
        if (Date.now() - startRef.current < MAX_POLL_MS) {
          timerRef.current = window.setTimeout(() => void load(), POLL_INTERVAL_MS)
        }
      }
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    }
  }, [load])

  const onRejudge = async () => {
    setRejudging(true)
    setRejudgeMsg('')
    try {
      await rejudgeSubmission(id!)
      startRef.current = Date.now()
      setLoading(true)
      await load()
      setRejudgeMsg('已提交重测，评测结果会自动刷新。')
    } catch (err) {
      setRejudgeMsg(`重测失败：${extractError(err)}`)
    } finally {
      setRejudging(false)
    }
  }

  const onCopy = async (which: 'code' | 'error', text: string) => {
    const ok = await copyText(text)
    if (!ok) {
      setRejudgeMsg('复制失败，请手动选中代码复制。')
      return
    }
    setCopied(which)
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current)
    copyTimerRef.current = window.setTimeout(() => setCopied(''), 1600)
  }

  const caseResults = sub?.case_results ?? null
  const firstFailed = useMemo(
    () => (caseResults ?? []).find((c) => isFailedCase(c)) ?? null,
    [caseResults],
  )

  const scrollToFirstFailure = () => {
    const row = caseTableRef.current?.querySelector('tbody tr.case-failed')
    row?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  if (loading && !sub) {
    return <div className="page-loading">加载中…</div>
  }

  if (error && !sub) {
    return (
      <div className="no-permission">
        <h1>加载失败</h1>
        <p>{error}</p>
        <Link to="/status" className="button button-primary">
          返回提交记录
        </Link>
      </div>
    )
  }

  if (!sub) {
    return null
  }

  const isAdmin = user?.role === 'admin'
  const isOwner = user?.id === sub.user_id
  const showCode = sub.code !== null && sub.code !== undefined
  const showCompileError = sub.compile_error !== null && sub.compile_error !== undefined
  const running = isPendingStatus(sub.status)
  const info = getStatusInfo(sub.status)
  const masked = HIDDEN_STATUSES.has(sub.status)
  const hasRange = sub.wall_time_ms > 0 && sub.wall_time_ms !== sub.time_ms
  const passCount = (caseResults ?? []).filter((c) => !isFailedCase(c)).length

  return (
    <div className="submission-detail">
      <nav className="breadcrumb" aria-label="页面路径">
        {/* 上一级页面标题固定为「提交记录」，与 /status 保持一致 */}
        <Link to="/status">提交记录</Link>
        <span className="breadcrumb-sep">/</span>
        <span>#{sub.id}</span>
      </nav>

      <PageHeader
        eyebrow={`提交 #${sub.id}`}
        title={sub.problem_title}
        description={`${sub.username} 于 ${formatTime(sub.created_at)} 提交 · 题目 #${sub.problem_id}`}
        actions={
          <>
            <Link to={`/problem/${sub.problem_id}`} className="button button-secondary">
              回到题目
            </Link>
            {isOwner && (
              <Link to={`/problem/${sub.problem_id}`} className="button button-primary">
                再交一次
              </Link>
            )}
            {isAdmin && (
              <button
                type="button"
                className="button button-primary"
                onClick={onRejudge}
                disabled={rejudging}
              >
                {rejudging ? '重测中…' : '重测'}
              </button>
            )}
          </>
        }
      />

      <section className="verdict-panel" aria-label="评测结论">
        <div className="verdict-main" style={verdictVars(info.color)}>
          <span className="verdict-label">评测结论</span>
          <div className="verdict-value">
            <span className="verdict-dot" aria-hidden="true" />
            <span className="verdict-text">{info.label}</span>
            {running && <span className="verdict-pending">评测中，每 3 秒自动刷新</span>}
          </div>
          <div className="verdict-flags">
            <SubmissionFlags
              pretestOnly={sub.pretest_only}
              systemTested={sub.system_tested}
              isHacked={sub.is_hacked}
            />
            {masked && <span className="badge">结果暂不可见</span>}
          </div>
          {sub.score > 0 && <div className="verdict-score">得分 {sub.score}</div>}
        </div>

        <dl className="verdict-metrics">
          <div>
            <dt>CPU 耗时</dt>
            <dd className="mono">
              {formatRunTime(sub.time_ms)}
              {hasRange && <span className="verdict-metric-sub">墙钟 {formatRunTime(sub.wall_time_ms)}</span>}
            </dd>
          </div>
          <div>
            <dt>内存</dt>
            <dd className="mono">{formatMemory(sub.memory_kb)}</dd>
          </div>
          <div>
            <dt>语言</dt>
            <dd className="mono">{sub.language}</dd>
          </div>
          <div>
            <dt>提交时间</dt>
            <dd className="mono">{formatTime(sub.created_at)}</dd>
          </div>
          <div>
            <dt>题目</dt>
            <dd>
              <Link to={`/problem/${sub.problem_id}`}>#{sub.problem_id}</Link>
            </dd>
          </div>
          <div>
            <dt>提交者</dt>
            <dd>{sub.username}</dd>
          </div>
          {sub.timeout_source && (
            <div>
              <dt>超时来源</dt>
              <dd>{sub.timeout_source}</dd>
            </div>
          )}
        </dl>
      </section>

      {rejudgeMsg && <div className="info-message">{rejudgeMsg}</div>}
      {error && sub && <div className="error-message">{error}</div>}

      <section className="section submission-cases">
        <div className="section-head">
          <h2 className="section-title">测试点结果</h2>
          <span className="section-hint">
            {caseResults === null
              ? running
                ? '评测中…'
                : '不可见'
              : caseResults.length === 0
                ? '评测中…'
                : `共 ${caseResults.length} 个测试点 · 通过 ${passCount} 个`}
          </span>
        </div>

        {running && <div className="info-message">评测中，请稍候…（每 3 秒自动刷新）</div>}
        {!running && caseResults === null && (
          <div className="info-message">测试点详情不可见（仅提交者本人或管理员可查看）</div>
        )}

        {caseResults !== null && (
          <div className="table-frame">
            <table className="data-table case-table" ref={caseTableRef}>
              <thead>
                <tr>
                  <th style={{ width: 88 }}>测试点</th>
                  <th>状态</th>
                  <th style={{ width: 110 }} className="cell-num">
                    CPU 耗时
                  </th>
                  <th style={{ width: 110 }} className="cell-num">
                    内存
                  </th>
                  {sub.case_scores && <th style={{ width: 84 }} className="cell-num">得分</th>}
                </tr>
              </thead>
              <tbody>
                {caseResults.length === 0 ? (
                  <tr>
                    <td colSpan={sub.case_scores ? 5 : 4} className="table-empty">
                      评测中，测试点结果稍后出现…
                    </td>
                  </tr>
                ) : (
                  caseResults.map((c) => (
                    <tr key={c.case_id} className={isFailedCase(c) ? 'case-failed' : undefined}>
                      <td className="mono">#{c.case_id}</td>
                      <td>
                        <StatusBadge status={c.status} />
                        {c.hack_status && (
                          <span className="field-hint">（目标 {c.hack_status.toUpperCase()}）</span>
                        )}
                      </td>
                      <td className="cell-num mono">{formatRunTime(c.time_ms)}</td>
                      <td className="cell-num mono">{formatMemory(c.memory_kb)}</td>
                      {sub.case_scores && (
                        <td className="cell-num mono">{sub.case_scores[c.case_id - 1] ?? '—'}</td>
                      )}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        )}

        {firstFailed && (
          <div className="submission-case-actions">
            <button type="button" className="button button-secondary button-sm" onClick={scrollToFirstFailure}>
              定位首个未通过测试点 #{firstFailed.case_id}
            </button>
          </div>
        )}
      </section>

      {showCompileError && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">编译错误</h2>
            <button
              type="button"
              className={`button button-secondary button-sm${copied === 'error' ? ' copied' : ''}`}
              onClick={() => void onCopy('error', sub.compile_error ?? '')}
            >
              {copied === 'error' ? '已复制' : '复制报错'}
            </button>
          </div>
          <pre className="code-block compile-error submission-code-block">{sub.compile_error}</pre>
        </section>
      )}

      {showCode && (
        <section className="section">
          <div className="section-head">
            <h2 className="section-title">代码</h2>
            <span className="submission-code-actions">
              <span className="section-hint mono">{sub.language}</span>
              <button
                type="button"
                className={`button button-secondary button-sm${copied === 'code' ? ' copied' : ''}`}
                onClick={() => void onCopy('code', sub.code ?? '')}
              >
                {copied === 'code' ? '已复制' : '复制代码'}
              </button>
            </span>
          </div>
          <pre className="code-block submission-code-block">{sub.code}</pre>
        </section>
      )}
    </div>
  )
}
