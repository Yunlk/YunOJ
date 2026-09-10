// 共享登录：带磁盘缓存，避免探测脚本反复登录触发后端限流（12 次 / 5 分钟）。
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { createHash } from 'node:crypto'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const CACHE_DIR = new URL('./.cache/', import.meta.url).pathname.replace(/^\//, '')
const TTL_MS = 30 * 60 * 1000

mkdirSync(CACHE_DIR, { recursive: true })

const cachePath = (user) => `${CACHE_DIR}token-${createHash('sha1').update(user).digest('hex').slice(0, 10)}.json`

export async function getToken(user, pass) {
  const file = cachePath(user)
  try {
    const cached = JSON.parse(readFileSync(file, 'utf8'))
    if (cached.user === user && cached.token && Date.now() - cached.at < TTL_MS) return cached.token
  } catch {
    // 无缓存或缓存损坏：走登录
  }
  const res = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
  })
  if (!res.ok) throw new Error(`登录失败 ${res.status}（若为 429，说明触发了登录限流，等 5 分钟或复用缓存令牌）`)
  const data = await res.json()
  writeFileSync(file, JSON.stringify({ user, token: data.token, at: Date.now() }))
  return data.token
}
