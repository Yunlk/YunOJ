import { useEffect, useState } from 'react'
import { api, extractError } from '../api'

interface JudgeNodeLanguage {
  key: string
  name: string
  version: string
}

interface JudgeNode {
  node_id: string
  display_name: string
  hostname: string
  version: string
  enabled: boolean
  desired_concurrency: number
  actual_concurrency: number
  languages: JudgeNodeLanguage[]
  last_heartbeat: string
  online: boolean
}

interface JudgeLanguage {
  key: string
  name: string
  version: string
  enabled: boolean
}

interface JudgeAuditLog {
  id: number
  actor_name: string
  action: string
  target: string
  detail: string
  created_at: string
}

interface JudgeCluster {
  queue: { queued: number; processing: Record<string, number> }
  statuses: Record<string, number>
  nodes: JudgeNode[]
  languages: JudgeLanguage[]
  audit_logs: JudgeAuditLog[]
  summary: {
    online_nodes: number
    total_nodes: number
    actual_concurrency: number
    desired_concurrency: number
    processing: number
  }
}

const statusNames: Record<string, string> = {
  pending: '排队中',
  running: '评测中',
  accepted: '通过',
  wrong_answer: '答案错误',
  presentation_error: '格式错误',
  time_limit_exceeded: '时间超限',
  memory_limit_exceeded: '内存超限',
  output_limit_exceeded: '输出超限',
  runtime_error: '运行错误',
  compile_error: '编译错误',
  system_error: '系统错误',
}

function NodeRow({ node, reload, reportError }: {
  node: JudgeNode
  reload: () => Promise<void>
  reportError: (message: string) => void
}) {
  const [concurrency, setConcurrency] = useState(node.desired_concurrency)
  const [saving, setSaving] = useState(false)

  useEffect(() => setConcurrency(node.desired_concurrency), [node.desired_concurrency])

  const update = async (payload: Record<string, unknown>) => {
    setSaving(true)
    reportError('')
    try {
      await api.patch(`/admin/judge/nodes/${encodeURIComponent(node.node_id)}`, payload)
      await reload()
    } catch (err) {
      reportError(extractError(err))
    } finally {
      setSaving(false)
    }
  }

  return (
    <tr>
      <td>
        <div className="judge-node-name">
          <span className={`judge-online-dot ${node.online ? 'online' : 'offline'}`} />
          <strong>{node.display_name}</strong>
        </div>
        <code>{node.node_id}</code>
      </td>
      <td>
        <span>{node.hostname || '未上报'}</span>
        <small>{node.version || '未知版本'}</small>
      </td>
      <td>
        <strong>{node.actual_concurrency}</strong>
        <span className="muted"> / {node.desired_concurrency}</span>
      </td>
      <td>
        <div className="judge-concurrency-control">
          <input
            aria-label={`${node.display_name} 目标并发`}
            type="number"
            min={0}
            max={256}
            value={concurrency}
            onChange={(event) => setConcurrency(Number(event.target.value))}
          />
          <button
            className="button button-secondary button-small"
            type="button"
            disabled={saving || concurrency === node.desired_concurrency || concurrency < 0 || concurrency > 256}
            onClick={() => void update({ desired_concurrency: concurrency })}
          >
            应用
          </button>
        </div>
      </td>
      <td>
        <button
          className={`status-toggle ${node.enabled ? 'enabled' : 'disabled'}`}
          type="button"
          disabled={saving}
          onClick={() => void update({ enabled: !node.enabled })}
        >
          {node.enabled ? '接收任务' : '已排空'}
        </button>
      </td>
      <td>
        <time>{new Date(node.last_heartbeat).toLocaleString()}</time>
        <small>{node.online ? '心跳正常' : '节点离线'}</small>
      </td>
    </tr>
  )
}

