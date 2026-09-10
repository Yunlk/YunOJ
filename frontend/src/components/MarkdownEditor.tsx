import { useRef, useState } from 'react'
import { extractError, uploadMarkdownImage } from '../api'
import Markdown from './Markdown'

interface MarkdownEditorProps {
  id: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  className?: string
}

/** Markdown 编辑器：左侧源码、右侧实时预览，并支持上传图片插入链接。 */
export default function MarkdownEditor({
  id,
  value,
  onChange,
  placeholder,
  className = '',
}: MarkdownEditorProps) {
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const syncingRef = useRef<HTMLElement | null>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')

  const syncScroll = (source: HTMLElement | null, target: HTMLElement | null) => {
    if (!source || !target) return
    if (syncingRef.current === source) {
      syncingRef.current = null
      return
    }
    const sourceMax = source.scrollHeight - source.clientHeight
    const targetMax = target.scrollHeight - target.clientHeight
    const ratio = sourceMax > 0 ? source.scrollTop / sourceMax : 0
    syncingRef.current = target
    target.scrollTop = ratio * Math.max(0, targetMax)
    requestAnimationFrame(() => {
      if (syncingRef.current === target) syncingRef.current = null
    })
  }

  const insertAtCursor = (text: string) => {
    const input = inputRef.current
    if (!input) {
      onChange(`${value}${value ? '\n\n' : ''}${text}`)
      return
    }
    const start = input.selectionStart ?? value.length
    const end = input.selectionEnd ?? start
    const before = value.slice(0, start)
    const after = value.slice(end)
    const prefix = before && !before.endsWith('\n') ? '\n\n' : ''
    const suffix = after && !after.startsWith('\n') ? '\n\n' : ''
    const next = `${before}${prefix}${text}${suffix}${after}`
    onChange(next)
    requestAnimationFrame(() => {
      input.focus()
      const cursor = start + prefix.length + text.length
      input.setSelectionRange(cursor, cursor)
    })
  }

  const chooseImage = async (file: File | undefined) => {
    if (!file) return
    setError('')
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件')
      return
    }
    if (file.size > 4 * 1024 * 1024) {
      setError('图片不能超过 4MB')
      return
    }
    setUploading(true)
    try {
      const { url } = await uploadMarkdownImage(file)
      const alt = file.name.replace(/\.[^.]+$/, '').replace(/[\[\]]/g, '').trim() || '图片'
      insertAtCursor(`![${alt}](${url})`)
    } catch (err) {
      setError(extractError(err))
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className={`markdown-editor-shell ${className}`.trim()}>
      <div className="markdown-editor-toolbar">
        <span className="markdown-editor-mode">Markdown</span>
        <button
          type="button"
          className="button button-secondary markdown-image-button"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? '上传中…' : '插入图片'}
        </button>
        <input
          ref={fileRef}
          className="visually-hidden"
          type="file"
          accept="image/jpeg,image/png,image/gif,image/webp"
          aria-label="选择要插入的图片"
          onChange={(event) => void chooseImage(event.target.files?.[0])}
        />
      </div>
      <div className="markdown-editor-columns">
        <textarea
          ref={inputRef}
          id={id}
          className="markdown-editor markdown-editor-input"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          spellCheck={false}
          onScroll={() => syncScroll(inputRef.current, previewRef.current)}
        />
        <div
          ref={previewRef}
          className="markdown-editor-preview"
          aria-label="Markdown 预览"
          onScroll={() => syncScroll(previewRef.current, inputRef.current)}
        >
          {value.trim() ? <Markdown>{value}</Markdown> : <span className="markdown-preview-empty">预览将在这里显示</span>}
        </div>
      </div>
      {error && <div className="markdown-editor-error">{error}</div>}
    </div>
  )
}
