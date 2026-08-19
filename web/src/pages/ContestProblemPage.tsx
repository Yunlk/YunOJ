import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  extractError, getContest, getContestProblem, getLanguages, submitToContest,
} from '../api'
import CodeEditor from '../components/CodeEditor'
import Markdown from '../components/Markdown'
import SampleBlock from '../components/SampleBlock'
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
  const contestId = Number(id)
  const problemId = Number(pid)
  const now = useClock(1000)

  const [contest, setContest] = useState<Contest | null>(null)
  const [view, setView] = useState<ContestProblemView | null>(null)
  const [languages, setLanguages] = useState<Language[]>([])
  const [language, setLanguage] = useState('cpp')
  const [code, setCode] = useState('')
  const [optimize, setOptimize] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [submittedId, setSubmittedId] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false
    setError('')
    Promise.all([getContest(contestId), getContestProblem(contestId, problemId), getLanguages()])
      .then(([c, v, ls]) => {
        if (cancelled) return
        setContest(c.contest)
        setView(v)
        setLanguages(ls)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
    return () => {
      cancelled = true
    }
  }, [contestId, problemId])

  const submit = async () => {
    if (!code.trim()) {
      setError('代码不能为空')
      return
    }
    setBusy(true)
    setError('')
    setSubmittedId(null)
    try {
      const res = await submitToContest(contestId, problemId, language, code, optimize)
      setSubmittedId(res.id)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  if (error) return <div className="error-message">{error}</div>
  if (!contest || !view) return <div className="page-loading">加载中…</div>

  const { problem, contest_problem: cp } = view
  const startMs = new Date(contest.start_time).getTime()
  const endMs = new Date(contest.end_time).getTime()
  const progress = Math.min(100, Math.max(0, ((now - startMs) / Math.max(1, endMs - startMs)) * 100))
  const running = now >= startMs && now < endMs
  const upcoming = now < startMs
  const my = view.my

  return (
    <div className="contest-problem-page">
      <div className="contest-topbar">
        <div className="contest-topbar-title">
          <Link to={`/contest/${contestId}`} className="problem-link">← 总览</Link>
          <span className="contest-topbar-pid">{cp.display_id}</span>
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

      <div className="contest-problem-layout">
        <div className="problem-statement-card">
          <div className="problem-limits">
            <span className="tag-chip">题号 {cp.display_id}</span>
            <span className="tag-chip">满分 {cp.score}</span>
            <span className="tag-chip">{formatTimeLimit(problem.time_limit_ms)}</span>
            <span className="tag-chip">{formatMemory(problem.memory_limit_kb)}</span>
            <span className="tag-chip">
              提交 {my?.submissions ?? 0}
              {my?.remaining !== undefined ? ` / 剩余 ${my.remaining}` : ''} 次
            </span>
            {my && my.status !== 'untried' && (
              <span className="tag-chip">
                最近：{MY_STATUS_LABELS[my.status] ?? my.status}
                {my.score > 0 ? `（${my.score} 分）` : ''}
              </span>
            )}
          </div>
          <div className="problem-statement">
            <Markdown>{problem.statement}</Markdown>
          </div>
          {problem.input_format && (
            <>
              <h3 className="statement-h">输入格式</h3>
              <Markdown>{problem.input_format}</Markdown>
            </>
          )}
          {problem.output_format && (
            <>
              <h3 className="statement-h">输出格式</h3>
              <Markdown>{problem.output_format}</Markdown>
            </>
          )}
          {problem.samples.length > 0 && (
            <>
              <h3 className="statement-h">样例</h3>
              {problem.samples.map((s, i) => (
                <div key={i} className="sample-group">
                  {s.note && <Markdown>{s.note}</Markdown>}
                  <SampleBlock title={`输入 #${i + 1}`} content={s.input} />
                  <SampleBlock title={`输出 #${i + 1}`} content={s.output} />
                </div>
              ))}
            </>
          )}
          {problem.hint && (
            <>
              <h3 className="statement-h">提示</h3>
              <Markdown>{problem.hint}</Markdown>
            </>
          )}
        </div>

        <div className="contest-editor-panel">
          <div className="form-row">
            <div className="form-group">
              <label htmlFor="cp-lang">语言</label>
              <select id="cp-lang" value={language} onChange={(e) => setLanguage(e.target.value)}>
                {languages.map((l) => (
                  <option key={l.key} value={l.key}>{l.name} ({l.version})</option>
                ))}
              </select>
            </div>
            <label className="checkbox-label">
              <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
              -O2
            </label>
          </div>
          <div className="contest-editor">
            <CodeEditor language={language} value={code} onChange={setCode} onCtrlEnter={submit} />
          </div>
          {running ? (
            <div className="contest-submit-row">
              <button type="button" className="button button-primary" disabled={busy} onClick={submit}>
                {busy ? '提交中…' : '提交'}
              </button>
              <span className="muted">Ctrl/Cmd + Enter 快速提交</span>
            </div>
          ) : (
            <div className="notice-card">
              {upcoming ? '比赛尚未开始，无法提交。' : '比赛已结束，不再接受提交。'}
            </div>
          )}
          {error && <div className="error-message">{error}</div>}
          {submittedId !== null && (
            <div className="success-message">
              提交成功，<Link to={`/submission/${submittedId}`}>查看提交 #{submittedId}</Link>
            </div>
          )}
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
        </div>
      </div>
    </div>
  )
}
