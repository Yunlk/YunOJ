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

export function useCodeDraft(scope: string, language: string, seedFor?: (language: string) => string) {
  const [code, setCode] = useState('')
  const codeRef = useRef('')
  const keyRef = useRef('')
  const timerRef = useRef<number | null>(null)
  // 初始代码（函数题的函数骨架）放在 ref 里：它随题目数据到达而变化，
  // 但不能因为父组件重渲染就让 effect 重跑、把选手正在编辑的内容冲掉。
  const seedRef = useRef(seedFor)
  seedRef.current = seedFor

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
    // 本地草稿优先；没有草稿时才用题目给的初始代码（函数题骨架）。
    const seeded = restored || (language && seedRef.current ? seedRef.current(language) : '')
    codeRef.current = seeded
    setCode(seeded)
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
