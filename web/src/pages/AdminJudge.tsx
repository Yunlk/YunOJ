import { useEffect, useState } from 'react'
import { extractError, api } from '../api'

interface JudgeHealth {
  queue: { queued: number; processing: Record<string, number> }
  statuses: Record<string, number>
  workers: number
}

export default function AdminJudge() {
  const [data, setData] = useState<JudgeHealth | null>(null)
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const load = () => api.get<JudgeHealth>('/admin/judge/health').then((res) => setData(res.data)).catch((err) => setError(extractError(err)))
  useEffect(() => { void load(); const timer = window.setInterval(() => void load(), 5000); return () => window.clearInterval(timer) }, [])
  const recover = async () => {
    setRecovering(true); setError('')
    try { const res = await api.post<{ reset: number; enqueued: number }>('/admin/judge/recover-stale'); window.alert(`已恢复 ${res.data.reset} 个卡住任务`); await load() } catch (err) { setError(extractError(err)) } finally { setRecovering(false) }
  }
  return <div className="admin-judge-page"><div className="page-header"><div><div className="page-eyebrow">平台运维</div><h1 className="page-title">评测服务</h1></div><button className="button button-secondary" type="button" onClick={() => void recover()} disabled={recovering}>{recovering ? '恢复中…' : '恢复卡住任务'}</button></div>{error && <div className="error-message">{error}</div>}{!data ? <div className="page-loading">读取评测状态…</div> : <><div className="home-stat-strip judge-stat-strip"><div><strong>{data.queue.queued}</strong><span>排队中</span></div><div><strong>{Object.values(data.queue.processing).reduce((sum, count) => sum + count, 0)}</strong><span>评测中</span></div><div><strong>{data.workers}</strong><span>Worker</span></div></div><section className="card judge-status-panel"><div className="section-header"><h2>提交状态</h2><span className="muted">每 5 秒刷新</span></div>{Object.entries(data.statuses).map(([status, count]) => <div className="judge-status-row" key={status}><span>{status}</span><strong>{count}</strong></div>)}</section></>}</div>
}
