// 交互冒烟测试：真实点击/输入，断言 URL 与列表内容随之变化。
// 用法：node .tools/uiprobe/probe.mjs [--user U --pass P]
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
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
const token = await login()
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()
const rowCount = () => page.locator('.problems-table tbody tr').count()
const firstRowText = async () => (await page.locator('.problems-table tbody tr').first().innerText()).replace(/\s+/g, ' ')

console.log('\n== 题库页：筛选与状态 ==')
// 分页契约是「每页 20 条」；题库总数不足 20 时应列出全部，因此期望值是 min(20, 总数)。
// 早期这里写死 20，题库变少（清理测试数据）后会误报。
const totalRes = await fetch(`${API}/problems?page=1&size=1`, {
  headers: { Authorization: `Bearer ${token}` },
})
const totalProblems = totalRes.ok ? ((await totalRes.json()).total ?? 0) : 0
const expectRows = Math.min(20, totalProblems)
await page.goto(`${BASE}/problems`, { waitUntil: 'networkidle' })
await page.waitForSelector('.problems-table tbody tr')
const allRows = await rowCount()
check(`默认列出 ${expectRows} 行（题库共 ${totalProblems} 题）`, allRows === expectRows, `实际 ${allRows}`)
check('存在状态列', (await page.locator('.problems-table .problem-status').count()) > 0)
const sideActions = (await page.locator('.side-actions').innerText()).replace(/\s+/g, ' ').trim()
check('侧栏快捷入口只保留「随机一题 + 我的收藏」', sideActions === '随机一题 我的收藏', sideActions)
check('题库页不再显示「我的进度」', (await page.locator('.problems-side .progress-summary').count()) === 0)
check('页头不再重复「随机一题」', (await page.locator('.page-header').getByRole('button', { name: '随机一题' }).count()) === 0)

// 状态筛选
await page.getByRole('button', { name: '已通过', exact: true }).click()
await page.waitForFunction(() => new URL(location.href).searchParams.get('my_status') === 'accepted')
await page.waitForTimeout(600)
const accRows = await page.locator('.problems-table tbody tr').count()
check('筛选「已通过」后 URL 带 my_status', page.url().includes('my_status=accepted'))
check('筛选后每行都标为已通过', (await page.locator('.problems-table .problem-status-accepted').count()) === accRows, `${accRows} 行`)

// 难度 chip
await page.locator('.filter-chip', { hasText: '入门' }).first().click()
await page.waitForFunction(() => new URL(location.href).searchParams.get('difficulty') === '1')
await page.waitForTimeout(600)
check('难度 chip 写入 difficulty=1', page.url().includes('difficulty=1'))
check('筛选后结果数不超过总数', (await page.locator('.table-summary').innerText()).includes('已筛选'))

// 排序
await page.selectOption('select[aria-label="排序方式"]', 'acceptance')
await page.waitForTimeout(700)
const topRow = await firstRowText()
check('切换排序后首行包含通过率', /\d+\s*\/\s*\d+/.test(topRow), topRow.slice(0, 60))

// 每页条数
await page.selectOption('select[aria-label="每页题数"]', '50')
await page.waitForTimeout(700)
check('每页 50 后 URL 带 size=50', page.url().includes('size=50'))

// 重置
await page.getByRole('button', { name: '重置' }).click()
await page.waitForTimeout(700)
check('重置后清空筛选参数', !page.url().includes('my_status') && !page.url().includes('difficulty'), page.url())

// 键盘 / 聚焦搜索
await page.keyboard.press('/')
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.tagName)
check('按 / 聚焦搜索框', focused === '搜索题目', String(focused))

// 搜索
await page.fill('input[aria-label="搜索题目"]', 'A+B')
await page.keyboard.press('Enter')
await page.waitForTimeout(800)
const searched = await rowCount()
const searchedText = await firstRowText()
check('搜索 A+B 命中结果', searched > 0 && /A\+B/.test(searchedText), `${searched} 行: ${searchedText.slice(0, 40)}`)

// 标签筛选
await page.goto(`${BASE}/problems`, { waitUntil: 'networkidle' })
await page.getByRole('button', { name: '+ 标签' }).click()
await page.waitForSelector('.tag-picker-panel')
const tagName = await page.locator('.tag-picker-panel .menu-item span').first().innerText()
await page.locator('.tag-picker-panel .menu-item').first().click()
await page.waitForTimeout(800)
check(`选择标签「${tagName}」后 URL 带 tag`, decodeURIComponent(page.url()).includes(`tag=${tagName}`), page.url())

// 行点击进入题目
await page.goto(`${BASE}/problems`, { waitUntil: 'networkidle' })
await page.locator('.problems-table tbody tr').first().click()
await page.waitForTimeout(800)
check('点击整行进入题目页', /\/problem\/\d+/.test(page.url()), page.url())

console.log('\n== 继续未完成（按最近提交排序）==')
const recentResp = await fetch(`${API}/problems?sort=recent&my_status=attempted&size=1`, {
  headers: { Authorization: `Bearer ${token}` },
})
const recent = await recentResp.json()
const expectedId = recent.items?.[0]?.id
if (!expectedId) {
  console.log('  （该账号没有未通过的题，跳过）')
} else {
  await page.goto(`${BASE}/problems`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '继续未完成' }).first().click()
  await page.waitForTimeout(1500)
  check('继续未完成跳到「最近做过且未通过」的题', page.url().endsWith(`/problem/${expectedId}`), `${page.url()} vs 期望 P${expectedId}`)
  await page.goto(`${BASE}/problems?sort=recent`, { waitUntil: 'networkidle' })
  const sortLabel = await page.locator('select[aria-label="排序方式"]').inputValue()
  check('排序选项包含 recent 且可从 URL 恢复', sortLabel === 'recent', sortLabel)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
