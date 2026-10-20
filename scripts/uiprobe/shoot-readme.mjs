// 生成 README 用的产品截图：docs/screenshots/*.png
// 只读操作，不改库；每张图都会断言页面有实际内容（表行/元素），避免拍出空状态。
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { STUDENT_USER, STUDENT_PASS, requireAdminCreds } from './env.mjs'

const BASE = 'http://127.0.0.1:5173'
const OUT = process.argv[2] ?? 'docs/screenshots'

const admin = requireAdminCreds()
const adminToken = await getToken(admin.user, admin.pass)
const studentToken = await getToken(STUDENT_USER, STUDENT_PASS)

await mkdir(OUT, { recursive: true })

/**
 * 每张图：名字、路由、身份、可选的前置操作、可选的内容断言。
 * content: 返回页面上「应该存在的元素数量」，用来确认不是空页面。
 */
const shots = [
  { name: '01-home', path: '/', as: 'student', content: '.side-card, .card, .panel' },
  { name: '02-problems', path: '/problems', as: 'student', content: '.data-table tbody tr' },
  {
    name: '03-problem-workbench',
    path: '/problem/645',
    as: 'student',
    wait: 2500,
    content: '.monaco-editor',
  },
  { name: '04-contests', path: '/contests', as: 'student', content: '.data-table tbody tr, .contest-row, a[href^="/contest/"]' },
  {
    name: '05-contest-problem',
    path: '/contest/409/problem/645',
    as: 'student',
    wait: 2500,
    content: '.monaco-editor, .attachment-list',
  },
  { name: '06-standings', path: '/contest/186/standings', as: 'student', wait: 2000, content: '.data-table tbody tr, .board-row' },
  { name: '07-status', path: '/status', as: 'student', content: '.data-table tbody tr' },
  { name: '08-ranking', path: '/ranking', as: 'student', content: '.data-table tbody tr' },
  { name: '09-profile', path: '/profile', as: 'student', wait: 2000, content: '.card, .panel, .side-card' },
  {
    name: '10-problem-harness',
    path: '/problem/645/edit?tab=settings',
    as: 'admin',
    wait: 1500,
    content: '.harness-fieldset',
  },
  { name: '11-admin-judge', path: '/admin/judge', as: 'admin', wait: 1500, content: '.data-table tbody tr, .judge-status-grid' },
  { name: '12-demo-ui', path: '/demo/ui', as: 'admin', wait: 1200, content: '.card' },
]

const browser = await chromium.launch({ channel: 'chrome' })
let fail = 0
for (const s of shots) {
  const token = s.as === 'admin' ? adminToken : studentToken
  const ctx = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'zh-CN',
  })
  await ctx.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
  const page = await ctx.newPage()
  const errs = []
  page.on('pageerror', (e) => errs.push(e.message))
  page.on('response', (r) => {
    if (r.status() >= 500) errs.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
  })

  const res = await page.goto(`${BASE}${s.path}`, { waitUntil: 'networkidle', timeout: 45000 }).catch(() => null)
  await page.waitForTimeout(s.wait ?? 1000)

  const count = s.content ? await page.locator(s.content).count() : 1
  const file = `${OUT}/${s.name}.png`
  await page.screenshot({ path: file })

  const ok = res && res.status() < 400 && errs.length === 0 && count > 0
  if (!ok) fail++
  console.log(
    `${ok ? 'OK  ' : 'BAD '} ${s.name.padEnd(22)} [${res?.status()}] 元素=${count} ${errs.length ? 'errs=' + [...new Set(errs)].slice(0, 2).join('|') : ''}`,
  )
  await ctx.close()
}
await browser.close()
console.log(fail === 0 ? `\n全部截图完成 → ${OUT}` : `\n${fail} 张有问题`)
