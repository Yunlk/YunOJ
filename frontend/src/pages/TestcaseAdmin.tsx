import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addTestcase, deleteTestcase, extractError, getProblem, getTestcases,
  importTestsZip, previewTestsZip, reorderTestcases, updateTestcase,
} from '../api'
import type { ProblemDetail, TestcasesResp, ZipPreview } from '../types'
import PageHeader from '../components/PageHeader'
import ProblemAdminTabs from '../components/ProblemAdminTabs'

const PROBLEM_TYPE_LABELS: Record<string, string> = {
  standard: '标准',
  hack: 'Hack',
  spj: 'SPJ',
  interactive: '交互',
  output_only: '输出题',
}

function fmtSize(bytes: number): string {
  if (bytes <= 0) return '—'
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(2)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

export default function TestcaseAdmin() {
  const { id } = useParams()
  const problemId = Number(id)
  const [problem, setProblem] = useState<ProblemDetail | null>(null)
  const [data, setData] = useState<TestcasesResp | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // 单点添加
  const [inFile, setInFile] = useState<File | null>(null)
  const [outFile, setOutFile] = useState<File | null>(null)
  const [score, setScore] = useState('')

  // ZIP 导入
  const [zipFile, setZipFile] = useState<File | null>(null)
  const [zipPreview, setZipPreview] = useState<ZipPreview | null>(null)
  const [zipMode, setZipMode] = useState<'replace' | 'append'>('replace')
  const [zipScores, setZipScores] = useState<string[]>([])
  const zipInput = useRef<HTMLInputElement>(null)

  // 拖拽排序
  const [dragIdx, setDragIdx] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setError('')
    Promise.all([getProblem(problemId), getTestcases(problemId)])
      .then(([p, t]) => {
        setProblem(p)
        setData(t)
      })
      .catch((err) => setError(extractError(err)))
      .finally(() => setLoading(false))
  }, [problemId])

  useEffect(() => {
    load()
  }, [load])

  const run = async (fn: () => Promise<unknown>, msg = '') => {
    setBusy(true)
    setError('')
    try {
      await fn()
      await load()
      if (msg) window.alert(msg)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const handleAdd = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    if (!inFile || !outFile) {
      setError('请选择输入与输出文件')
      return
    }
    const s = Number(score)
    if (!Number.isInteger(s) || s < 0 || s > 100) {
      setError('分值需为 0-100 的整数')
      return
    }
    void run(() => addTestcase(problemId, inFile, outFile, s), '测试点已添加')
      .then(() => {
        setInFile(null); setOutFile(null); setScore('')
      })
  }

  const handleScore = (ordinal: number, newScore: number) => {
    if (newScore < 0 || newScore > 100) {
      window.alert('分值需为 0-100')
      return
    }
    void run(() => updateTestcase(problemId, ordinal, { score: newScore }))
  }

  const handleDelete = (ordinal: number) => {
    if (!window.confirm(`删除测试点 ${ordinal}？其余编号保持不变。`)) return
    void run(() => deleteTestcase(problemId, ordinal))
  }

  const handleZipPick = async (f: File) => {
    setZipFile(f)
    setZipPreview(null)
    setError('')
    try {
      const p = await previewTestsZip(problemId, f)
      setZipPreview(p)
      setZipScores(p.pairs.map(() => ''))
    } catch (err) {
      setError(extractError(err))
    }
  }

  const handleZipImport = () => {
    if (!zipFile || !zipPreview) return
    const allEmpty = zipScores.every((s) => s.trim() === '')
    const scores = zipScores.map((s) => Number(s))
    if (zipMode === 'append' && allEmpty) {
      setError('追加模式必须为每个新测试点填写 0-100 的分值')
      return
    }
    if (!allEmpty && scores.some((s) => !Number.isInteger(s) || s < 0 || s > 100)) {
      setError('分值需为 0-100 的整数')
      return
    }
    void run(async () => {
      await importTestsZip(problemId, zipFile, zipMode, allEmpty ? [] : scores)
      setZipFile(null)
      setZipPreview(null)
      if (zipInput.current) zipInput.current.value = ''
    }, '测试点已导入')
  }

  const handleReorder = (from: number, to: number) => {
    if (!data || from === to) return
    const ordinals = data.items.map((t) => t.ordinal)
    const [moved] = ordinals.splice(from, 1)
    ordinals.splice(to, 0, moved)
    void run(() => reorderTestcases(problemId, ordinals), '排序已更新')
  }

  if (loading) return <div className="page-loading">加载中…</div>
  if (!problem || !data) return <div className="error-message">{error || '加载失败'}</div>

  const total = data.total_score
  const scoreValid = data.score_valid

  return (
    <div>
      <PageHeader
        eyebrow="题目管理"
        title={`测试点 · ${problem.title}`}
        description="上传、排序并校验评测数据。"
        actions={<div className="page-actions">
          <Link to={`/problem/${problem.id}`} className="button button-secondary">预览题目</Link>
        </div>}
      />

      {/* 与编辑页共用同一套三段式导航 */}
      <ProblemAdminTabs problemId={problem.id} active="tests" />

      {error && <div className="error-message">{error}</div>}

      <div className="card">
        <dl className="kv-list">
          <div><dt>题型</dt><dd>{PROBLEM_TYPE_LABELS[problem.type] ?? problem.type}</dd></div>
          <div><dt>测试点数</dt><dd>{data.count}</dd></div>
          <div>
            <dt>总分</dt>
            <dd className={scoreValid ? 'status-green' : 'status-red'}>
              {total} / 100 {scoreValid ? '✓' : '（发布需总分恰好 100）'}
            </dd>
          </div>
          <div><dt>题目状态</dt><dd>{problem.status}</dd></div>
        </dl>
      </div>

      {problem.status === 'published' && (
        <div className="warning-message">
          题目已发布：删除/改分后总分必须仍为 100 且至少保留 1 个测试点；如需自由编辑请先转为草稿。
        </div>
      )}

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">测试点列表</h2>
          <span className="section-hint">拖拽行可调整评测顺序</span>
        </div>
        <div className="table-summary">
          <span>共 {data.items.length} 个测试点 · 总分 {total} / 100</span>
          <span className={scoreValid ? 'badge badge-positive' : 'badge badge-danger'}>
            {scoreValid ? '分值合法' : '分值不合法'}
          </span>
        </div>
        <div className="table-frame">
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>编号</th>
              <th style={{ width: 110 }}>分值（0-100）</th>
              <th style={{ width: 84 }} title="预测试点：比赛开启「只评测预测试」时，比赛期间只跑这些点">
                预测试
              </th>
              <th>输入文件</th>
              <th>输出文件</th>
              <th style={{ width: 100 }}>大小</th>
              <th style={{ width: 100 }}>校验</th>
              <th style={{ width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td colSpan={8} className="table-empty">暂无测试点，上传 ZIP 或添加单个测试点</td></tr>
            ) : (
              data.items.map((t, i) => (
                <tr
                  key={t.ordinal}
                  draggable
                  onDragStart={() => setDragIdx(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragIdx !== null) handleReorder(dragIdx, i)
                    setDragIdx(null)
                  }}
                  style={{ cursor: 'grab' }}
                  title="拖拽排序"
                >
                  <td className="cell-id">#{t.ordinal}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={t.score}
                      disabled={busy}
                      aria-label={`测试点 ${t.ordinal} 的分值`}
                      onChange={(e) => handleScore(t.ordinal, Number(e.target.value))}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td>
                    <input
                      type="checkbox"
                      checked={t.is_pretest}
                      disabled={busy}
                      aria-label={`把测试点 ${t.ordinal} 标记为预测试点`}
                      title="标记为预测试点"
                      onChange={(e) => void run(() => updateTestcase(problemId, t.ordinal, { is_pretest: e.target.checked }))}
                    />
                  </td>
                  <td className="cell-id">{t.ordinal}.in {t.input_exists ? '' : '（缺失）'}</td>
                  <td className="cell-id">{t.ordinal}.out {t.output_exists ? '' : '（缺失）'}</td>
                  <td className="cell-num">{fmtSize(t.size_bytes)}</td>
                  <td>
                    <span className={t.valid ? 'badge badge-positive' : 'badge badge-danger'}>
                      {t.valid ? '正常' : '缺失'}
                    </span>
                  </td>
                  <td className="cell-actions">
                    <button type="button" className="button button-ghost button-sm danger" disabled={busy} onClick={() => handleDelete(t.ordinal)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        </div>
      </section>

      <section className="section">
        <div className="section-head"><h2 className="section-title">添加单个测试点</h2></div>
        <div className="card">
          <form className="admin-problem-form" onSubmit={handleAdd}>
            <div className="form-group">
              <label htmlFor="tc-in">输入文件（.in）</label>
              <input id="tc-in" type="file" onChange={(e) => setInFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="form-group">
              <label htmlFor="tc-out">输出文件（.out）</label>
              <input id="tc-out" type="file" onChange={(e) => setOutFile(e.target.files?.[0] ?? null)} />
            </div>
            <div className="form-group">
              <label htmlFor="tc-score">分值</label>
              <input id="tc-score" type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />
            </div>
            <button type="submit" className="button button-primary" disabled={busy}>添加</button>
          </form>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title">ZIP 批量导入</h2>
          <span className="section-hint">先预览，确认后写入</span>
        </div>
        <div className="card">
          <div className="admin-form-cols">
            <div className="form-group">
              <label htmlFor="tc-zip">测试数据 zip（N.in / N.out 成对）</label>
              <input id="tc-zip" ref={zipInput} type="file" accept=".zip" onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void handleZipPick(f)
              }} />
            </div>
            <div className="form-group">
              <label htmlFor="tc-zip-mode">模式</label>
              <select id="tc-zip-mode" value={zipMode} onChange={(e) => setZipMode(e.target.value as 'replace' | 'append')}>
                <option value="replace">整体替换（覆盖现有测试点与文件）</option>
                <option value="append">追加（编号接在现有最大编号之后）</option>
              </select>
            </div>
          </div>

          {zipPreview && (() => {
            // 后端历史上会把空切片序列化成 null（Go nil slice → JSON null），
            // 这里统一兜底，避免「can't access property "length", … is null」把整页打崩。
            const pairs = zipPreview.pairs ?? []
            const unpaired = zipPreview.unpaired ?? []
            return (
            <div className="zip-preview">
              <div className={zipPreview.valid ? 'info-message' : 'warning-message'}>
                解析结果：{pairs.length} 组成对测试点
                {unpaired.length > 0 && `，未配对文件：${unpaired.join('、')}`}
                {zipPreview.valid ? '，可导入' : '，存在未配对文件将无法导入'}
                ，总大小 {fmtSize(zipPreview.total_size)}
              </div>
              {pairs.length > 0 && (
                <>
                  <div className="table-frame">
                    <table className="data-table">
                      <thead>
                        <tr>
                          <th style={{ width: 90 }}>编号</th>
                          <th>输入大小</th>
                          <th>输出大小</th>
                          <th style={{ width: 130 }}>分值（0-100）</th>
                        </tr>
                      </thead>
                      <tbody>
                        {pairs.map((p, i) => (
                          <tr key={p.name}>
                            <td className="cell-id">{p.name}</td>
                            <td className="cell-num">{fmtSize(p.in_size)}</td>
                            <td className="cell-num">{fmtSize(p.out_size)}</td>
                            <td>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                value={zipScores[i] ?? ''}
                                placeholder={zipMode === 'replace' ? '留空=均分' : '必填'}
                                aria-label={`测试点 ${p.name} 的分值`}
                                onChange={(e) => {
                                  const next = [...zipScores]
                                  next[i] = e.target.value
                                  setZipScores(next)
                                }}
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="admin-form-actions">
                    <button
                      type="button"
                      className="button button-primary"
                      disabled={busy || !zipPreview.valid}
                      onClick={handleZipImport}
                    >
                      {busy ? '导入中…' : '确认导入'}
                    </button>
                  </div>
                </>
              )}
            </div>
            )
          })()}
        </div>
      </section>
    </div>
  )
}
