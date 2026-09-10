// 验证比赛列表的 is_registered 与「只看我报名的」：先查 demo01 已报名的比赛，
// 再看列表接口是否把这些比赛标为 is_registered=true。
import { getToken } from './auth.mjs'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const token = await getToken('demo01', 'demo123')
const h = { Authorization: `Bearer ${token}` }

const list = await (await fetch(`${API}/contests?size=200`, { headers: h })).json()
const registered = (list.items ?? []).filter((c) => c.is_registered)
console.log(`列表共 ${list.items?.length ?? 0} 场，其中 is_registered=true：${registered.length} 场`)
for (const c of registered.slice(0, 5)) console.log(`   #${c.id} ${c.title}`)

// 与单场接口交叉验证
for (const c of (list.items ?? []).slice(0, 6)) {
  if (c.id < 180) continue // 只看较新的比赛
  const one = await (await fetch(`${API}/contests/${c.id}/registration`, { headers: h })).json()
  const single = one.is_registered ?? one.registered
  const agree = Boolean(single) === Boolean(c.is_registered)
  console.log(`#${c.id} 列表=${c.is_registered} 单场=${single} ${agree ? '✓ 一致' : '✗ 不一致'}`)
}
