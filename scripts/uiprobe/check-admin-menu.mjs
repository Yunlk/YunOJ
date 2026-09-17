// 诊断工具：实测导航栏「管理」下拉（.appbar-dropdown / .appbar-panel）的渲染结果。
// 用法：node scripts/uiprobe/check-admin-menu.mjs
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { ADMIN_USER, ADMIN_PASS } from './env.mjs'

const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const token = await getToken(ADMIN_USER, ADMIN_PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })

const probe = () =>
  page.evaluate(() => {
    const d = document.querySelector('.appbar-dropdown')
    const panel = d?.querySelector('.appbar-panel')
    const cs = panel ? getComputedStyle(panel) : null
    const r = panel?.getBoundingClientRect()
    const links = [...(panel?.querySelectorAll('a') ?? [])].slice(0, 4).map((a) => {
      const acs = getComputedStyle(a)
      const ar = a.getBoundingClientRect()
      return {
        text: a.textContent.trim(),
        cls: a.className || '(无类名)',
        display: acs.display,
        height: Math.round(ar.height),
        width: Math.round(ar.width),
      }
    })
    return {
      open: d?.hasAttribute('open') ?? null,
      panelPosition: cs?.position,
      panelDisplay: cs?.display,
      panelBg: cs?.backgroundColor,
      panelBorder: cs ? `${cs.borderTopWidth} ${cs.borderTopStyle}` : null,
      panelRect: r ? `${Math.round(r.width)}x${Math.round(r.height)} @${Math.round(r.x)},${Math.round(r.y)}` : null,
      panelClassList: panel?.className ?? null,
      links,
    }
  })

console.log('== 未展开 ==')
console.log(JSON.stringify(await probe(), null, 2))

const summary = page.locator('.appbar-dropdown > summary').first()
console.log('\nsummary 数量:', await page.locator('.appbar-dropdown > summary').count(), '文本:', (await summary.innerText()).trim())
await summary.click()
await page.waitForTimeout(400)
console.log('\n== 展开后 ==')
console.log(JSON.stringify(await probe(), null, 2))

const shot = 'D:/git/YunOJ/.tools/shot-admin-menu.png'
await page.screenshot({ path: shot })
console.log('\n截图:', shot)
await browser.close()