export default function AdminJudge() {
  const [data, setData] = useState<JudgeCluster | null>(null)
  const [error, setError] = useState('')
  const [recovering, setRecovering] = useState(false)
  const [languageSaving, setLanguageSaving] = useState('')

  const load = async () => {
    try {
      const response = await api.get<JudgeCluster>('/admin/judge/cluster')
      setData(response.data)
      setError('')
    } catch (err) {
      setError(extractError(err))
    }
  }

  useEffect(() => {
    void load()
    const timer = window.setInterval(() => void load(), 5000)
    return () => window.clearInterval(timer)
  }, [])

  const recover = async () => {
    setRecovering(true)
    setError('')
    try {
      const response = await api.post<{ reset: number }>('/admin/judge/recover-stale')
      window.alert(`已恢复 ${response.data.reset} 个卡住任务`)
      await load()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setRecovering(false)
    }
  }

  const toggleLanguage = async (language: JudgeLanguage) => {
    setLanguageSaving(language.key)
    setError('')
    try {
      await api.patch(`/admin/judge/languages/${encodeURIComponent(language.key)}`, {
        enabled: !language.enabled,
      })
      await load()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setLanguageSaving('')
    }
  }

  return (
    <div className="admin-judge-page">
      <div className="page-header">
        <div>
          <div className="page-eyebrow">平台运维</div>
          <h1 className="page-title">测评集群</h1>
          <p className="page-description">管理节点容量与对用户开放的语言。节点配置约 3 秒内生效。</p>
        </div>
        <button className="button button-secondary" type="button" onClick={() => void recover()} disabled={recovering}>
          {recovering ? '恢复中...' : '恢复卡住任务'}
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}
      {!data ? <div className="page-loading">读取集群状态...</div> : (
        <>
          <div className="home-stat-strip judge-stat-strip">
            <div><strong>{data.queue.queued}</strong><span>队列等待</span></div>
            <div><strong>{data.summary.processing}</strong><span>正在处理</span></div>
            <div><strong>{data.summary.online_nodes}/{data.summary.total_nodes}</strong><span>在线节点</span></div>
            <div><strong>{data.summary.actual_concurrency}/{data.summary.desired_concurrency}</strong><span>实际 / 目标并发</span></div>
          </div>

          <section className="judge-admin-section">
            <div className="section-header">
              <h2>评测节点</h2>
              <span className="muted">正在执行的任务会完成后再排空</span>
            </div>
            <div className="table-wrap">
              <table className="data-table judge-node-table">
                <thead>
                  <tr><th>节点</th><th>主机</th><th>实际 / 目标</th><th>目标并发</th><th>调度</th><th>最后心跳</th></tr>
                </thead>
                <tbody>
                  {data.nodes.length === 0 ? (
                    <tr><td colSpan={6} className="table-empty">暂无节点，启动 judge 进程后会自动注册。</td></tr>
                  ) : data.nodes.map((node) => (
                    <NodeRow key={node.node_id} node={node} reload={load} reportError={setError} />
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <div className="judge-admin-columns">
            <section className="judge-admin-section">
              <div className="section-header">
                <h2>提交语言</h2>
                <span className="muted">命令由服务端配置维护</span>
              </div>
              <div className="judge-language-list">
                {data.languages.map((language) => (
                  <div className="judge-language-row" key={language.key}>
                    <span><strong>{language.name}</strong><small>{language.version} · {language.key}</small></span>
                    <button
                      className={`status-toggle ${language.enabled ? 'enabled' : 'disabled'}`}
                      type="button"
                      disabled={languageSaving === language.key}
                      onClick={() => void toggleLanguage(language)}
                    >
                      {language.enabled ? '已开放' : '已停用'}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="judge-admin-section">
              <div className="section-header"><h2>提交状态</h2><span className="muted">全部历史记录</span></div>
              <div className="judge-status-grid">
                {Object.entries(data.statuses).map(([status, count]) => (
                  <div key={status}><span>{statusNames[status] || status}</span><strong>{count}</strong></div>
                ))}
              </div>
            </section>
          </div>

          <section className="judge-admin-section">
            <div className="section-header"><h2>最近操作</h2><span className="muted">保留最近 30 条</span></div>
            {data.audit_logs.length === 0 ? <p className="empty-state">暂无集群配置变更。</p> : (
              <div className="judge-audit-list">
                {data.audit_logs.map((item) => (
                  <div key={item.id}>
                    <time>{new Date(item.created_at).toLocaleString()}</time>
                    <strong>{item.actor_name || '系统'}</strong>
                    <span>{item.action}</span>
                    <code>{item.target}</code>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  )
}
