import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { extractError, getSubmissionResult } from '../api'
import type { Page, SubmissionDetail, SubmissionListItem } from '../types'
import { formatMemory, formatRunTime, formatTime, formatTimeLimit } from '../utils/format'
import { getStatusInfo, isPendingStatus } from '../utils/status'

interface SubmissionPanelProps {
  title: string
  problemId: number
  userId: number | null
  contestId?: number
  refreshKey?: number
  focusSubmissionId?: number | null
  showScore?: boolean
  timeLimitMs: number
  memoryLimitKb: number
  onBack: () => void
  load: (params: {
    page: number
    size: number
    problemId: number
    userId: number
    contestId?: number
  }) => Promise<Page<SubmissionListItem>>
}

function rowClass(status: string): string {
  return `submission-row submission-row-${getStatusInfo(status).color}`
}

function statusCode(status: string): string {
  const labels: Record<string, string> = {
    pending: 'PENDING',
    running: 'JUDGING',
    accepted: 'AC',
    wrong_answer: 'WA',
    presentation_error: 'PE',
    time_limit_exceeded: 'TLE',
    memory_limit_exceeded: 'MLE',
    output_limit_exceeded: 'OLE',
    runtime_error: 'RE',
    compile_error: 'CE',
    system_error: 'SE',
    not_run: 'SKIPPED',
    hidden: 'HIDDEN',
  }
  return labels[status] ?? status.toUpperCase()
}

function resultText(status: string) {
  const info = getStatusInfo(status)
  return (
    <span className={`submission-result submission-result-${info.color}`}>
      {statusCode(status)}
    </span>
  )
}

