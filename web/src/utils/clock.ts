import { useEffect, useState } from 'react'
import { getServerTime } from '../api'

// 服务器时间校正：offset = server - client（毫秒）。
// 后端时间为权威时间；前端倒计时用 serverNow() 计算，避免客户端时钟偏差。
let offsetMs = 0
let syncing: Promise<void> | null = null

export async function syncClock(): Promise<void> {
  if (syncing) return syncing
  syncing = (async () => {
    try {
      const t0 = Date.now()
      const server = await getServerTime()
      const t1 = Date.now()
      const serverMs = new Date(server).getTime()
      if (!Number.isNaN(serverMs)) {
        offsetMs = serverMs - (t0 + t1) / 2
      }
    } catch {
      // 同步失败保持上次偏移（或 0），倒计时仍可用
    }
    syncing = null
  })()
  return syncing
}

/** 校正后的服务器当前时间（毫秒时间戳）。 */
export function serverNow(): number {
  return Date.now() + offsetMs
}

/** 每秒 tick 一次并保持时钟同步的 hook（用于倒计时/进度条组件）。 */
export function useClock(intervalMs = 1000): number {
  const [now, setNow] = useState(serverNow)
  useEffect(() => {
    void syncClock()
    const t = window.setInterval(() => {
      setNow(serverNow())
    }, intervalMs)
    return () => window.clearInterval(t)
  }, [intervalMs])
  return now
}

/** 格式化剩余时间：HH:MM:SS（超过 24 小时显示天数）。 */
export function formatRemaining(ms: number): string {
  if (ms <= 0) return '00:00:00'
  const totalSec = Math.floor(ms / 1000)
  const days = Math.floor(totalSec / 86400)
  const h = Math.floor((totalSec % 86400) / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return days > 0 ? `${days} 天 ${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(h)}:${pad(m)}:${pad(s)}`
}
