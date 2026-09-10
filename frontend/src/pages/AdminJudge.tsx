import { useEffect, useState } from 'react'
import { api, extractError } from '../api'
import PageHeader from '../components/PageHeader'

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
      <td className="cell-num">
        <strong>{node.actual_concurrency}</strong>
        <span className="table-subtext"> / {node.desired_concurrency}</span>
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
            className="button button-secondary button-sm"
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
          aria-pressed={node.enabled}
          title={node.enabled ? '点击停止接收新任务' : '点击恢复接收任务'}
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
      <PageHeader
        eyebrow="平台运维"
        title="测评集群"
        description="管理节点容量与对用户开放的语言。节点配置约 3 秒内生效。"
        actions={<button className="button button-secondary" type="button" onClick={() => void recover()} disabled={recovering}>
          {recovering ? '恢复中…' : '恢复卡住任务'}
        </button>}
      />

      {error && <div className="error-message">{error}</div>}
      {!data ? <div className="page-loading">读取集群状态...</div> : (
        <>
          <div className="stat-grid">
            <div className="stat-tile"><span className="stat-tile-label">队列等待</span><strong className="stat-tile-value">{data.queue.queued}</strong></div>
            <div className="stat-tile"><span className="stat-tile-label">正在处理</span><strong className="stat-tile-value">{data.summary.processing}</strong></div>
            <div className="stat-tile"><span className="stat-tile-label">在线节点</span><strong className="stat-tile-value">{data.summary.online_nodes}/{data.summary.total_nodes}</strong></div>
            <div className="stat-tile"><span className="stat-tile-label">实际 / 目标并发</span><strong className="stat-tile-value">{data.summary.actual_concurrency}/{data.summary.desired_concurrency}</strong></div>
          </div>

          <section className="section">
            <div className="section-head">
              <h2 className="section-title">评测节点</h2>
              <span className="section-hint">正在执行的任务会完成后再排空</span>
            </div>
            <div className="table-frame">
              <table className="data-table judge-node-table">
                <thead>
                  <tr><th>节点</th><th>主机</th><th>实际 / 目标</th><th>目标并发</th><th className="cell-state">调度</th><th>最后心跳</th></tr>
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
            <section className="section judge-admin-section">
              <div className="section-head">
                <h2 className="section-title">提交语言</h2>
                <span className="section-hint">命令由服务端配置维护</span>
              </div>
              <div className="judge-language-list">
                {data.languages.map((language) => (
                  <div className="judge-language-row" key={language.key}>
                    <span><strong>{language.name}</strong><small>{language.version} · {language.key}</small></span>
                    <button
                      className={`status-toggle ${language.enabled ? 'enabled' : 'disabled'}`}
                      type="button"
                      disabled={languageSaving === language.key}
                      aria-pressed={language.enabled}
                      title={language.enabled ? '点击停止向用户开放' : '点击重新开放'}
                      onClick={() => void toggleLanguage(language)}
                    >
                      {language.enabled ? '已开放' : '已停用'}
                    </button>
                  </div>
                ))}
              </div>
            </section>

            <section className="section judge-admin-section">
              <div className="section-head"><h2 className="section-title">提交状态</h2><span className="section-hint">全部历史记录</span></div>
              <div className="judge-status-grid">
                {Object.entries(data.statuses).map(([status, count]) => (
                  <div key={status}><span>{statusNames[status] || status}</span><strong>{count}</strong></div>
                ))}
              </div>
            </section>
          </div>

          <section className="section judge-admin-section">
            <div className="section-head"><h2 className="section-title">最近操作</h2><span className="section-hint">保留最近 30 条</span></div>
            {data.audit_logs.length === 0 ? (
              <div className="empty-state">
                <div className="empty-state-title">暂无集群配置变更</div>
                <div className="empty-state-hint">调整节点并发或开关语言后，操作记录会出现在这里。</div>
              </div>
            ) : (
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
