import { useCallback, useEffect, useRef, useState } from 'react'

const PREFIX = 'yunoj:code-draft:v1'
const SAVE_DELAY_MS = 250

function codeKey(scope: string, language: string): string {
  return `${PREFIX}:${scope}:${language}`
}

function languageKey(scope: string): string {
  return `${PREFIX}:${scope}:language`
}

function read(key: string): string {
  try {
    return window.localStorage.getItem(key) ?? ''
  } catch {
    return ''
  }
}

function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 隐私模式或存储额度不足时仍保留当前页内编辑状态。
  }
}

export function preferredDraftLanguage(scope: string): string {
  return read(languageKey(scope))
}

export function rememberDraftLanguage(scope: string, language: string): void {
  if (language) write(languageKey(scope), language)
}

export function useCodeDraft(scope: string, language: string) {
  const [code, setCode] = useState('')
  const codeRef = useRef('')
  const keyRef = useRef('')
  const timerRef = useRef<number | null>(null)

  const flush = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (keyRef.current) write(keyRef.current, codeRef.current)
  }, [])

  useEffect(() => {
    flush()
    const nextKey = language ? codeKey(scope, language) : ''
    keyRef.current = nextKey
    const restored = nextKey ? read(nextKey) : ''
    codeRef.current = restored
    setCode(restored)
  }, [flush, language, scope])

  useEffect(() => () => flush(), [flush])

  const updateCode = useCallback((value: string) => {
    codeRef.current = value
    setCode(value)
    if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null
      if (keyRef.current) write(keyRef.current, codeRef.current)
    }, SAVE_DELAY_MS)
  }, [])

  return { code, setCode: updateCode, flushDraft: flush }
}
