// 验证比赛性能相关新接口：/contests/active（导航倒计时）与列表自带 is_registered（消除 N+1）。
import { getToken } from './auth.mjs'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const token = await getToken('demo05', 'demo123')
const h = { Authorization: `Bearer ${token}` }

const get = async (p) => {
  const r = await fetch(`${API}${p}`, { headers: h })
  return { status: r.status, data: r.status < 400 ? await r.json() : await r.text() }
}

console.log('== /contests/active（导航栏用）==')
const active = await get('/contests/active')
console.log('  status', active.status, '| contest =', active.data.contest === null ? 'null（当前无进行中比赛）' : JSON.stringify(active.data.contest).slice(0, 90))

console.log('\n== /contests?size=8 是否自带 is_registered ==')
const list = await get('/contests?size=8')
const items = list.data.items ?? []
console.log(`  共 ${list.data.total} 场，本页 ${items.length} 场`)
const withField = items.filter((c) => 'is_registered' in c).length
console.log(`  带 is_registered 字段：${withField}/${items.length}`)
for (const c of items.slice(0, 4)) {
  console.log(`   #${c.id} ${String(c.title).slice(0, 24).padEnd(26)} is_registered=${c.is_registered}`)
}

console.log('\n== 报名状态是否与单场接口一致（抽查首场）==')
if (items[0]) {
  const one = await get(`/contests/${items[0].id}/registration`)
  const single = one.status < 400 ? (one.data.is_registered ?? one.data.registered ?? '(字段名待查)') : `HTTP ${one.status}`
  console.log(`   #${items[0].id} 列表=${items[0].is_registered} 单场接口=${JSON.stringify(single)}`)
}
