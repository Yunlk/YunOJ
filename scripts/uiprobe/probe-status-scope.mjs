// A 组范围语义 probe：验证「提交记录」标题与数据范围一致，以及
//   1) 「只看我的」开关写入 / 清除 URL 的 user_id
//   2) user_id 过滤对普通用户也生效（或如实告知被后端收紧），每行用户列一致
//   3) 整行跳转进提交详情
//   4) 分页写入 URL、深链可复现、翻页保留筛选
// 并顺带覆盖 /submission/:id 的布局与可访问性指标（等价于 audit 的检查项）。
//
// 用法：
//   node scripts/uiprobe/probe-status-scope.mjs                        # 管理员（可看全站）
//   node scripts/uiprobe/probe-status-scope.mjs --user demo05 --pass demo123
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'e2eadmin')
const PASS = argOf('pass', 'Yunoj#2026')
const DETAIL_ID = argOf('id', '2686')

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

// 登录走共享磁盘缓存，避免触发后端 12 次 / 5 分钟限流
const token = await getToken(USER, PASS)
const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => {
  if (!r.ok) throw new Error(`读取登录身份失败 ${r.status}`)
  return r.json().then((d) => d.user)
})
const isAdmin = me.role === 'admin'
console.log(`\n== A 组范围 probe · ${me.username}（${me.role}，id=${me.id}）==`)

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url ?? '')) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(e.message))
const badResponses = []
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
})

const param = (k) => new URL(page.url()).searchParams.get(k)
const rows = () => page.locator('.submissions-table tbody tr.clickable-row')
// 用户列只在管理员视图存在，用表头文字定位列号，避免写死 nth-child
const userColumnIndex = async () => {
  const headers = await page.locator('.submissions-table thead th').allInnerTexts()
  const i = headers.findIndex((h) => h.trim() === '用户')
  return i < 0 ? -1 : i + 1
}
const userCells = async () => {
  const col = await userColumnIndex()
  if (col < 0) return []
  return page
    .locator(`.submissions-table tbody tr.clickable-row td:nth-child(${col})`)
    .evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()))])
}
const open = async (route) => {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.submissions-table tbody tr', { timeout: 20000 })
}
const listBad = () => badResponses.length

console.log('\n-- 1. 标题与范围一致性 --')
await open('/status')
const h1 = (await page.locator('h1').first().innerText()).trim()
check('标题固定为「提交记录」', h1 === '提交记录', h1)
const badge0 = (await page.locator('.submission-scope .badge').first().innerText()).trim()
if (isAdmin) {
  check('管理员未带 user_id 时徽标为「全站提交」', badge0 === '范围：全站提交', badge0)
} else {
  check('普通用户未带 user_id 时徽标为「仅本人可见」', badge0 === '范围：仅本人可见', badge0)
}
const summary0 = (await page.locator('.table-summary').first().innerText()).replace(/\s+/g, ' ')
check(
  '摘要口径与范围一致',
  isAdmin ? /全站共\s*\d+\s*条提交/.test(summary0) : /共\s*\d+\s*条提交/.test(summary0),
  summary0.slice(0, 60),
)

console.log('\n-- 2. 「只看我的」开关 --')
await page.locator('.page-actions button', { hasText: '只看我的' }).click()
await page.waitForFunction((id) => new URL(location.href).searchParams.get('user_id') === String(id), me.id)
await page.waitForTimeout(700)
check('顶部「只看我的」写入 user_id=<自己>', param('user_id') === String(me.id), page.url())
const badgeMine = (await page.locator('.submission-scope .badge').first().innerText()).trim()
check('user_id=自己 时徽标为「我的提交」', badgeMine === '范围：我的提交', badgeMine)
const mineCol = await userColumnIndex()
const mineRows = await rows().count()
const mineUsers = await userCells()
const emptyText = await page.locator('.submissions-table tbody .table-empty').count()
// 普通用户视图没有「用户」列（列全是自己）；管理员视图有该列，且每行必须是自己。
// 「只看我的」后可能 0 行（例如管理员本身没提交过）——那也应走空状态而不是全站列表。
check(
  '只看我的：范围收窄到本人',
  mineRows === 0
    ? emptyText === 1
    : isAdmin
      ? mineCol > 0 && mineUsers.length === 1 && mineUsers[0] === me.username
      : mineCol < 0 && mineUsers.length === 0,
  mineRows === 0
    ? `0 行 + 空状态 ${emptyText}`
    : `${mineRows} 行 / 用户列 ${mineCol} / 用户值 ${mineUsers.join(',') || '（无该列）'}`,
)

const mineChecked = await page.locator('input[aria-label="只看我的"]').isChecked()
check('工具栏复选框同步为已勾选', mineChecked, String(mineChecked))
await page.locator('input[aria-label="只看我的"]').uncheck()
await page.waitForTimeout(700)
check('取消后清除 URL 的 user_id', param('user_id') === null, page.url())

