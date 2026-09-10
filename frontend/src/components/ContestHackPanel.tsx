import { useCallback, useEffect, useState } from 'react'
import { createHack, extractError, getContestHacks, getContestLocks, getHackTargets, lockContestProblem } from '../api'
import type { ContestHackItem, HackTarget } from '../types'
import { formatTime } from '../utils/format'

const VERDICT_LABEL: Record<string, string> = {
  pending: '评测中',
  success: 'Hack 成功 +100',
  fail: 'Hack 失败 −50',
  error: '评测异常',
}

function verdictClass(verdict: string): string {
  if (verdict === 'success') return 'hack-ok'
  if (verdict === 'fail') return 'hack-bad'
  if (verdict === 'error') return 'muted'
  return 'phase-upcoming'
}

/**
 * Open Hacking 面板（Codeforces 风格）：
 *   通过题目 → 锁定该题 → 查看他人通过代码 → 提交一组数据发起 Hack。
 * 锁定后不能再向该题提交；Hack 成功 +100、失败 −50；被 Hack 的提交分数作废。
 */
export default function ContestHackPanel({ contestId, problemId, hackingEnabled, running, solved }: {
  contestId: number
  problemId: number
  hackingEnabled: boolean
  running: boolean
  solved: boolean
}) {
  const [locked, setLocked] = useState(false)
  const [targets, setTargets] = useState<HackTarget[]>([])
  const [requiresExpected, setRequiresExpected] = useState(false)
  const [hacks, setHacks] = useState<ContestHackItem[]>([])
  const [openTarget, setOpenTarget] = useState<number | null>(null)
  const [codePreview, setCodePreview] = useState<number | null>(null)
  const [input, setInput] = useState('')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const loadHacks = useCallback(() => {
    getContestHacks(contestId).then(setHacks).catch(() => {})
  }, [contestId])

  const loadTargets = useCallback(() => {
    getHackTargets(contestId, problemId)
      .then((data) => {
        setTargets(data.items)
        setLocked(data.locked)
        setRequiresExpected(data.requires_expected_output)
      })
      .catch(() => {})
  }, [contestId, problemId])

  useEffect(() => {
    if (!hackingEnabled) return
    getContestLocks(contestId)
      .then((ids) => setLocked(ids.includes(problemId)))
      .catch(() => {})
    loadHacks()
  }, [contestId, problemId, hackingEnabled, loadHacks])

  // 发起 Hack 后轮询结果（评测为异步）
  useEffect(() => {
    if (!hacks.some((h) => h.verdict === 'pending')) return
    const t = window.setInterval(loadHacks, 3000)
    return () => window.clearInterval(t)
  }, [hacks, loadHacks])

  if (!hackingEnabled) return null

  const doLock = async () => {
    if (!window.confirm('锁定后本场比赛不能再向该题提交，但可以查看并攻击他人提交。确定锁定？')) return
    setBusy(true)
    setError('')
    try {
      await lockContestProblem(contestId, problemId)
      setLocked(true)
      loadTargets()
      setNotice('已锁定该题，可以查看他人通过代码并发起 Hack')
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const submitHack = async () => {
    if (openTarget === null) return
    if (!input.trim()) {
      setError('请填写 Hack 输入数据')
      return
    }
    if (requiresExpected && !expected.trim()) {
      setError('该题目未配置参考解，必须同时填写期望输出')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await createHack(contestId, {
        target_submission_id: openTarget,
        input,
        expected_output: expected,
      })
      setNotice('Hack 已提交，评测结果稍后显示在下方列表')
      setInput('')
      setExpected('')
      setOpenTarget(null)
      loadHacks()
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="hack-panel">
      <div className="hack-panel-head">
        <strong>Hack</strong>
        {locked ? (
          <span className="phase-badge phase-running">已锁定</span>
        ) : solved && running ? (
          <button type="button" className="button button-secondary" disabled={busy} onClick={doLock}>
            锁定本题
          </button>
        ) : (
          <span className="muted">
            {!solved ? '通过该题后可锁定并攻击他人提交' : '比赛进行中才能锁定'}
          </span>
        )}
        {locked && (
          <button type="button" className="link-button" onClick={loadTargets}>刷新他人提交</button>
        )}
      </div>

      {locked && (
        <div className="hack-targets">
          {targets.length === 0 ? (
            <p className="muted">暂无可攻击的提交（其他队伍该题的通过提交会显示在这里）。</p>
          ) : (
            targets.map((t) => (
              <div key={t.submission_id} className={`hack-target${t.hacked ? ' hacked' : ''}`}>
                <span className="mono">#{t.submission_id}</span>
                <span className="hack-target-team">{t.team_name}</span>
                <span className="muted mono">{t.language}</span>
                {t.hacked && <span className="hack-bad">已被 Hack</span>}
                <button
                  type="button"
                  className="link-button"
                  onClick={() => setCodePreview(codePreview === t.submission_id ? null : t.submission_id)}
                >
                  {codePreview === t.submission_id ? '收起代码' : '查看代码'}
                </button>
                <button
                  type="button"
                  className="link-button"
                  onClick={() => {
                    setOpenTarget(openTarget === t.submission_id ? null : t.submission_id)
                    setError('')
                  }}
                >
                  {openTarget === t.submission_id ? '取消' : 'Hack 它'}
                </button>
                {codePreview === t.submission_id && <pre className="hack-code">{t.code}</pre>}
                {openTarget === t.submission_id && (
                  <div className="hack-form">
                    <label htmlFor={`hack-input-${t.submission_id}`}>测试输入数据</label>
                    <textarea
                      id={`hack-input-${t.submission_id}`}
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      placeholder="输入一组能让该程序出错的测试数据…"
                    />
                    <label htmlFor={`hack-expected-${t.submission_id}`}>
                      期望输出{requiresExpected ? '（必填：该题未配置参考解）' : '（可留空：用题目参考解自动生成）'}
                    </label>
                    <textarea
                      id={`hack-expected-${t.submission_id}`}
                      value={expected}
                      onChange={(e) => setExpected(e.target.value)}
                      placeholder={requiresExpected ? '该输入对应的正确答案' : '留空则用题目参考解计算'}
                    />
                    <button type="button" className="button button-primary" disabled={busy} onClick={submitHack}>
                      {busy ? '提交中…' : '提交 Hack'}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {error && <div className="error-message">{error}</div>}
      {notice && <div className="success-message">{notice}</div>}

      {hacks.length > 0 && (
        <div className="hack-list">
          <div className="hack-list-title">我的 Hack 记录</div>
          <table className="data-table">
            <thead>
              <tr>
                <th style={{ width: 150 }}>时间</th>
                <th style={{ width: 80 }}>目标</th>
                <th style={{ width: 150 }}>结果</th>
                <th>说明</th>
              </tr>
            </thead>
            <tbody>
              {hacks.map((h) => (
                <tr key={h.id}>
                  <td className="mono">{formatTime(h.created_at)}</td>
                  <td className="mono">#{h.target_submission_id}</td>
                  <td className={verdictClass(h.verdict)}>{VERDICT_LABEL[h.verdict] ?? h.verdict}</td>
                  <td className="muted">{h.judge_note || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
