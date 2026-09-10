// 验证提交列表新增筛选：language / created_after / created_before（RFC3339 与 Unix 秒）。
import { getToken } from './auth.mjs'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const token = await getToken('demo05', 'demo123')
const h = { Authorization: `Bearer ${token}` }

const get = async (qs) => {
  const r = await fetch(`${API}/submissions?size=5${qs}`, { headers: h })
  if (!r.ok) return { error: `${r.status} ${await r.text()}` }
  const d = await r.json()
  return { total: d.total, first: d.items[0]?.created_at ?? '-', langs: [...new Set(d.items.map((i) => i.language))].join(',') }
}

console.log('全部            :', JSON.stringify(await get('')))
console.log('language=cpp    :', JSON.stringify(await get('&language=cpp')))
console.log('language=python :', JSON.stringify(await get('&language=python')))

const now = Math.floor(Date.now() / 1000)
console.log('created_after=今天0点 :', JSON.stringify(await get(`&created_after=${now - 86400}`)))
console.log('RFC3339 近 1 小时     :', JSON.stringify(await get(`&created_after=${encodeURIComponent(new Date(Date.now() - 3600e3).toISOString())}`)))
console.log('区间（1 天内到 1 小时前）:', JSON.stringify(await get(`&created_after=${now - 86400}&created_before=${now - 3600}`)))
console.log('非法时间应被忽略      :', JSON.stringify(await get('&created_after=not-a-time')))
console.log('未来时间应返回 0 条   :', JSON.stringify(await get(`&created_after=${now + 86400}`)))
