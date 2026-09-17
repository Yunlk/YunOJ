// 对比度审计：找出前景/背景对比度低于 WCAG AA 的可见文字。
// 用法：node .tools/uiprobe/contrast.mjs [--only /a,/b] [--user demo05 --pass demo123] [--min 4.5]
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const USER = argOf('user', 'demo05')
const PASS = argOf('pass', 'demo123')
const ONLY = argOf('only')
const MIN = Number(argOf('min', '4.5'))

const ROUTES = [
  ['首页', '/'],
  ['题库', '/problems'],
  ['单题', '/problem/437'],
  ['提交记录', '/status'],
  ['比赛列表', '/contests'],
  ['比赛详情', '/contest/226'],
  ['比赛榜单', '/contest/226/standings'],
  ['排名', '/ranking'],
  ['个人中心', '/profile'],
  ['收藏', '/favorites'],
  ['通知', '/notifications'],
  ['设置', '/settings'],
  ['题目设置', '/problem/437/edit?tab=settings'],
]

const token = await getToken(USER, PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()

const wanted = ONLY ? ONLY.split(',') : null
let worst = []
for (const [label, route] of ROUTES) {
  if (wanted && !wanted.some((w) => route === w || label === w)) continue
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)

  const bad = await page.evaluate((minRatio) => {
    const parse = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/)
      if (!m) return null
      const parts = m[1].split(',').map((v) => parseFloat(v.trim()))
      return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 }
    }
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        const s = v / 255
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
      }
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b)
    }
    const ratio = (a, b) => {
      const l1 = lum(a)
      const l2 = lum(b)
      return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)
    }
    const bgOf = (el) => {
      let node = el
      while (node && node !== document.documentElement) {
        const cs = getComputedStyle(node)
        const bg = parse(cs.backgroundColor)
        if (bg && bg.a > 0.5) return bg
        node = node.parentElement
      }
      return { r: 255, g: 255, b: 255, a: 1 }
    }
    const out = []
    const seen = new Set()
    for (const el of document.querySelectorAll('body *')) {
      if (el.closest('.monaco-editor') || /(^|\s)monaco-/.test((el.className || '').toString())) continue
      // 视觉隐藏文本（屏幕阅读器专用）不参与对比度判定
      if (el.closest('.visually-hidden') || /(^|\s)visually-hidden(\s|$)/.test((el.className || '').toString())) continue
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 1)
      if (!own) continue
      const rect = el.getBoundingClientRect()
      if (rect.width === 0 || rect.height === 0) continue
      const cs = getComputedStyle(el)
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue
      const fg = parse(cs.color)
      if (!fg) continue
      const r = ratio(fg, bgOf(el))
      const size = parseFloat(cs.fontSize)
      const bold = parseInt(cs.fontWeight, 10) >= 700
      const large = size >= 24 || (size >= 18.66 && bold)
      const need = large ? Math.max(3, minRatio - 1.5) : minRatio
      if (r < need) {
        const key = `${cs.color}|${Math.round(size)}|${el.className}`
        if (seen.has(key)) continue
        seen.add(key)
        out.push({
          text: el.textContent.trim().slice(0, 28),
          ratio: Math.round(r * 100) / 100,
          color: cs.color,
          size: Math.round(size),
          need: Math.round(need * 10) / 10,
          cls: (el.className || '').toString().split(' ').slice(0, 2).join('.'),
        })
      }
    }
    return out
  }, MIN)

  if (bad.length === 0) {
    console.log(`✓ ${label}  ${route}  无低对比度文字`)
  } else {
    console.log(`⚠ ${label}  ${route}  ${bad.length} 处低于 AA`)
    for (const b of bad.slice(0, 6)) {
      console.log(`    ${b.ratio} (需 ${b.need})  ${b.size}px  ${b.color}  .${b.cls}  「${b.text}」`)
    }
    worst = worst.concat(bad.map((b) => ({ ...b, route })))
  }
}

console.log(`\n合计低于 AA 的文字：${worst.length} 处`)
await browser.close()
