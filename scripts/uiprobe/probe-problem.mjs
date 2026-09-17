// 单题工作台交互测试：标签页、样例运行、自测抽屉、上一题/下一题、提交后跳转。
// 用法：node scripts/uiprobe/probe-problem.mjs [--user U --pass P]
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'demo01')
const PASS = argOf('pass', 'demo123')

const login = () => getToken(USER, PASS)

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), await login())
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`) })

console.log('\n== 单题页：默认工作台 ==')
await page.goto(`${BASE}/problem/1`, { waitUntil: 'networkidle' })
await page.waitForSelector('.wb-shell')

check('默认即是工作台（题面 + 编辑器同屏）', await page.locator('.wb-left').isVisible() && await page.locator('.wb-right').isVisible())
check('不再有「进入 IDE 模式」按钮', (await page.getByText('进入 IDE 模式').count()) === 0)
check('左侧存在三个标签（题目/题解/讨论）', (await page.locator('.wb-tabs .tab').count()) === 3)
check('「我的提交」不再占用左栏标签', (await page.getByRole('tab', { name: '我的提交' }).count()) === 0)
check('编辑器已挂载', (await page.locator('.monaco-editor').count()) > 0)

const leftVisible = await page.locator('.wb-left').isVisible()
const rightVisible = await page.locator('.wb-right').isVisible()
check('左右分栏同时可见', leftVisible && rightVisible)

console.log('\n== 分栏拖拽 ==')
const before = await page.locator('.wb-left').boundingBox()
const divider = await page.locator('.wb-divider').boundingBox()
await page.mouse.move(divider.x + 3, divider.y + 100)
await page.mouse.down()
await page.mouse.move(divider.x + 200, divider.y + 100, { steps: 8 })
await page.mouse.up()
await page.waitForTimeout(300)
const after = await page.locator('.wb-left').boundingBox()
check('拖拽分隔条改变左栏宽度', after.width > before.width + 60, `${Math.round(before.width)} → ${Math.round(after.width)}`)
const stored = await page.evaluate(() => localStorage.getItem('yunoj:workbench:split'))
check('分栏比例写入本地记忆', stored !== null && Number(stored) > 0.4, String(stored))

console.log('\n== 标签页切换（左栏） ==')
await page.getByRole('tab', { name: '题解' }).click()
await page.waitForTimeout(500)
check('切到「题解」渲染题解区', (await page.locator('.wb-editorial, .empty-state').count()) > 0)
await page.getByRole('tab', { name: '讨论' }).click()
await page.waitForTimeout(300)
check('讨论页有发布表单', (await page.locator('.discussion-form textarea').count()) === 1)
await page.getByRole('tab', { name: '题目', exact: true }).click()
await page.waitForTimeout(300)
check('切回题目显示题面', (await page.locator('.wb-statement').count()) === 1)

console.log('\n== 右栏：编辑器 ↔ 评测结果 ==')
check('初始右栏是编辑器', await page.locator('.wb-right .monaco-editor').isVisible())
await page.getByRole('button', { name: '我的提交' }).click()
await page.waitForTimeout(900)
check('点「我的提交」右栏换成提交面板', await page.locator('.wb-right .submission-panel').isVisible().catch(() => false))
check('切换后左栏题面仍在', (await page.locator('.wb-left .wb-statement').count()) === 1)
check('按钮变为「返回代码」', (await page.getByRole('button', { name: '返回代码' }).count()) === 1)
await page.getByRole('button', { name: '返回代码' }).click()
await page.waitForTimeout(500)
check('点「返回代码」右栏回到编辑器', await page.locator('.wb-right .monaco-editor').isVisible().catch(() => false))

console.log('\n== 样例运行 → 自测抽屉 ==')
// 先写代码：空代码点运行也必须给出可见反馈（回归用例）
await page.locator('.wb-editor-body').click()
await page.keyboard.press('Control+A')
await page.keyboard.type('#include <iostream>\nint main(){long long a,b;std::cin>>a>>b;std::cout<<a+b<<"\\n";}')
await page.waitForTimeout(500)

const sampleRun = page.locator('.sample-panel-actions button', { hasText: '运行' }).first()
check('题面样例带「运行」按钮', (await sampleRun.count()) > 0)
await sampleRun.click()
await page.waitForSelector('.wb-drawer.open', { timeout: 20000 })
check('点击样例后自测抽屉自动展开', await page.locator('.wb-drawer.open').isVisible())
const sampleInput = await page.locator('.wb-drawer-input').inputValue()
check('样例输入自动回填到自测框', sampleInput.trim().length > 0, JSON.stringify(sampleInput.slice(0, 30)))
await page.waitForFunction(() => {
  const el = document.querySelector('.wb-drawer-verdict')
  return el && !/运行中/.test(el.textContent ?? '')
}, { timeout: 60000 }).catch(() => {})
const verdict = await page.locator('.wb-drawer-verdict').innerText().catch(() => '')
check('自测结果给出结论', verdict.length > 0, verdict)
const out = await page.locator('.wb-drawer-output').innerText().catch(() => '')
check('自测输出区有内容', out.trim().length > 0, out.slice(0, 40))

console.log('\n== 上一题 / 下一题 ==')
const nextDisabled = await page.getByRole('button', { name: /下一题/ }).isDisabled()
check('题号 1 时下一题可用', !nextDisabled)
await page.getByRole('button', { name: /下一题/ }).click()
await page.waitForTimeout(1200)
check('点击下一题切换题目', /\/problem\/\d+/.test(page.url()) && !page.url().endsWith('/problem/1'), page.url())
const titleAfter = await page.locator('.wb-title').innerText()
check('切换后标题更新', titleAfter.length > 0, titleAfter)
await page.getByRole('button', { name: /上一题/ }).click()
await page.waitForTimeout(1200)
check('点击上一题回到原题', page.url().endsWith('/problem/1'), page.url())

console.log('\n== 提交与结果（结果落在右栏） ==')
await page.getByRole('button', { name: '提交', exact: true }).click()
await page.waitForTimeout(2500)
const submitted = await page.locator('.wb-notice.success-message').innerText().catch(() => '')
check('提交后提示提交号', /#\d+/.test(submitted), submitted.trim())
check('提交提示留在右栏（不随编辑器卸载而消失）', (await page.locator('.wb-right .wb-notice.success-message').count()) === 1)
check('提交后左栏仍是题面标签', (await page.locator('.wb-tabs .tab.active').innerText().catch(() => '')).includes('题目'))
check('提交后左栏题面未被替换', (await page.locator('.wb-left .wb-statement').count()) === 1)
check('提交后右栏显示评测面板', await page.locator('.wb-right .submission-panel').isVisible().catch(() => false))
check('右上角按钮变为「返回代码」', (await page.getByRole('button', { name: '返回代码' }).count()) === 1)

console.log('\n== 窄屏（900px）：单栏标签模式 ==')
const narrow = await context.newPage()
await narrow.setViewportSize({ width: 900, height: 800 })
await narrow.goto(`${BASE}/problem/1`, { waitUntil: 'networkidle' })
await narrow.waitForSelector('.wb-shell')
check('窄屏启用单栏模式', (await narrow.locator('.wb-narrow').count()) === 1)
check('窄屏出现「题目/代码」切换', (await narrow.locator('.wb-narrow-tabs .tab').count()) === 2)
check('默认只显示题面栏', (await narrow.locator('.wb-left').isVisible()) && !(await narrow.locator('.wb-right').isVisible()))
check('窄屏无分隔条（不可拖拽）', (await narrow.locator('.wb-divider').count()) === 0)
await narrow.getByRole('tab', { name: '代码' }).click()
await narrow.waitForTimeout(400)
check('切到代码栏后编辑器可见', await narrow.locator('.wb-right').isVisible())
const narrowOverflow = await narrow.evaluate(() => {
  const de = document.documentElement
  return Math.max(de.scrollWidth, document.body.scrollWidth) - de.clientWidth
})
check('窄屏无横向溢出', narrowOverflow <= 2, `${narrowOverflow}px`)
await narrow.close()

if (errors.length) console.log(`\n⚠ 请求/脚本错误: ${[...new Set(errors)].slice(0, 5).join(' | ')}`)
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
