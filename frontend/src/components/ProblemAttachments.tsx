import { useEffect, useRef, useState } from 'react'
import {
  deleteProblemAttachment,
  downloadProblemAttachment,
  extractError,
  getProblemAttachments,
  uploadProblemAttachment,
} from '../api'
import type { ProblemAttachment } from '../types'
import { formatBytes, formatTime } from '../utils/format'

/**
 * 题目附件管理（题目设置里的一块）：上传、下载、删除。
 * 附件是题面之外的补充材料（模板、样例数据、题解 PDF 等），选手在题目页可直接下载。
 * 新建题目还没有 id，无法挂附件，这里给出提示而不是渲染一个必然失败的表单。
 */
export default function ProblemAttachments({ problemId }: { problemId?: number | string }) {
  const [items, setItems] = useState<ProblemAttachment[]>([])
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!problemId) {
      setItems([])
      return
    }
    let cancelled = false
    getProblemAttachments(problemId)
      .then((data) => {
        if (!cancelled) setItems(data.items ?? [])
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
    return () => {
      cancelled = true
    }
  }, [problemId])

  const upload = async () => {
    const files = Array.from(inputRef.current?.files ?? [])
    if (!problemId || files.length === 0) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const uploaded: ProblemAttachment[] = []
      for (const file of files) {
        uploaded.push(await uploadProblemAttachment(problemId, file))
      }
      setItems((prev) => [...prev, ...uploaded])
      setNotice(`已上传 ${uploaded.length} 个附件`)
      if (inputRef.current) inputRef.current.value = ''
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = async (item: ProblemAttachment) => {
    if (!problemId) return
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await deleteProblemAttachment(problemId, item.id)
      setItems((prev) => prev.filter((a) => a.id !== item.id))
    } catch (err) {
      setError(extractError(err))
    } finally {
      setBusy(false)
    }
  }

  const download = async (item: ProblemAttachment) => {
    if (!problemId) return
    try {
      await downloadProblemAttachment(problemId, item)
    } catch (err) {
      setError(extractError(err))
    }
  }

  return (
    <fieldset className="form-group admin-fieldset">
      <legend className="field-label">题目附件</legend>
      <p className="field-hint">
        题面之外的补充材料（模板、样例数据、题解 PDF 等）。选手在题目页可以下载；单个文件最大 32MB，每题最多 20 个。
      </p>

      {!problemId ? (
        <div className="info-message">保存题目后即可上传附件。</div>
      ) : (
        <>
          {items.length > 0 && (
            <div className="table-frame">
              <table className="data-table attachment-table">
                <thead>
                  <tr>
                    <th>文件名</th>
                    <th style={{ width: 110 }}>大小</th>
                    <th style={{ width: 170 }}>上传时间</th>
                    <th className="cell-actions">
                      <span className="visually-hidden">操作</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.id}>
                      <td className="attachment-name">{item.filename}</td>
                      <td className="mono">{formatBytes(item.size_bytes)}</td>
                      <td className="mono">{formatTime(item.created_at)}</td>
                      <td className="cell-actions">
                        <button
                          type="button"
                          className="button button-ghost button-sm"
                          onClick={() => void download(item)}
                        >
                          下载
                        </button>
                        <button
                          type="button"
                          className="button button-ghost button-sm danger"
                          disabled={busy}
                          onClick={() => void remove(item)}
                        >
                          删除
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {items.length === 0 && <p className="field-hint">还没有附件。</p>}

          <div className="form-group">
            <label htmlFor="p-attachment">选择文件（可多选）</label>
            <input id="p-attachment" type="file" ref={inputRef} multiple />
          </div>
          <div className="admin-form-actions">
            <button
              type="button"
              className="button button-secondary"
              disabled={busy}
              onClick={() => void upload()}
            >
              {busy ? '上传中…' : '上传附件'}
            </button>
            {notice && <span className="success-message">{notice}</span>}
          </div>
        </>
      )}

      {error && <div className="error-message">{error}</div>}
    </fieldset>
  )
}
