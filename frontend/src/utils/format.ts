function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** RFC3339 -> 本地时间字符串，解析失败时原样返回 */
export function formatTime(s: string): string {
  if (!s) return '—'
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) return s
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/** 内存 KB -> 人类可读 */
export function formatMemory(kb: number): string {
  if (kb <= 0) return '—'
  if (kb >= 1024 * 1024) return `${(kb / 1024 / 1024).toFixed(2)} GB`
  if (kb >= 1024) return `${(kb / 1024).toFixed(1)} MB`
  return `${kb} KB`
}

/** 时间限制 ms -> 人类可读 */
export function formatTimeLimit(ms: number): string {
  if (ms <= 0) return '—'
  if (ms >= 1000 && ms % 1000 === 0) return `${ms / 1000} s`
  return `${ms} ms`
}

/** 单次运行耗时 ms */
export function formatRunTime(ms: number): string {
  if (ms <= 0) return '—'
  return `${ms} ms`
}
