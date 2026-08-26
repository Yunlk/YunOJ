import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  addTestcase, deleteTestcase, extractError, getProblem, getTestcases,
  importTestsZip, previewTestsZip, reorderTestcases, updateTestcase,
} from '../api'
import type { ProblemDetail, TestcasesResp, ZipPreview } from '../types'

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
    void run(() => updateTestcase(problemId, ordinal, newScore))
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
      <div className="page-header">
        <h1 className="page-title">测试点管理 · {problem.title}</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link to={`/problem/${problem.id}/edit`} className="button button-secondary">返回编辑</Link>
          <Link to={`/problem/${problem.id}`} className="button button-secondary">预览题目</Link>
        </div>
      </div>

      {error && <div className="error-message">{error}</div>}

      <div className="card contest-meta">
        <div className="meta-item">
          <span className="field-label">题型</span>
          <span>{problem.type}</span>
        </div>
        <div className="meta-item">
          <span className="field-label">测试点数</span>
          <span>{data.count}</span>
        </div>
        <div className="meta-item">
          <span className="field-label">总分</span>
          <span className={scoreValid ? '' : 'error-text'}>
            {total} / 100 {scoreValid ? '✓' : '（发布需总分恰好 100）'}
          </span>
        </div>
        <div className="meta-item">
          <span className="field-label">题目状态</span>
          <span>{problem.status}</span>
        </div>
      </div>

      {problem.status === 'published' && (
        <div className="notice-card freeze-notice">
          题目已发布：删除/改分后总分必须仍为 100 且至少保留 1 个测试点；如需自由编辑请先转为草稿。
        </div>
      )}

      <section className="contest-section">
        <div className="section-header"><h2>测试点列表（拖拽行可排序）</h2></div>
        <table className="data-table">
          <thead>
            <tr>
              <th style={{ width: 50 }}>编号</th>
              <th style={{ width: 110 }}>分值（0-100）</th>
              <th>输入文件</th>
              <th>输出文件</th>
              <th style={{ width: 100 }}>大小</th>
              <th style={{ width: 100 }}>校验</th>
              <th style={{ width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.items.length === 0 ? (
              <tr><td colSpan={7} className="table-empty">暂无测试点，上传 ZIP 或添加单个测试点</td></tr>
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
                  <td className="mono">#{t.ordinal}</td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={t.score}
                      disabled={busy}
                      onChange={(e) => handleScore(t.ordinal, Number(e.target.value))}
                      style={{ width: 80 }}
                    />
                  </td>
                  <td className="mono">{t.ordinal}.in {t.input_exists ? '' : '（缺失）'}</td>
                  <td className="mono">{t.ordinal}.out {t.output_exists ? '' : '（缺失）'}</td>
                  <td className="mono">{fmtSize(t.size_bytes)}</td>
                  <td>
                    <span className={`phase-badge ${t.valid ? 'phase-running' : 'phase-ended'}`}>
                      {t.valid ? '正常' : '缺失'}
                    </span>
                  </td>
                  <td>
                    <button type="button" className="link-button danger" disabled={busy} onClick={() => handleDelete(t.ordinal)}>
                      删除
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="contest-section">
        <div className="section-header"><h2>添加单个测试点</h2></div>
        <div className="card">
          <form className="form-row admin-problem-form" onSubmit={handleAdd}>
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

      <section className="contest-section">
        <div className="section-header"><h2>ZIP 批量导入（先预览，确认后写入）</h2></div>
        <div className="card">
          <div className="form-row">
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

          {zipPreview && (
            <div className="zip-preview">
              <div className={`notice-card ${zipPreview.valid ? '' : 'freeze-notice'}`}>
                解析结果：{zipPreview.pairs.length} 组成对测试点
                {zipPreview.unpaired.length > 0 && `，未配对文件：${zipPreview.unpaired.join('、')}`}
                {zipPreview.valid ? '，可导入' : '，存在未配对文件将无法导入'}
                ，总大小 {fmtSize(zipPreview.total_size)}
              </div>
              {zipPreview.pairs.length > 0 && (
                <>
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
                      {zipPreview.pairs.map((p, i) => (
                        <tr key={p.name}>
                          <td className="mono">{p.name}</td>
                          <td className="mono">{fmtSize(p.in_size)}</td>
                          <td className="mono">{fmtSize(p.out_size)}</td>
                          <td>
                            <input
                              type="number"
                              min={0}
                              max={100}
                              value={zipScores[i] ?? ''}
                              placeholder={zipMode === 'replace' ? '留空=均分' : '必填'}
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
                  <button
                    type="button"
                    className="button button-primary"
                    disabled={busy || !zipPreview.valid}
                    onClick={handleZipImport}
                  >
                    {busy ? '导入中…' : '确认导入'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
