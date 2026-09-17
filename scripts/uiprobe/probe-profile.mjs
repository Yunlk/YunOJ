// C 组交互验收：个人中心统计块与 API 一致、收藏筛选/取消收藏、通知未读样式与批量已读。
// 用法：node scripts/uiprobe/probe-profile.mjs [--user demo05 --pass demo123] [--exercise-batch-read]
// 默认只读（不点击「全部标为已读」、不造通知数据）；唯一的写操作是收藏「取消收藏」后立即还原。
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const USER = argOf('user', 'demo01')
const PASS = argOf('pass', 'demo123')
const EXERCISE_BATCH_READ = args.includes('--exercise-batch-read')

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const token = await getToken(USER, PASS)
const authed = { Authorization: `Bearer ${token}` }
const getJSON = async (path) => {
  const r = await fetch(`${API}${path}`, { headers: authed })
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`)
  return r.json()
}

const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`) })

/* ---------------- 个人中心 ---------------- */
console.log('\n== 个人中心：统计块与账号卡（进度卡 / 热力图已下线） ==')
const profile = await getJSON('/profile')

await page.goto(`${BASE}/profile`, { waitUntil: 'networkidle' })
await page.waitForSelector('.pf-main .stat-grid')

check('使用两栏骨架 .layout-side', (await page.locator('.layout-side .pf-main').count()) === 1)
check('不再有刷题进度卡', (await page.locator('.pf-progress-figure, .pf-difficulty-list, .pf-difficulty-row').count()) === 0)
check('不再有刷题活动热力图', (await page.locator('.pf-heatmap-cell, .pf-heatmap-grid, .pf-heatmap-wrap').count()) === 0)
check('侧栏只剩账号卡', (await page.locator('.pf-side .side-card').count()) === 1)

const tiles = page.locator('.pf-main .stat-tile')
check('统计块至少 6 项指标', (await tiles.count()) >= 6, `${await tiles.count()} 项`)
const tileText = (await page.locator('.pf-main .stat-grid').innerText()).replace(/\s+/g, ' ')
check(
  `统计块数字与 /profile stats 一致（提交 ${profile.stats.total_submissions} / 通过 ${profile.stats.accepted_submissions}）`,
  tileText.includes(String(profile.stats.total_submissions)) && tileText.includes(String(profile.stats.accepted_submissions)),
  tileText.slice(0, 90),
)
check('最近提交表为 44px 行高', await page.locator('.data-table tbody td').first().evaluate((el) => Math.round(el.getBoundingClientRect().height)) === 44)
check('账号卡展示邮箱', (await page.locator('.pf-account-head').innerText()).length > 0)

/* ---------------- 收藏 ---------------- */
console.log('\n== 收藏：筛选 / 状态列 / 取消收藏 ==')
const favs = await getJSON('/profile/favorites')
await page.goto(`${BASE}/favorites`, { waitUntil: 'networkidle' })

