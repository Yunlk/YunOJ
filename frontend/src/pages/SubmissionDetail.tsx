import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { extractError, getSubmission, rejudgeSubmission } from '../api'
import StatusBadge from '../components/StatusBadge'
import { useAuth } from '../context/AuthContext'
import type { SubmissionDetail as SubmissionDetailType } from '../types'
import { formatMemory, formatRunTime, formatTime } from '../utils/format'
import { isPendingStatus } from '../utils/status'

const POLL_INTERVAL_MS = 3000
const MAX_POLL_MS = 120000

export default function SubmissionDetail() {
  const { id } = useParams()
  const { user } = useAuth()

  const [sub, setSub] = useState<SubmissionDetailType | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [rejudging, setRejudging] = useState(false)
  const [rejudgeMsg, setRejudgeMsg] = useState('')

  const timerRef = useRef<number | null>(null)
  const startRef = useRef<number>(Date.now())

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
    } catch (err) {
      setRejudgeMsg(extractError(err))
    } finally {
      setRejudging(false)
    }
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
  const showCode = sub.code !== null && sub.code !== undefined
  const showCompileError = sub.compile_error !== null && sub.compile_error !== undefined
  const running = isPendingStatus(sub.status)

  return (
    <div>
      <div className="problem-header">
        <h1 className="problem-title">提交 #{sub.id}</h1>
        {isAdmin && (
          <button
            type="button"
            className="button button-secondary"
            onClick={onRejudge}
            disabled={rejudging}
          >
            {rejudging ? '重测中…' : '重测'}
          </button>
        )}
      </div>

      <div className="submission-meta card">
        <div className="meta-row">
          <span className="meta-label">题目</span>
          <Link to={`/problem/${sub.problem_id}`} className="problem-link">
            {sub.problem_title}
          </Link>
        </div>
        <div className="meta-row">
          <span className="meta-label">用户</span>
          <span>{sub.username}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">语言</span>
          <span className="mono">{sub.language}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">提交时间</span>
          <span className="mono">{formatTime(sub.created_at)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">状态</span>
          <span className="submission-status-big">
            <StatusBadge status={sub.status} />
          </span>
        </div>
        <div className="meta-row">
          <span className="meta-label">耗时</span>
          <span className="mono">{formatRunTime(sub.time_ms)}</span>
        </div>
        <div className="meta-row">
          <span className="meta-label">内存</span>
          <span className="mono">{formatMemory(sub.memory_kb)}</span>
        </div>
      </div>

      {rejudgeMsg && <div className="error-message">{rejudgeMsg}</div>}

      <section className="section">
        <h2 className="section-title">测试点结果</h2>
        {running && <div className="info-message">评测中，请稍候…（每 3 秒自动刷新）</div>}
        {!running && sub.case_results === null && (
          <div className="info-message">测试点详情不可见（仅提交者本人或管理员可查看）</div>
        )}
        {sub.case_results !== null && sub.case_results !== undefined && (
          <table className="data-table case-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>测试点</th>
                <th>状态</th>
                <th style={{ width: 140 }}>耗时</th>
                <th style={{ width: 140 }}>内存</th>
              </tr>
            </thead>
            <tbody>
              {sub.case_results.length === 0 ? (
                <tr>
                  <td colSpan={4} className="table-empty">
                    评测中…
                  </td>
                </tr>
              ) : (
                sub.case_results.map((c) => (
                  <tr key={c.case_id}>
                    <td className="mono">#{c.case_id}</td>
                    <td>
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="mono">{formatRunTime(c.time_ms)}</td>
                    <td className="mono">{formatMemory(c.memory_kb)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        )}
      </section>

      {showCompileError && (
        <section className="section">
          <h2 className="section-title">编译错误</h2>
          <pre className="code-block compile-error">{sub.compile_error}</pre>
        </section>
      )}

      {showCode && (
        <section className="section">
          <h2 className="section-title">代码</h2>
          <pre className="code-block">{sub.code}</pre>
        </section>
      )}
    </div>
  )
}
