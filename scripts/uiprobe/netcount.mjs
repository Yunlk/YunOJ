// 每页 API 请求统计：衡量页面是否有多余请求（性能视角）。
// 用法：node .tools/uiprobe/netcount.mjs [--user demo05 --pass demo123] [--only /a,/b]
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const USER = argOf('user', 'demo05')
const PASS = argOf('pass', 'demo123')
const ONLY = argOf('only')

const ROUTES = [
  ['首页', '/'],
  ['题库', '/problems'],
  ['单题(工作台)', '/problem/1'],
  ['提交记录', '/status'],
  ['提交详情', '/submission/2686'],
  ['比赛列表', '/contests'],
  ['比赛详情', '/contest/226'],
  ['比赛榜单', '/contest/226/standings'],
  ['排名', '/ranking'],
  ['个人中心', '/profile'],
  ['收藏', '/favorites'],
  ['通知', '/notifications'],
]

const token = await getToken(USER, PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)

const wanted = ONLY ? ONLY.split(',') : null
const rows = []
for (const [label, route] of ROUTES) {
  if (wanted && !wanted.some((w) => route === w || label === w)) continue
  const page = await context.newPage()
  const calls = []
  page.on('request', (r) => {
    const u = r.url()
    if (u.includes('/api/')) calls.push(u.replace(BASE, '').replace(/^\/api/, ''))
  })
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(800) // 等轮询/二次请求稳定
  const unique = [...new Set(calls)]
  rows.push({ label, route, total: calls.length, unique: unique.length, calls: unique })
  await page.close()
}

console.log('\n每页 API 请求（networkidle 后 800ms 内）')
for (const r of rows) {
  console.log(`\n${r.label.padEnd(14)} ${r.route.padEnd(26)} 请求 ${r.total} 次 / 去重 ${r.unique} 个`)
  for (const c of r.calls) console.log(`    ${c}`)
}

const worst = rows.slice().sort((a, b) => b.unique - a.unique)[0]
console.log(`\n请求最多的页面：${worst.label}（${worst.unique} 个去重请求）`)
await browser.close()
