import { useState } from 'react'

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    try {
      const ta = document.createElement('textarea')
      ta.value = text
      ta.style.position = 'fixed'
      ta.style.opacity = '0'
      document.body.appendChild(ta)
      ta.focus()
      ta.select()
      const ok = document.execCommand('copy')
      document.body.removeChild(ta)
      return ok
    } catch {
      return false
    }
  }
}

export default function SampleBlock({ title, content }: { title: string; content: string }) {
  const [copied, setCopied] = useState(false)

  const onCopy = async () => {
    const ok = await copyText(content)
    if (ok) {
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    }
  }

  return (
    <div className="sample-block">
      <div className="sample-header">
        <span className="sample-title">{title}</span>
        <button type="button" className="small-button" onClick={onCopy}>
          {copied ? '已复制' : '复制'}
        </button>
      </div>
      <pre className="sample-content">{content}</pre>
    </div>
  )
}
