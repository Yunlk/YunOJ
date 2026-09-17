import { useEffect, useState } from 'react'
import { downloadProblemAttachment, getProblemAttachments } from '../api'
import type { ProblemAttachment } from '../types'
import { formatBytes } from '../utils/format'

/**
 * 题目页（选手视角）的附件区：只读，点文件名下载。
 * 没有附件时整块不渲染，避免在题面里占位置。
 */
export default function ProblemAttachmentList({ problemId }: { problemId: number | string }) {
  const [items, setItems] = useState<ProblemAttachment[]>([])
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false
    setItems([])
    getProblemAttachments(problemId)
      .then((data) => {
        if (!cancelled) setItems(data.items ?? [])
      })
      .catch(() => {
        // 附件区是补充信息，拉取失败不打断题面阅读
      })
    return () => {
      cancelled = true
    }
  }, [problemId])

  if (items.length === 0) return null

  return (
    <section className="section">
      <h2 className="section-title">附件</h2>
      <ul className="attachment-list">
        {items.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="attachment-link"
              onClick={() => {
                downloadProblemAttachment(problemId, item).catch((err) => {
                  setError(err instanceof Error ? err.message : '下载失败')
                })
              }}
            >
              {item.filename}
            </button>
            <span className="attachment-size">{formatBytes(item.size_bytes)}</span>
          </li>
        ))}
      </ul>
      {error && <p className="field-hint">{error}</p>}
    </section>
  )
}