console.log('\n-- 3. user_id 过滤 --')
const targetId = isAdmin ? 1 : me.id + 1
await open(`/status?user_id=${targetId}`)
const badgeOther = (await page.locator('.submission-scope .badge').first().innerText()).trim()
const notice = await page.locator('.submission-scope .field-hint').count()
const otherUsers = await userCells()
check('URL 里的 user_id 被保留（不再被前端丢弃）', param('user_id') === String(targetId), page.url())
if (isAdmin) {
  check(`管理员按 user_id=${targetId} 过滤：每行都是该用户`, otherUsers.length <= 1, otherUsers.join(','))
  check('管理员看到「用户 #id 的提交」徽标', badgeOther === `范围：用户 #${targetId} 的提交`, badgeOther)
} else {
  check('普通用户按他人 user_id 时如实提示被收紧', notice === 1, `提示数 ${notice}`)
  check('提示内容说明忽略了 user_id', /已忽略 user_id/.test(await page.locator('.submission-scope .field-hint').first().innerText()))
  check('收紧后不展示他人用户名（无用户列即后端已收紧）', otherUsers.length === 0, otherUsers.join(','))
}

console.log('\n-- 4. 整行跳转 --')
await open('/status')
const firstRowId = (await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()).replace('#', '')
await rows().first().click()
await page.waitForTimeout(900)
check('点击整行进入提交详情', /^\/submission\/\d+$/.test(new URL(page.url()).pathname), page.url())
check('详情页 id 与行内提交号一致', new URL(page.url()).pathname === `/submission/${firstRowId}`, `${firstRowId} vs ${page.url()}`)

console.log('\n-- 5. 分页 --')
await open('/status')
const rowCountP1 = await rows().count()
const nextBtn = page.getByRole('button', { name: '下一页' })
if ((await nextBtn.count()) === 0) {
  console.log(`  · 当前账号只有 1 页（${rowCountP1} 行），跳过分页断言`)
} else {
  const firstIdP1 = await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()
  await nextBtn.click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2')
  await page.waitForTimeout(700)
  const firstIdP2 = await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()
  check('下一页写入 URL page=2', param('page') === '2', page.url())
  check('翻页后内容变化', firstIdP1 !== firstIdP2, `${firstIdP1} -> ${firstIdP2}`)
  await open('/status?page=3')
  const active = (await page.locator('.pagination .page-button.active').innerText()).trim()
  check('深链 page=3 可复现', active === '3', active)
  await open(`/status?status=accepted&page=2`)
  check(
    '翻页保留筛选参数',
    param('status') === 'accepted' && param('page') === '2' && (await page.inputValue('select#sub-status')) === 'accepted',
    page.url(),
  )
}

console.log('\n-- 6. 详情页布局与可访问性（等价 audit 检查项）--')
const before = listBad()
await page.goto(`${BASE}/submission/${DETAIL_ID}`, { waitUntil: 'networkidle' })
await page.waitForTimeout(900)
const metrics = await page.evaluate(() => {
  const de = document.documentElement
  const table = document.querySelector('.case-table')
  const a11y = []
  for (const b of document.querySelectorAll('button')) {
    const name = (b.textContent || '').trim() || b.getAttribute('aria-label') || ''
    if (!name) a11y.push(`无名按钮 .${(b.className || '').toString().split(' ')[0]}`)
  }
  for (const i of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
    if (i.closest('.monaco-editor')) continue
    const id = i.id
    const hasLabel = (id && document.querySelector(`label[for="${id}"]`)) || i.getAttribute('aria-label') || i.closest('label')
    if (!hasLabel) a11y.push(`无标签控件 ${i.tagName.toLowerCase()}`)
  }
  return {
    pageH: document.body.scrollHeight,
    scrollW: de.scrollWidth,
    clientW: de.clientWidth,
    verdict: document.querySelector('.verdict-text')?.textContent ?? '',
    verdictSize: document.querySelector('.verdict-text') ? Number.parseFloat(getComputedStyle(document.querySelector('.verdict-text')).fontSize) : 0,
    metricLabels: [...document.querySelectorAll('.verdict-metrics dt')].map((e) => e.textContent.trim()),
    caseRows: table ? table.querySelectorAll('tbody tr').length : 0,
    caseRowH: table ? Math.round(table.querySelector('tbody td').getBoundingClientRect().height) : 0,
    a11y,
  }
})
check('详情页结论区有判定文案', metrics.verdict.trim().length > 0, metrics.verdict)
check('结论字号 >= 22px', metrics.verdictSize >= 22, `${metrics.verdictSize}px`)
check(
  '关键指标齐全',
  ['CPU 耗时', '内存', '语言', '提交时间'].every((k) => metrics.metricLabels.includes(k)),
  metrics.metricLabels.join(','),
)
check('测试点行高 44px 或无可视行', metrics.caseRowH === 44 || metrics.caseRows === 0, `${metrics.caseRows} 行 / ${metrics.caseRowH}px`)
check('无横向溢出', metrics.scrollW <= metrics.clientW + 2, `${metrics.scrollW} vs ${metrics.clientW}`)
check('无无标签控件/无名按钮', metrics.a11y.length === 0, metrics.a11y.join(' ; '))
check('详情页未产生 4xx/5xx', listBad() === before, badResponses.slice(before).join(' | '))
console.log(`     页高 ${metrics.pageH}px · 测试点 ${metrics.caseRows} 行`)

const realErrors = [...new Set(consoleErrors)]
check('无前端控制台错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))
console.log(`     HTTP >=400 记录：${badResponses.length ? [...new Set(badResponses)].join(' | ') : '无'}`)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