if (favs.items.length === 0) {
  console.log('  ! 该账号暂无收藏数据，跳过收藏表格断言（空状态已单独校验）')
  check('空状态给出「去题库」动作', (await page.getByRole('link', { name: '去题库', exact: true }).count()) === 1)
} else {
  const tableRows = page.locator('.data-table tbody tr')
  check(`收藏行数与 API 一致（API ${favs.items.length}）`, (await tableRows.count()) === favs.items.length, `页面 ${await tableRows.count()}`)
  check('列表含状态列', (await page.locator('.data-table thead th', { hasText: '状态' }).count()) === 1)
  check('列表含操作列', (await page.locator('.data-table thead th', { hasText: '操作' }).count()) === 1)
  check('难度徽标使用 difficulty-level 类', (await page.locator('.data-table .difficulty-badge[class*="difficulty-level-"]').count()) === favs.items.length)
  check('标签以 .tag-chip 渲染', (await page.locator('.data-table .tag-chip').count()) > 0)
  check('收藏接口自带 my_status（字段始终存在）', favs.items.every((i) => 'my_status' in i), favs.items.map((i) => JSON.stringify(i.my_status)).join(','))
  const problemCalls = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /\/api\/problems\?/.test(e.name)).length)
  check('收藏页不再额外请求 /api/problems?（状态直接取自接口字段）', problemCalls === 0, `请求数 ${problemCalls}`)

  // 逐行交叉验证：状态列文本必须与接口 my_status 一一对应（空串=未做）
  const label = (s) => (s === 'accepted' ? '已通过' : s === 'wrong_answer' ? '尝试过' : '未做')
  // 单元格内含 aria-hidden 的 ✓ / ✗ / – 图形，比较时去掉图形与空白
  const normalize = (t) => t.replace(/[✓✗–—\s]/g, '')
  const apiStatuses = favs.items.map((i) => label(i.my_status))
  const pageStatuses = await page.locator('.data-table tbody td:nth-child(6)').allInnerTexts()
  const mismatches = apiStatuses
    .map((want, i) => ({ want, got: normalize(pageStatuses[i] ?? ''), id: favs.items[i].id }))
    .filter((r) => r.got !== r.want)
  check(
    `状态列逐行与接口 my_status 一致（${favs.items.length} 行）`,
    mismatches.length === 0,
    mismatches.map((m) => `#${m.id} 页面${m.got}≠API${m.want}`).join(' ; '),
  )
  check('状态列不出现「未知」占位', (await page.locator('.data-table tbody .pf-muted', { hasText: '—' }).count()) === 0)

  const counts = {
    todo: apiStatuses.filter((s) => s === '未做').length,
    attempted: apiStatuses.filter((s) => s === '尝试过').length,
    accepted: apiStatuses.filter((s) => s === '已通过').length,
  }
  const segText = (await page.locator('.segmented').innerText()).replace(/\s+/g, '')
  check(
    `段控计数与接口一致（未做${counts.todo}/尝试过${counts.attempted}/已通过${counts.accepted}）`,
    segText.includes(`未做${counts.todo}`) && segText.includes(`尝试过${counts.attempted}`) && segText.includes(`已通过${counts.accepted}`),
    segText,
  )

  await page.locator('.segmented button', { hasText: '未做' }).click()
  await page.waitForTimeout(250)
  check(`筛选「未做」后行数等于接口未做数（${counts.todo}）`, (await page.locator('.data-table tbody tr').count()) === counts.todo, `页面 ${await page.locator('.data-table tbody tr').count()}`)
  check('筛选后不出现「已通过」状态', (await page.locator('.data-table tbody .status-flag-accepted').count()) === 0)

  await page.locator('.segmented button', { hasText: '全部' }).click()
  await page.waitForTimeout(250)

  // 取消收藏：删掉后应同时从页面与接口消失，随后还原
  const target = favs.items.find((i) => i.my_status !== 'accepted') ?? favs.items[0]
  const row = page.locator('.data-table tbody tr', { has: page.locator(`a[href="/problem/${target.id}"]`) }).first()
  await row.locator('button', { hasText: '取消收藏' }).click()
  await page.waitForTimeout(1200)
  check('取消收藏后该行从页面移除', (await page.locator(`.data-table tbody a[href="/problem/${target.id}"]`).count()) === 0)
  const afterRemove = await getJSON('/profile/favorites')
  check(
    `取消收藏已写入后端（题 ${target.id} 不在收藏中）`,
    !afterRemove.items.some((i) => i.id === target.id),
    afterRemove.items.map((i) => i.id).join(','),
  )
  check('收藏总数摘要同步更新', (await page.locator('.table-summary').innerText()).includes(String(afterRemove.items.length)))

  // 还原数据，避免影响后续截图/人工验收
  await fetch(`${API}/problems/${target.id}/favorite`, { method: 'POST', headers: authed })
  const restored = await getJSON('/profile/favorites')
  check('数据还原成功（收藏数回到原值）', restored.items.length === favs.items.length, `${restored.items.length}/${favs.items.length}`)
}

/* ---------------- 通知 ---------------- */
console.log('\n== 通知：未读高亮 / 友好时间 / 批量已读 ==')
// 只读探针：不向库里写入任何数据（无未读时直接跳过未读相关断言）
await page.goto(`${BASE}/notifications`, { waitUntil: 'networkidle' })

