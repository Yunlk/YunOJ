// UI 布局与可访问性审计：用系统 Chrome 打开每个路由，输出可读的文本指标。
//
// 用法：node .tools/uiprobe/audit.mjs [--user U --pass P] [--only /problems,/status] [--verbose]
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { readFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'e2eadmin')
const PASS = argOf('pass', 'Yunoj#2026')
const ONLY = argOf('only')
const VERBOSE = args.includes('--verbose')
const WIDTH = Number(argOf('width', '1440'))
const HEIGHT = Number(argOf('height', '900'))

let cid = 226
try {
  cid = JSON.parse(readFileSync(new URL('../cf-e2e-state.json', import.meta.url), 'utf8')).contestId
} catch {}

const ROUTES = [
  ['首页', '/'],
  ['题库', '/problems'],
  ['单题(普通)', '/problem/437'],
  ['提交记录', '/status'],
  ['提交详情', '/submission/2686'],
  ['比赛列表', '/contests'],
  ['比赛详情', `/contest/${cid}`],
  ['比赛榜单', `/contest/${cid}/standings`],
  ['比赛提交', `/contest/${cid}/submissions`],
  ['比赛题目页', `/contest/${cid}/problem/437`],
  ['文件提交', '/problem/437/submit-file'],
  ['滚榜演示', '/demo/rolling'],
  ['教学空间', '/groups'],
  ['404', '/no-such-route'],
  ['排名', '/ranking'],
  ['个人中心', '/profile'],
  ['收藏', '/favorites'],
  ['设置', '/settings'],
  ['通知', '/notifications'],
  ['管理·题目', '/admin/problems'],
  ['管理·用户', '/admin/users'],
  ['管理·评测', '/admin/judge'],
  ['管理·通知', '/admin/notifications'],
  ['题目编辑', '/problem/437/edit'],
  ['题目新建', '/problem/new'],
  ['测试点', '/admin/problems/437/tests'],
  ['新建比赛', '/contest/new'],
  ['比赛设置', `/contest/${cid}/edit`],
  ['赛题管理', `/contest/${cid}/problems`],
  ['比赛消息', `/contest/${cid}/messages`],
  ['参赛者', `/contest/${cid}/participants`],
  ['比赛报名', `/contest/${cid}/register`],
  ['小组详情', '/groups/1'],
  ['登录', '/login'],
  ['注册', '/register'],
]

const login = () => getToken(USER, PASS)

const token = await login()
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()

const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push(e.message))
// 记录真正失败的网络请求（前端错误大多是它引起的）
page.on('response', (r) => {
  if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
})

const wanted = ONLY ? ONLY.split(',') : null
for (const [label, route] of ROUTES) {
  if (wanted && !wanted.some((w) => route === w || label === w)) continue
  errors.length = 0
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => errors.push(e.message))
  await page.waitForTimeout(600)

  const m = await page.evaluate((foldHeight) => {
    const de = document.documentElement
    const scrollW = Math.max(de.scrollWidth, document.body.scrollWidth)
    const overflowers = []
    // 若某个祖先负责滚动（overflow-x: auto/scroll），元素超出视口属预期行为，
    // 只有「没有任何滚动容器兜住」的越界才是真缺陷。
    const inScrollContainer = (el) => {
      let node = el.parentElement
      while (node && node !== document.body) {
        const cs = getComputedStyle(node)
        if (/(auto|scroll)/.test(cs.overflowX)) return true
        node = node.parentElement
      }
      return false
    }
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect()
      if (r.width === 0) continue
      // Monaco 内部是虚拟化大画布与离屏无障碍容器，不参与溢出与可访问性判定
      if (el.closest('.monaco-editor') || /(^|\s)monaco-/.test((el.className || '').toString())) continue
      if (r.right > de.clientWidth + 2 || r.left < -2) {
        const cs = getComputedStyle(el)
        if (cs.position === 'fixed') continue
        if (inScrollContainer(el)) continue
        overflowers.push(`${el.tagName.toLowerCase()}.${(el.className || '').toString().split(' ')[0]} right=${Math.round(r.right)}`)
      }
      if (overflowers.length > 5) break
    }
    const headings = [...document.querySelectorAll('h1,h2,h3')]
      .slice(0, 12)
      .map((h) => `${h.tagName} ${h.textContent.trim().slice(0, 48)}`)
    const interactive = document.querySelectorAll('a,button,input,select,textarea,[role="button"]').length
    const table = document.querySelector('.data-table')
    const rowH = table?.querySelector('tbody td')?.getBoundingClientRect().height ?? 0
    const headH = table?.querySelector('thead th')?.getBoundingClientRect().height ?? 0
    const rows = table?.querySelectorAll('tbody tr').length ?? 0
    const bodyFont = getComputedStyle(document.body).fontSize
    const title = document.querySelector('.page-title, .home-command-bar h1, h1')?.textContent?.trim().slice(0, 60) ?? ''
    // 首屏（视口高度内）可见的正文文本，按 DOM 顺序
    const foldText = []
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    let node
    while ((node = walker.nextNode())) {
      const t = node.textContent.trim()
      if (!t) continue
      const el = node.parentElement
      if (!el || el.closest('.navbar')) continue
      const r = el.getBoundingClientRect()
      if (r.height === 0 || r.bottom < 0 || r.top > foldHeight) continue
      foldText.push(t.replace(/\s+/g, ' ').slice(0, 70))
      if (foldText.length > 40) break
    }
    // 可访问性快查
    const a11y = []
    for (const b of document.querySelectorAll('button')) {
      const name = (b.textContent || '').trim() || b.getAttribute('aria-label') || ''
      if (!name) a11y.push(`无名按钮 .${(b.className || '').toString().split(' ')[0]}`)
    }
    for (const i of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
      if (i.closest('.monaco-editor')) continue
      const id = i.id
      const hasLabel = (id && document.querySelector(`label[for="${id}"]`)) || i.getAttribute('aria-label') || i.closest('label')
      if (!hasLabel) a11y.push(`无标签控件 ${i.tagName.toLowerCase()}[${i.getAttribute('type') ?? ''}]`)
    }
    return {
      scrollW, clientW: de.clientWidth, pageH: document.body.scrollHeight, overflowers,
      headings, interactive, rowH: Math.round(rowH), headH: Math.round(headH), rows, bodyFont, title,
      foldText, a11y: a11y.slice(0, 6),
    }
  }, HEIGHT)

  const overflow = m.scrollW > m.clientW + 2
  console.log(`\n━━ ${label}  ${route}`)
  console.log(`   标题: ${m.title || '(无)'}  |  页高 ${m.pageH}px  正文 ${m.bodyFont}  |  可交互元素 ${m.interactive}`)
  console.log(`   表格: ${m.rows} 行, 行高 ${m.rowH}px, 表头 ${m.headH}px${overflow ? `  ⚠ 横向溢出 ${m.scrollW}>${m.clientW}` : ''}`)
  if (m.overflowers.length) console.log(`   ⚠ 溢出元素: ${m.overflowers.slice(0, 4).join(' ; ')}`)
  if (m.a11y.length) console.log(`   ⚠ 可访问性: ${m.a11y.join(' ; ')}`)
  if (errors.length) console.log(`   ⚠ 前端错误: ${[...new Set(errors)].slice(0, 3).join(' | ')}`)
  if (VERBOSE) {
    console.log(`   标题结构: ${m.headings.join(' / ')}`)
    console.log(`   首屏文本: ${m.foldText.join(' · ')}`)
  }
}

await browser.close()