export default function SubmissionPanel({
  title,
  problemId,
  userId,
  contestId,
  refreshKey = 0,
  focusSubmissionId = null,
  showScore = false,
  timeLimitMs,
  memoryLimitKb,
  onBack,
  load,
}: SubmissionPanelProps) {
  const [items, setItems] = useState<SubmissionListItem[]>([])
  const [historyLoading, setHistoryLoading] = useState(true)
  const [historyError, setHistoryError] = useState('')
  const [view, setView] = useState<'detail' | 'history'>(focusSubmissionId ? 'detail' : 'history')
  const [selectedId, setSelectedId] = useState<number | null>(focusSubmissionId)
  const [detail, setDetail] = useState<SubmissionDetail | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState('')

  const loadPage = useCallback(() => {
    if (userId === null) return Promise.resolve({ items: [], total: 0 })
    return load({ page: 1, size: 20, problemId, userId, contestId })
  }, [contestId, load, problemId, userId])

  useEffect(() => {
    if (focusSubmissionId === null || focusSubmissionId === undefined) return
    setSelectedId(focusSubmissionId)
    setView('detail')
  }, [focusSubmissionId])

  useEffect(() => {
    let cancelled = false
    let timer: number | undefined

    const refresh = async () => {
      try {
        const data = await loadPage()
        if (cancelled) return
        setItems(data.items)
        setHistoryError('')
        if (data.items.some((item) => isPendingStatus(item.status))) {
          timer = window.setTimeout(() => void refresh(), 2200)
        }
      } catch (err) {
        if (!cancelled) setHistoryError(extractError(err))
      } finally {
        if (!cancelled) setHistoryLoading(false)
      }
    }

    setHistoryLoading(true)
    void refresh()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [loadPage, refreshKey])

  useEffect(() => {
    if (selectedId === null) {
      setDetail(null)
      return
    }
    let cancelled = false
    let timer: number | undefined

    const refresh = async () => {
      try {
        const data = await getSubmissionResult(selectedId)
        if (cancelled) return
        setDetail(data)
        setDetailError('')
        if (isPendingStatus(data.status)) {
          timer = window.setTimeout(() => void refresh(), 1600)
        }
      } catch (err) {
        if (!cancelled) setDetailError(extractError(err))
      } finally {
        if (!cancelled) setDetailLoading(false)
      }
    }

    setDetail(null)
    setDetailLoading(true)
    void refresh()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [selectedId])

  const openDetail = (id: number) => {
    setSelectedId(id)
    setView('detail')
  }

  const detailStatus = detail?.status ?? 'pending'
  const detailColor = getStatusInfo(detailStatus).color
  const hidden = detail?.status === 'hidden'
  const caseResults = detail?.case_results

  return (
    <div className="submission-panel">
      <div className="submission-panel-head">
        <div className="submission-panel-heading">
          <div className="submission-panel-title">{title}</div>
          <div className="submission-panel-tabs" role="tablist" aria-label="提交结果视图">
            <button
              type="button"
              className={view === 'detail' ? 'submission-panel-tab active' : 'submission-panel-tab'}
              disabled={selectedId === null}
              onClick={() => setView('detail')}
            >
              测评详情
            </button>
            <button
              type="button"
              className={view === 'history' ? 'submission-panel-tab active' : 'submission-panel-tab'}
              onClick={() => setView('history')}
            >
              累计提交
            </button>
          </div>
        </div>
        <button type="button" className="toolbar-button" onClick={onBack}>
          返回编辑器
        </button>
      </div>

      {view === 'history' ? (
        <>
          {historyError && <div className="error-message submission-panel-error">{historyError}</div>}
          <div className="submission-panel-table-wrap">
            <table className="submission-panel-table">
              <thead>
                <tr>
                  <th>提交号</th>
                  <th>用户</th>
                  <th>题目</th>
                  <th>结果</th>
                  {showScore && <th>得分</th>}
                  <th>语言</th>
                  <th>耗时</th>
                  <th>内存</th>
                  <th>提交时间</th>
                </tr>
              </thead>
              <tbody>
                {historyLoading ? (
                  <tr><td colSpan={showScore ? 9 : 8} className="table-empty">加载中...</td></tr>
                ) : items.length === 0 ? (
                  <tr><td colSpan={showScore ? 9 : 8} className="table-empty">暂无提交记录</td></tr>
                ) : items.map((item) => (
                  <tr
                    key={item.id}
                    className={`${rowClass(item.status)} submission-row-clickable`}
                    tabIndex={0}
                    onClick={() => openDetail(item.id)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') openDetail(item.id)
                    }}
                  >
                    <td className="mono"><span className="submission-id-link">#{item.id}</span></td>
                    <td>{item.username}</td>
                    <td className="mono">P{item.problem_id}</td>
                    <td>{resultText(item.status)}</td>
                    {showScore && <td className="mono submission-score">{item.status === 'hidden' ? '-' : item.score}</td>}
                    <td className="mono">{item.language}</td>
                    <td className="mono">{item.status === 'hidden' ? '-' : formatRunTime(item.time_ms)}</td>
                    <td className="mono">{item.status === 'hidden' ? '-' : formatMemory(item.memory_kb)}</td>
                    <td className="mono submission-created-at">{formatTime(item.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      ) : (
        <div className="submission-detail-pane">
          {detailError && <div className="error-message submission-panel-error">{detailError}</div>}
          {detailLoading && detail === null ? (
            <div className="submission-detail-empty">正在读取测评状态...</div>
          ) : detail !== null ? (
            <>
              <div className={`submission-detail-summary submission-row-${detailColor}`}>
                <div>
                  <div className={`submission-detail-verdict submission-result-${detailColor}`}>
                    {statusCode(detail.status)}
                  </div>
                  <div className="submission-detail-caption">
                    提交 #{detail.id} · {detail.language} · {formatTime(detail.created_at)}
                  </div>
                </div>
                <div className="submission-detail-metrics">
                  {showScore && (
                    <div><span>得分</span><strong>{hidden ? '-' : detail.score}</strong></div>
                  )}
                  <div>
                    <span>耗时 / 限制</span>
                    <strong>{hidden ? '-' : formatRunTime(detail.time_ms)} / {formatTimeLimit(timeLimitMs)}</strong>
                  </div>
                  <div>
                    <span>内存 / 限制</span>
                    <strong>{hidden ? '-' : formatMemory(detail.memory_kb)} / {formatMemory(memoryLimitKb)}</strong>
                  </div>
                </div>
              </div>

              {hidden ? (
                <div className="submission-detail-empty">盲评进行中，比赛结束后公开测评结果。</div>
              ) : (
                <>
                  {isPendingStatus(detail.status) && (
                    <div className="submission-judging-line"><span />评测中，状态会自动更新</div>
                  )}
                  {detail.compile_error && (
                    <div className="submission-compile-block">
                      <div className="submission-detail-section-title">编译信息</div>
                      <pre className="code-block compile-error">{detail.compile_error}</pre>
                    </div>
                  )}
                  <div className="submission-detail-section-title">测试点</div>
                  <div className="submission-panel-table-wrap submission-case-table-wrap">
                    <table className="submission-panel-table submission-case-table">
                      <thead>
                        <tr>
                          <th>测试点</th>
                          <th>结果</th>
                          {showScore && <th>得分</th>}
                          <th>耗时</th>
                          <th>内存</th>
                        </tr>
                      </thead>
                      <tbody>
                        {caseResults === null ? (
                          <tr><td colSpan={showScore ? 5 : 4} className="table-empty">测试点详情不可见</td></tr>
                        ) : caseResults && caseResults.length > 0 ? caseResults.map((item, index) => (
                          <tr key={item.case_id} className={rowClass(item.status)}>
                            <td className="mono">#{item.case_id}</td>
                            <td>{resultText(item.status)}</td>
                            {showScore && <td className="mono">{detail.case_scores?.[index] ?? 0}</td>}
                            <td className="mono">{item.status === 'not_run' ? '-' : formatRunTime(item.time_ms)}</td>
                            <td className="mono">{item.status === 'not_run' ? '-' : formatMemory(item.memory_kb)}</td>
                          </tr>
                        )) : (
                          <tr>
                            <td colSpan={showScore ? 5 : 4} className="table-empty">
                              {isPendingStatus(detail.status) ? '等待测试点结果...' : '没有测试点结果'}
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
              <div className="submission-detail-footer">
                <Link to={`/submission/${detail.id}`}>打开完整提交页面</Link>
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  )
}
