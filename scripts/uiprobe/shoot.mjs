// UI 侦察/验收工具：用系统安装的 Chrome 打开 YunOJ 并截图（不下载浏览器）。
//
// 用法：
//   node .tools/uiprobe/shoot.mjs                 # 默认用户名 demo01 截取公开+选手页面
//   node .tools/uiprobe/shoot.mjs --user e2eadmin --pass 'Yunoj#2026' --tag admin
//   node .tools/uiprobe/shoot.mjs --only /problems,/problem/437
//
// 产物：.tools/uiprobe/shots/<tag>-<序号>-<路由名>.png
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { mkdirSync, writeFileSync } from 'node:fs'
import { readFileSync, existsSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (name, dflt = '') => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 ? args[i + 1] : dflt
}
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'demo01')
const PASS = argOf('pass', 'demo123')
const TAG = argOf('tag', 'user')
const ONLY = argOf('only')
const OUT = new URL('./shots/', import.meta.url).pathname.replace(/^\//, '')
const WIDTH = Number(argOf('width', '1440'))
const HEIGHT = Number(argOf('height', '900'))

mkdirSync(OUT, { recursive: true })

// 最近一次 CF 验收比赛 + 一道题目，便于截取比赛相关页面
function latestContestId() {
  try {
    const s = JSON.parse(readFileSync(new URL('../cf-e2e-state.json', import.meta.url), 'utf8'))
    return s.contestId
  } catch {
    return 226
  }
}

const cid = latestContestId()
const ROUTES = [
  ['home', '/'],
  ['problems', '/problems'],
  ['problem-detail', '/problem/437'],
  ['contests', '/contests'],
  ['contest-detail', `/contest/${cid}`],
  ['contest-standings', `/contest/${cid}/standings`],
  ['contest-submissions', `/contest/${cid}/submissions`],
  ['status', '/status'],
  ['ranking', '/ranking'],
  ['profile', '/profile'],
  ['favorites', '/favorites'],
  ['settings', '/settings'],
  ['groups', '/groups'],
  ['notifications', '/notifications'],
  ['admin-problems', '/admin/problems'],
  ['admin-users', '/admin/users'],
  ['admin-judge', '/admin/judge'],
  ['problem-edit', '/problem/437/edit'],
  ['problem-tests', '/admin/problems/437/tests'],
  ['contest-new', '/contest/new'],
  ['submit-file', '/problem/437/submit-file'],
  ['notfound', '/definitely-not-a-route'],
]

async function login(username, password) {
  return getToken(username, password)
}

const token = await login(USER, PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 })
await context.addInitScript((t) => {
  localStorage.setItem('yunoj_token', t)
}, token)

const page = await context.newPage()
const errors = []
page.on('console', (m) => {
  if (m.type() === 'error') errors.push(`[console] ${m.text()}`)
})
page.on('pageerror', (e) => errors.push(`[pageerror] ${e.message}`))

const wanted = ONLY ? ONLY.split(',') : null
// 管理员专属路由：用学生账号截这些页面只会得到「无权限」，必须提示（否则很容易误判成渲染 bug）
const ADMIN_ROUTE = /^\/(admin\/|contest\/new|problem\/new|problem\/\d+\/edit|contest\/\d+\/(edit|messages|participants|problems))/
const isAdminUser = /admin/i.test(USER)
let i = 0
const report = []
for (const [name, route] of ROUTES) {
  if (wanted && !wanted.some((w) => route === w || name === w)) continue
  i += 1
  if (ADMIN_ROUTE.test(route) && !isAdminUser) {
    console.log(`   ⚠ ${route} 是管理员专属页面，当前账号 ${USER} 只会截到「无权限」；请加 --user e2eadmin --pass 'Yunoj#2026'`)
  }
  const url = `${BASE}${route}`
  const before = errors.length
  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
  } catch (e) {
    errors.push(`[goto ${route}] ${e.message}`)
  }
  await page.waitForTimeout(700)
  const file = `${OUT}${TAG}-${String(i).padStart(2, '0')}-${name}.png`
  await page.screenshot({ path: file, fullPage: true })
  const title = await page.title().catch(() => '')
  const h = await page.evaluate(() => document.body.scrollHeight).catch(() => 0)
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 40).replace(/\s+/g, ' ')).catch(() => '')
  report.push({ route, file: file.split('/').pop(), title, heightPx: h, newErrors: errors.length - before, preview: bodyText })
  const flag = errors.length - before > 0 ? `⚠ ${errors.length - before} 个前端错误` : (/无权限|无权访问/.test(bodyText) ? '⚠ 无权限（账号不对？）' : '')
  console.log(`${String(i).padStart(2, '0')} ${route.padEnd(36)} ${h}px  ${flag}`)
}

writeFileSync(`${OUT}${TAG}-report.json`, JSON.stringify({ user: USER, width: WIDTH, report, errors }, null, 2))
console.log(`\n截图 ${report.length} 张 → .tools/uiprobe/shots/`)
if (errors.length) {
  console.log('\n前端错误：')
  for (const e of errors.slice(0, 20)) console.log('  ' + e)
}
await browser.close()