const notifs = (await getJSON('/notifications')).items
const unreadApi = notifs.filter((n) => !n.read).length
check(`通知条数与 API 一致（API ${notifs.length}）`, (await page.locator('.nt-item').count()) === notifs.length)
check(
  `未读高亮数量与 API 一致（API ${unreadApi}）`,
  (await page.locator('.nt-item-unread').count()) === unreadApi,
  `页面 ${await page.locator('.nt-item-unread').count()}`,
)
check('未读项带未读徽标', (await page.locator('.nt-item-unread .badge', { hasText: '未读' }).count()) === unreadApi)
check('提示语显示未读条数', (await page.locator('.table-summary').innerText()).includes(`${unreadApi} 条未读`))

const timeText = await page.locator('.nt-item time').first().innerText()
check('时间使用友好格式（刚刚/N 分钟前/N 天前/昨天/日期）', /刚刚|分钟前|小时前|昨天|天前|\d{4}-\d{2}-\d{2}/.test(timeText), timeText)
check('时间带完整时间戳 title', ((await page.locator('.nt-item time').first().getAttribute('title')) ?? '').includes(':'))

// 默认只读：只断言按钮状态，不点击（点击会把未读数据置读）。
// 需要验证批量接口时显式加 --exercise-batch-read（该开关会真实消耗未读态）。
check('「全部标为已读」按钮存在', (await page.locator('.page-actions button').count()) === 1)
if (unreadApi > 0) {
  const allBtnText = await page.locator('.page-actions button').innerText()
  check('按钮显示未读数', allBtnText.includes(String(unreadApi)), allBtnText)
  check('有未读时按钮可点击', !(await page.locator('.page-actions button').isDisabled()))
}

if (EXERCISE_BATCH_READ && unreadApi > 0) {
  const batchCall = page.waitForRequest(
    (r) => r.url().includes('/api/notifications/read-all') && r.method() === 'POST',
    { timeout: 8000 },
  ).catch(() => null)
  await page.locator('.page-actions button').click()
  const hit = await batchCall
  check('点击后调用批量接口 POST /notifications/read-all', hit !== null, hit ? hit.url().replace(BASE, '') : '未观测到该请求')
  const singles = await page.evaluate(() => performance.getEntriesByType('resource').filter((e) => /notifications\/\d+\/read$/.test(e.name)).length)
  check('未再逐条调用单条已读接口', singles === 0, `单条请求数 ${singles}`)
  await page.waitForTimeout(1500)
  check('点击后不再有未读高亮', (await page.locator('.nt-item-unread').count()) === 0)
  const after = (await getJSON('/notifications')).items
  check('后端未读数归零', after.filter((n) => !n.read).length === 0, after.map((n) => `${n.id}:${n.read}`).join(','))
  check('按钮变为禁用', await page.locator('.page-actions button').isDisabled())
} else if (unreadApi > 0) {
  console.log('  ! 默认只读：未点击「全部标为已读」（会消耗未读态）；验证批量接口请加 --exercise-batch-read')
} else {
  console.log('  ! 当前账号无未读通知：跳过未读高亮/批量已读断言（本 probe 不写数据）')
  check('无未读时按钮为禁用', await page.locator('.page-actions button').isDisabled())
}

console.log('\n== 可访问性：无标签控件 / 无名按钮 ==')
for (const route of ['/profile', '/favorites', '/notifications']) {
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle' })
  const bad = await page.evaluate(() => {
    const out = []
    for (const b of document.querySelectorAll('button')) {
      const name = (b.textContent || '').trim() || b.getAttribute('aria-label') || ''
      if (!name) out.push(`无名按钮 .${(b.className || '').toString().split(' ')[0]}`)
    }
    for (const i of document.querySelectorAll('input:not([type=hidden]),select,textarea')) {
      const id = i.id
      const has = (id && document.querySelector(`label[for="${id}"]`)) || i.getAttribute('aria-label') || i.closest('label')
      if (!has) out.push(`无标签控件 ${i.tagName.toLowerCase()}`)
    }
    return out
  })
  check(`${route} 无标签控件/无名按钮为 0`, bad.length === 0, bad.join(' ; '))
}

if (errors.length) console.log(`\n⚠ 请求/脚本错误: ${[...new Set(errors)].slice(0, 6).join(' | ')}`)
check('无 HTTP 4xx/5xx 或脚本错误', errors.length === 0, [...new Set(errors)].slice(0, 4).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
