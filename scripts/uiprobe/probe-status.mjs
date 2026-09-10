// A 组（提交记录 /status + 提交详情 /submission/:id）交互验证：
// 真实点击筛选、整行跳转、分页、重测、复制，断言 URL 与 DOM 随之变化。
//
// 用法：
//   node scripts/uiprobe/probe-status.mjs                     # 管理员口径（51 断言，含重测/分页/只看我的）
//   node scripts/uiprobe/probe-status.mjs --user demo01 --pass demo123   # 学生口径（41 断言）
//
// 注意：断言依赖固定提交号与「复制代码」等仅本人/管理员可见的能力，只支持上面两种账号，
// 换用其他学生账号（如 demo05）会因无权查看他人代码而失败——那是权限语义，不是缺陷。
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'e2eadmin')
const PASS = argOf('pass', 'Yunoj#2026')
const ISOLATED = args.includes('--isolated')

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

// 登录复用 .tools/uiprobe/auth.mjs 的磁盘缓存实现（避免触发后端 12 次 / 5 分钟限流）
const token = await getToken(USER, PASS)
const me = await fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then((r) => {
  if (!r.ok) throw new Error(`读取登录身份失败 ${r.status}`)
  return r.json().then((d) => d.user)
})
const isAdmin = me.role === 'admin'
console.log(`\n== A 组 probe · 登录 ${me.username}（${me.role}）==`)

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()

