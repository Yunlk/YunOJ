// 单页诊断：打开一个路由，打印可见文本、控制台错误与失败请求，用于快速定位「页面空白」类问题。
// 用法：node .tools/uiprobe/peek.mjs /problems [--user demo05 --pass demo123] [--selector .foo]
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const route = args.find((a) => a.startsWith('/')) ?? '/'
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const USER = argOf('user', 'demo05')
const PASS = argOf('pass', 'demo123')
const SELECTOR = argOf('selector')

const token = await getToken(USER, PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()
const logs = []
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`))
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}\n${e.stack?.split('\n').slice(0, 3).join('\n') ?? ''}`))
page.on('response', (r) => {
  if (r.status() >= 400) logs.push(`[http ${r.status()}] ${r.url()}`)
})

await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => logs.push(`[goto] ${e.message}`))
await page.waitForTimeout(1200)

const text = (await page.locator('body').innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 600)
console.log(`\n路由 ${route}`)
console.log(`可见文本: ${text || '(空)'}`)
if (SELECTOR) {
  const count = await page.locator(SELECTOR).count()
  console.log(`选择器 ${SELECTOR}: ${count} 个`)
  if (count > 0) console.log(`首个文本: ${(await page.locator(SELECTOR).first().innerText()).replace(/\s+/g, ' ').slice(0, 120)}`)
}
console.log(`\n控制台/网络（${logs.length} 条）:`)
for (const l of logs.slice(0, 25)) console.log('  ' + l.split('\n')[0])
await browser.close()
