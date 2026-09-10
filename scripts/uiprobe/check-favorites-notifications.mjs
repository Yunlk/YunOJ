// 验证：收藏列表自带 my_status、通知批量已读接口。
import { getToken } from './auth.mjs'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const student = await getToken('demo01', 'demo123')
const admin = await getToken('e2eadmin', 'Yunoj#2026')

const api = async (path, token, method = 'GET') => {
  const r = await fetch(`${API}${path}`, { method, headers: { Authorization: `Bearer ${token}` } })
  const text = await r.text()
  let data = null
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  return { status: r.status, data }
}

console.log('== 收藏列表 my_status ==')
const fav = await api('/profile/favorites', student)
if (fav.status !== 200) {
  console.log('  失败:', fav.status, fav.data)
} else {
  const items = fav.data.items ?? []
  console.log(`  共 ${items.length} 条收藏`)
  for (const it of items.slice(0, 8)) {
    console.log(`   P${it.id} ${String(it.title).slice(0, 14)}  my_status=${it.my_status === undefined ? '(缺失)' : `'${it.my_status}'`}`)
  }
  const withField = items.filter((i) => 'my_status' in i).length
  console.log(`  带 my_status 字段：${withField}/${items.length}`)
}

console.log('\n== 通知批量已读 ==')
const before = await api('/notifications', admin)
const unreadBefore = (before.data.items ?? []).filter((n) => n.read === false).length
console.log(`  标记前未读 ${unreadBefore} 条（共 ${(before.data.items ?? []).length} 条）`)
const mark = await api('/notifications/read-all', admin, 'POST')
console.log('  POST /notifications/read-all →', mark.status, JSON.stringify(mark.data))
const after = await api('/notifications', admin)
const unreadAfter = (after.data.items ?? []).filter((n) => n.read === false).length
console.log(`  标记后未读 ${unreadAfter} 条`)
console.log(unreadAfter === 0 ? '  ✓ 批量已读生效' : '  ✗ 仍有未读')
