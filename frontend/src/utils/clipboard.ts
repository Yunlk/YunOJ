// 与后端评测器一致的 token 比较（忽略行末空格与文末换行），
// 用于样例运行结果在前端的即时比对展示。
export function tokenCompare(expected: string, actual: string): boolean {
  const tokenize = (s: string) => s.replace(/^\uFEFF/, '').trim().split(/\s+/).filter(Boolean)
  const e = tokenize(expected)
  const a = tokenize(actual)
  if (e.length !== a.length) return false
  for (let i = 0; i < e.length; i++) {
    if (e[i] !== a[i]) return false
  }
  return true
}

// 复制文本到剪贴板（带降级方案），返回是否成功。
export async function copyText(text: string): Promise<boolean> {
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
      ta.select()
      document.execCommand('copy')
      document.body.removeChild(ta)
      return true
    } catch {
      return false
    }
  }
}