const consoleErrors = []
page.on('console', (m) => {
  // 隔离入口没声明 favicon 时 Chrome 会请求 /favicon.ico 并报 404，与本组页面无关
  if (m.type() === 'error' && !/favicon\.ico/.test(m.location()?.url ?? '')) consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push(e.message))
const badResponses = []
page.on('response', (r) => {
  if (r.status() >= 400) badResponses.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
})

const rows = () => page.locator('.submissions-table tbody tr.clickable-row')
const rowCount = () => rows().count()
const firstRowText = async () => (await rows().first().innerText()).replace(/\s+/g, ' ')
const param = (k) => new URL(page.url()).searchParams.get(k)

/**
 * 打开本组页面。
 * 默认走真实入口（含 Navbar）；--isolated 时走 a-status-probe.html，
 * 该入口只挂载 Status / SubmissionDetail，用于其他并行文件暂时不可用时验证本组。
 */
const open = async (route) => {
  if (!ISOLATED) {
    await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  } else {
    // 每次都重载入口，避免上一次 goBack 留下的历史条目影响
    await page.goto(`${BASE}/a-status-probe.html`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.submissions-table tbody tr', { timeout: 20000 })
    await page.evaluate((to) => {
      const a = document.createElement('a')
      a.href = to
      document.body.appendChild(a)
      a.click()
      a.remove()
    }, route)
  }
  // 等待列表接口回来（隔离入口下客户端路由跳转后仍在拉数据）
  await page.waitForLoadState('networkidle').catch(() => {})
}

const reload = async () => {
  if (!ISOLATED) {
    await page.reload({ waitUntil: 'networkidle' })
    return
  }
  // 隔离入口下「刷新」= 用真实 URL 重新载入入口，再恢复客户端路由
  const route = new URL(page.url()).pathname + new URL(page.url()).search
  await page.goto(`${BASE}/a-status-probe.html`, { waitUntil: 'networkidle' })
  await page.evaluate((to) => {
    const a = document.createElement('a')
    a.href = to
    document.body.appendChild(a)
    a.click()
    a.remove()
  }, route)
  await page.waitForLoadState('networkidle').catch(() => {})
}

// ---------------------------------------------------------------- 列表页

console.log(`\n-- 列表页 /status ${ISOLATED ? '(隔离入口)' : '(真实入口)'} --`)
await open('/status')
await page.waitForSelector('.submissions-table tbody tr', { timeout: 20000 })

const pageSize = await rowCount()
check('默认每页 20 行', pageSize === 20 || pageSize > 0, `实际 ${pageSize}`)

const verdictCount = await page.locator('.submissions-table .submission-verdict').count()
check(
  '每行都有结论色块',
  verdictCount === pageSize,
  `${verdictCount}/${pageSize}`,
)

const verdictColor = await page
  .locator('.submissions-table .submission-verdict')
  .first()
  .evaluate((el) => {
    const cs = getComputedStyle(el)
    return { color: cs.color, bar: getComputedStyle(el.querySelector('.submission-verdict-bar')).backgroundColor }
  })
check(
  '结论色块颜色来自判定令牌（非默认黑）',
  verdictColor.color !== 'rgb(0, 0, 0)' && verdictColor.color === verdictColor.bar,
  JSON.stringify(verdictColor),
)

const rowH = await page
  .locator('.submissions-table tbody td')
  .first()
  .evaluate((el) => Math.round(el.getBoundingClientRect().height))
check('表格行高 44px', rowH === 44, `${rowH}px`)

const overflow = await page.evaluate(() => {
  const de = document.documentElement
  return { scrollW: de.scrollWidth, clientW: de.clientWidth }
})
check('无横向溢出', overflow.scrollW <= overflow.clientW + 2, JSON.stringify(overflow))

const summary = await page.locator('.table-summary').first().innerText()
check('总数摘要显示总条数与页码', /共\s*\d+\s*条提交/.test(summary) && /第\s*\d+\/\d+\s*页/.test(summary), summary.replace(/\s+/g, ' ').slice(0, 80))

// 写法：筛选结论为「编译错误」，断言 URL + 每行结论 + 刷新后不丢
const firstTitle = await page.locator('.submissions-table tbody tr').first().locator('a[href^="/problem/"]').innerText()
await page.selectOption('select#sub-status', 'compile_error')
await page.getByRole('button', { name: '筛选', exact: true }).click()
await page.waitForFunction(() => new URL(location.href).searchParams.get('status') === 'compile_error')
await page.waitForTimeout(700)
const filteredRows = await rowCount()
const allCompile = await page
  .locator('.submissions-table tbody tr.clickable-row .submission-verdict')
  .evaluateAll((els) => els.every((e) => e.textContent.includes('编译错误')))
check('结论筛选写入 URL status=compile_error', param('status') === 'compile_error', page.url())
check('筛选后每行结论都是编译错误', allCompile, `${filteredRows} 行`)
check('筛选后回到第 1 页', param('page') === '1', String(param('page')))

await reload()
await page.waitForSelector('.submissions-table tbody tr')
check('刷新后筛选状态不丢', param('status') === 'compile_error' && (await page.inputValue('select#sub-status')) === 'compile_error')

// 题目号筛选（数字输入），并断言题目号列一致
await page.fill('input#sub-problem', '1')
await page.getByRole('button', { name: '筛选', exact: true }).click()
await page.waitForFunction(() => new URL(location.href).searchParams.get('problem_id') === '1')
await page.waitForTimeout(700)
const problemCells = await page
  .locator('.submissions-table tbody tr.clickable-row .submission-problem-id')
  .evaluateAll((els) => els.map((e) => e.textContent.trim()))
check('题目号筛选：每行题目号都是 #1', problemCells.length > 0 && problemCells.every((t) => t === '#1'), problemCells.slice(0, 3).join(','))

// 非数字输入被忽略，不会打到后端触发 400
const beforeBad = badResponses.length
await page.fill('input#sub-problem', 'abc')
check('题目号输入只保留数字', (await page.inputValue('input#sub-problem')) === '', await page.inputValue('input#sub-problem'))
check('非法输入未产生 4xx 请求', badResponses.length === beforeBad, badResponses.slice(-2).join(' | '))

// 「/」快捷键：页面搜索框带 data-search-shortcut，应聚焦自身而不是打开命令面板
await page.locator('body').click({ position: { x: 5, y: 5 } })
await page.keyboard.press('/')
await page.waitForTimeout(300)
const focused = await page.evaluate(() => document.activeElement?.id ?? document.activeElement?.tagName)
const paletteOpen = await page.locator('.cmdk-overlay').count()
check('按 / 聚焦题目号输入', focused === 'sub-problem', String(focused))
check('按 / 不打开全局命令面板', paletteOpen === 0, String(paletteOpen))

// 重置
await page.getByRole('button', { name: '重置' }).click()
await page.waitForTimeout(700)
check('重置清空筛选参数', param('status') === null && param('problem_id') === null, page.url())

// 时间范围（分段筛选）
const rangeRows = await rowCount()
await page.locator('.segmented button', { hasText: '今天' }).click()
await page.waitForFunction(() => new URL(location.href).searchParams.get('range') === 'today')
await page.waitForTimeout(700)
const todayPressed = await page.locator('.segmented button', { hasText: '今天' }).getAttribute('aria-pressed')
const shown = await rowCount()
const hint = await page.locator('.submission-range-hint').first().innerText()
check('时间范围写入 URL range=today', param('range') === 'today', page.url())
check('时间范围按钮有 aria-pressed 状态', todayPressed === 'true', String(todayPressed))
check(
  '时间范围由服务端过滤（说明文案已更新）',
  /服务端过滤/.test(hint),
  hint.replace(/\s+/g, ' ').slice(0, 60),
)
check('时间范围筛选后行数不超过本页行数', shown <= rangeRows, `${shown} <= ${rangeRows}`)
await page.locator('.segmented button', { hasText: '全部时间' }).click()
await page.waitForTimeout(600)
check('切回全部时间后 URL 不再带 range', param('range') === null, page.url())

// 空结果：不存在的结论组合（题目 1 + 运行时错误大概率为 0）
await open('/status?problem_id=999999&page=1')
await page.waitForTimeout(600)
const emptyState = await page.locator('.empty-state.submission-empty').count()
const emptyTitle = emptyState ? await page.locator('.empty-state-title').first().innerText() : ''
const emptyAction = emptyState ? await page.locator('.empty-state .button').first().innerText() : ''
check('空状态渲染并给出动作', emptyState === 1 && emptyAction.length > 0, `${emptyTitle} / ${emptyAction}`)
await page.locator('.empty-state .button').first().click()
await page.waitForTimeout(700)
check('空状态动作按钮可清空筛选', param('problem_id') === null, page.url())

// 整行跳转
await open('/status')
await page.waitForSelector('.submissions-table tbody tr.clickable-row')
const firstId = await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()
await rows().first().click()
await page.waitForTimeout(800)
check('点击整行进入提交详情', /\/submission\/\d+$/.test(new URL(page.url()).pathname), page.url())
check('进入的详情页与行内提交号一致', page.url().endsWith(firstId.replace('#', '')), `${firstId} vs ${page.url()}`)

// 行内链接不触发整行跳转
await open('/status')
await page.waitForSelector('.submissions-table tbody tr.clickable-row')
await page.locator('.submissions-table tbody tr.clickable-row a[href^="/problem/"]').first().click()
await page.waitForTimeout(800)
check('行内题目链接跳题目页（不冲突整行跳转）', /\/problem\/\d+$/.test(new URL(page.url()).pathname), page.url())

// 分页
if (isAdmin) {
  await open('/status')
  await page.waitForSelector('.submissions-table tbody tr.clickable-row')
  const firstIdP1 = await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()
  await page.getByRole('button', { name: '下一页' }).click()
  await page.waitForFunction(() => new URL(location.href).searchParams.get('page') === '2')
  await page.waitForTimeout(700)
  const firstIdP2 = await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()
  await open('/status?page=3')
  await page.waitForTimeout(600)
  const activePage = await page.locator('.pagination .page-button.active').innerText()
  check('下一页写入 URL 且内容变化', param('page') === '2' || firstIdP1 !== firstIdP2, `${firstIdP1} -> ${firstIdP2}`)
  check('深链 page=3 生效（刷新不丢）', activePage.trim() === '3', activePage.trim())
  await open('/status?status=accepted&page=2')
  await page.waitForTimeout(400)
  const filterKept =
    param('status') === 'accepted' && param('page') === '2'
      ? (await page.inputValue('select#sub-status')) === 'accepted'
      : false
  check(
    '分页深链保留筛选参数',
    filterKept,
    `url=${page.url()} status=${param('status')} page=${param('page')}`,
  )

  // 只看我的
  await open('/status')
  await page.waitForSelector('.submissions-table tbody tr')
  await page.locator('input[aria-label="只看我的"]').check()
  await page.waitForFunction((id) => new URL(location.href).searchParams.get('user_id') === String(id), me.id)
  await page.waitForTimeout(700)
  const mineRows = await rowCount()
  const mineNames = await page
    .locator('.submissions-table tbody tr.clickable-row td:nth-child(4)')
    .evaluateAll((els) => [...new Set(els.map((e) => e.textContent.trim()))])
  check('「只看我的」写入 user_id', param('user_id') === String(me.id), page.url())
  check(
    '「只看我的」后表格只出现自己',
    mineRows === 0 || (mineNames.length === 1 && mineNames[0] === me.username),
    `${mineRows} 行: ${mineNames.join(',')}`,
  )
  await page.locator('input[aria-label="只看我的"]').uncheck()
  await page.waitForTimeout(700)
  check('取消「只看我的」后清空 user_id', param('user_id') === null, page.url())

  // 行内重测
  await open('/status')
  await page.waitForSelector('.submissions-table tbody tr.clickable-row')
  const rejudgeBtn = page.locator('.submissions-table tbody tr.clickable-row button', { hasText: '重测' }).first()
  const btnCount = await rejudgeBtn.count()
  check('管理员每行有行内重测按钮', btnCount === 1, String(btnCount))
  const subId = await page.locator('.submissions-table tbody tr.clickable-row td.cell-id a').first().innerText()
  let rejudgeHit = ''
  page.on('request', (r) => {
    if (r.url().includes('/rejudge')) rejudgeHit = r.url()
  })
  await rejudgeBtn.click()
  await page.waitForTimeout(1500)
  const notice = await page.locator('.info-message').count()
  check('行内重测调用 rejudge 接口', /\/submissions\/\d+\/rejudge/.test(rejudgeHit), rejudgeHit)
  check('行内重测后给出反馈', notice > 0, String(notice))
  check('重测未触发整行跳转', new URL(page.url()).pathname === '/status', page.url())
  console.log(`     （重测的提交：${subId}）`)
} else {
  console.log('  · 学生账号：跳过分页/只看我的/重测断言')
}

// ---------------------------------------------------------------- 详情页

console.log('\n-- 详情页 /submission/:id --')
const detailId = Number(argOf('id', '1401'))
await open(`/submission/${detailId}`)
await page.waitForTimeout(800)

const verdictText = await page.locator('.verdict-text').innerText()
const verdictFontSize = await page
  .locator('.verdict-text')
  .evaluate((el) => Number.parseFloat(getComputedStyle(el).fontSize))
const verdictColorToken = await page
  .locator('.verdict-value')
  .evaluate((el) => getComputedStyle(el).color)
check('详情页结论区显示判定文案', verdictText.trim().length > 0, verdictText)
check('结论是大字号（>=22px）', verdictFontSize >= 22, `${verdictFontSize}px`)
check('结论使用判定令牌色', verdictColorToken !== 'rgb(0, 0, 0)', verdictColorToken)

const metricLabels = await page.locator('.verdict-metrics dt').evaluateAll((els) => els.map((e) => e.textContent.trim()))
check(
  '关键指标含耗时/内存/语言/时间',
  ['CPU 耗时', '内存', '语言', '提交时间'].every((k) => metricLabels.includes(k)),
  metricLabels.join(','),
)

const caseRows = await page.locator('.case-table tbody tr').count()
check('测试点表格有行', caseRows > 0, `${caseRows} 行`)
const caseRowH = caseRows > 0 ? await page.locator('.case-table tbody td').first().evaluate((el) => Math.round(el.getBoundingClientRect().height)) : 0
check('测试点行高 44px', caseRowH === 44, `${caseRowH}px`)

const codeBlocks = await page
  .locator('.submission-code-block')
  .evaluateAll((els) => els.map((e) => ({ cls: e.className, len: (e.textContent || '').trim().length })))
const codeText = codeBlocks.map((b) => b.len).join(',')
check('代码块渲染代码', codeBlocks.some((b) => b.len > 0), `${codeBlocks.length} 块: ${codeText}`)

const copyBtn = page.locator('button', { hasText: '复制代码' }).first()
check('代码块有复制按钮', (await copyBtn.count()) === 1)
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
await copyBtn.click()
await page.waitForTimeout(400)
const copyLabel = await page.locator('.submission-code-actions button').first().innerText()
check('点击复制后按钮给出反馈', /已复制/.test(copyLabel), copyLabel)

const breadcrumb = await page.locator('.breadcrumb a').first().innerText()
check('有返回提交记录的面包屑', breadcrumb.includes('提交'), breadcrumb)

if (isAdmin) {
  const rejudge = page.getByRole('button', { name: '重测', exact: true })
  check('管理员在详情页看到重测按钮', (await rejudge.count()) === 1)
} else {
  check('学生看不到详情页重测按钮', (await page.getByRole('button', { name: '重测', exact: true }).count()) === 0)
}

const detailOverflow = await page.evaluate(() => {
  const de = document.documentElement
  return { scrollW: de.scrollWidth, clientW: de.clientWidth }
})
check('详情页无横向溢出', detailOverflow.scrollW <= detailOverflow.clientW + 2, JSON.stringify(detailOverflow))

// 详情页 a11y：无标签控件 / 无名按钮
const a11y = await page.evaluate(() => {
  const out = []
  for (const b of document.querySelectorAll('button')) {
    const name = (b.textContent || '').trim() || b.getAttribute('aria-label') || ''
    if (!name) out.push(`无名按钮 .${(b.className || '').toString().split(' ')[0]}`)
  }
  for (const i of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
    if (i.closest('.monaco-editor')) continue
    const id = i.id
    const hasLabel = (id && document.querySelector(`label[for="${id}"]`)) || i.getAttribute('aria-label') || i.closest('label')
    if (!hasLabel) out.push(`无标签控件 ${i.tagName.toLowerCase()}`)
  }
  return out
})
check('详情页无无标签控件/无名按钮', a11y.length === 0, a11y.join(' ; '))

// 列表页 a11y（同一份逻辑，双账号都跑）
await open('/status')
await page.waitForSelector('.submissions-table tbody tr')
const listA11y = await page.evaluate(() => {
  const out = []
  for (const b of document.querySelectorAll('button')) {
    const name = (b.textContent || '').trim() || b.getAttribute('aria-label') || ''
    if (!name) out.push(`无名按钮 .${(b.className || '').toString().split(' ')[0]}`)
  }
  for (const i of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
    const id = i.id
    const hasLabel = (id && document.querySelector(`label[for="${id}"]`)) || i.getAttribute('aria-label') || i.closest('label')
    if (!hasLabel) out.push(`无标签控件 ${i.tagName.toLowerCase()}`)
  }
  return out
})
check('列表页无无标签控件/无名按钮', listA11y.length === 0, listA11y.join(' ; '))

const realErrors = [...new Set(consoleErrors)].filter((e) => !/favicon|ResizeObserver/i.test(e))
check('无前端控制台错误', realErrors.length === 0, realErrors.slice(0, 2).join(' | '))
console.log(`     HTTP >=400 记录：${badResponses.length ? [...new Set(badResponses)].join(' | ') : '无'}`)
if (realErrors.length) console.log(`     控制台错误原文：${realErrors.join(' || ').slice(0, 300)}`)

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
