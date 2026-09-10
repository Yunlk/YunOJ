// 导航壳与首页交互测试：Ctrl+K 快速跳转、/ 唤起、Esc 关闭、随机一题、进度卡数据一致。
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'demo01')
const PASS = argOf('pass', 'demo123')

const login = () => getToken(USER, PASS)
const token = await login()
const facets = await (await fetch(`${API}/problems/facets`, { headers: { Authorization: `Bearer ${token}` } })).json()

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`) })

console.log('\n== 顶部导航 ==')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
check('导航含刷题主线入口', (await page.locator('.appbar-nav > a').count()) >= 4)
check('导航有全局搜索入口', await page.locator('.appbar-search').isVisible())
check('搜索入口显示快捷键提示', (await page.locator('.appbar-search kbd').innerText()).includes('Ctrl'))

console.log('\n== Ctrl+K 快速跳转 ==')
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmdk', { timeout: 5000 })
check('Ctrl+K 打开命令面板', await page.locator('.cmdk').isVisible())
const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))
check('面板自动聚焦输入框', focused === '搜索题目或跳转', String(focused))
await page.keyboard.type('7')
await page.waitForTimeout(500)
const firstItem = await page.locator('.cmdk-item').first().innerText()
check('数字输入给出题号直达项', /P7|7/.test(firstItem), firstItem.replace(/\s+/g, ' '))
await page.keyboard.press('Enter')
await page.waitForTimeout(1200)
check('回车进入题目页', /\/problem\/7$/.test(page.url()), page.url())

console.log('\n== / 的分发规则与 Esc ==')
await page.goto(`${BASE}/problems`, { waitUntil: 'networkidle' })
await page.keyboard.press('/')
await page.waitForTimeout(400)
check(
  '题库页按 / 聚焦页面搜索框而非打开面板',
  (await page.locator('.cmdk').count()) === 0 &&
    (await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))) === '搜索题目',
)
await page.goto(`${BASE}/settings`, { waitUntil: 'networkidle' })
const hasPageSearch = (await page.locator('[data-search-shortcut]').count()) > 0
await page.keyboard.press('/')
await page.waitForTimeout(600)
const paletteOpen = (await page.locator('.cmdk').count()) > 0
check(
  hasPageSearch ? '有页面搜索框时 / 聚焦搜索框而不开面板' : '无页面搜索框时 / 打开命令面板',
  hasPageSearch ? !paletteOpen : paletteOpen,
)
if (paletteOpen) {
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('Esc 关闭面板', (await page.locator('.cmdk').count()) === 0)
}

console.log('\n== 标题搜索 ==')
await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
await page.keyboard.press('Control+k')
await page.waitForSelector('.cmdk')
await page.keyboard.type('A+B')
await page.waitForTimeout(900)
const items = await page.locator('.cmdk-item').count()
check('搜索标题命中题目', items > 0, `${items} 项`)
const label = await page.locator('.cmdk-item-label').first().innerText()
check('结果展示题号与标题', /P\d+/.test(label), label)
await page.keyboard.press('Escape')

console.log('\n== 首页：训练工作台 ==')
check('首屏有继续刷题卡', (await page.locator('.home-continue').count()) === 1)
const progressText = await page.locator('.home-side .progress-summary').innerText().catch(() => '')
check(
  '进度卡与 /problems/facets 一致',
  progressText.includes(String(facets.solved)) && progressText.includes(String(facets.total)),
  `${progressText.replace(/\s+/g, ' ')} vs API ${facets.solved}/${facets.total}`,
)
check('侧栏有难度进度条', (await page.locator('.home-side .difficulty-progress-row').count()) > 0)
check('比赛区渲染', (await page.locator('.home-main .section').count()) >= 1)

console.log('\n== 随机一题 ==')
await page.getByRole('button', { name: '随机一题' }).first().click()
await page.waitForTimeout(1500)
check('随机一题跳到题目页', /\/problem\/\d+/.test(page.url()), page.url())

console.log('\n== 全站排名 ==')
await page.goto(`${BASE}/ranking`, { waitUntil: 'networkidle' })
const meBar = await page.locator('.rank-me').innerText().catch(() => '')
check('显示「我的排名」条', meBar.length > 0, meBar.replace(/\s+/g, ' ').slice(0, 50))
check('我的排名条含名次与综合分', /(#\d+|未上榜)/.test(meBar) && /综合分/.test(meBar), meBar.replace(/\s+/g, ' ').slice(0, 60))
check('榜单每页 30 行', (await page.locator('.ranking-table tbody tr').count()) === 30)
check('前三名有奖牌样式', (await page.locator('.rank-medal').count()) === 3)
await page.fill('input[aria-label="搜索用户"]', 'rankdemo')
await page.keyboard.press('Enter')
await page.waitForTimeout(1000)
check('搜索写入 URL', page.url().includes('keyword=rankdemo'), page.url())
const filtered = await page.locator('.ranking-table tbody tr').count()
const summaryText = await page.locator('.table-summary').innerText()
check('搜索后结果被过滤', filtered > 0 && filtered < 30, `${filtered} 行 / ${summaryText.replace(/\s+/g, ' ')}`)
const keptRank = await page.locator('.ranking-table tbody tr').first().innerText()
check('过滤后保留全站名次', /\d+/.test(keptRank), keptRank.replace(/\s+/g, ' ').slice(0, 40))
await page.getByRole('button', { name: '清除搜索' }).click()
await page.waitForTimeout(900)
check('清除搜索后恢复完整榜单', (await page.locator('.ranking-table tbody tr').count()) === 30)

if (errors.length) console.log(`\n⚠ 错误: ${[...new Set(errors)].slice(0, 5).join(' | ')}`)
console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
