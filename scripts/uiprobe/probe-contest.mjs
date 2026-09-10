// B 组（比赛页）交互断言：分组渲染 / 倒计时刷新 / 报名状态 / 整行可点 / 提交页筛选。
//
// 本脚本自带夹具：先建一场「进行中」和一场「即将开始」的比赛（demo01 报名进行中那场），
// 跑完断言后在 finally 里删掉，不污染本机数据。
//
// 用法：node scripts/uiprobe/probe-contest.mjs
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'

const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const FIXTURE_PREFIX = '[E2E临时]'

const post = async (path, body, token) => {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  })
  if (!r.ok) throw new Error(`POST ${path} → ${r.status} ${await r.text()}`)
  return r.json()
}

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

// ---------------- 夹具 ----------------
// 约定：夹具比赛用 `[E2E临时]` 前缀 + visibility=private，避免被其它组的审计/截图拍到，
// 也让导航栏的「进行中比赛」胶囊不出现假数据；脚本结束时（finally）必删。
const adminToken = await getToken('e2eadmin', 'Yunoj#2026')
const cleanup = async () => {
  const r = await fetch(`${API}/contests?page=1&size=200`, {
    headers: { Authorization: `Bearer ${adminToken}` },
  })
  if (!r.ok) return
  const data = await r.json()
  for (const contest of data.items) {
    if (!contest.title.startsWith(FIXTURE_PREFIX) && !contest.title.startsWith('[UIprobe]')) continue
    await fetch(`${API}/contests/${contest.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${adminToken}` },
    }).catch(() => undefined)
  }
}
// 异常/中断路径也要清：SIGINT/SIGTERM 与未捕获异常都触发一次 cleanup
let cleanedUp = false
const cleanupOnce = async () => {
  if (cleanedUp) return
  cleanedUp = true
  await cleanup().catch(() => undefined)
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    void cleanupOnce().finally(() => process.exit(1))
  })
}
process.on('uncaughtException', (err) => {
  console.error('uncaught:', err)
  void cleanupOnce().finally(() => process.exit(1))
})
process.on('unhandledRejection', (err) => {
  console.error('unhandledRejection:', err)
  void cleanupOnce().finally(() => process.exit(1))
})
await cleanup() // 清掉上次可能残留的夹具

// 夹具可见性策略：**两场都用 visibility=private**。
// private 比赛不进 `/api/contests/active`（后端 WHERE visibility='public'）、不进公开列表，
// 所以即使脚本被强杀导致残留，也不会出现在任何人的导航栏/首页/截图上。
// 管理员能看到它们，用于验证分组与倒计时；demo01 报名后能看详情页，用于验证报名状态。
// 标题统一 `[E2E临时]` 前缀，便于事后 SQL 清理；建/删都在本脚本内完成。
const now = Date.now()
const fixture = (title, startOffsetMin, endOffsetMin) => ({
  title: `${FIXTURE_PREFIX} ${title}`,
  mode: 'ACM',
  feedback: 'realtime',
  score_mode: 'all_or_nothing',
  penalty_minutes: 20,
  freeze_duration_minutes: 0,
  dynamic_delay_minutes: 0,
  rank_keys: [],
  start_time: new Date(now + startOffsetMin * 60000).toISOString(),
  end_time: new Date(now + endOffsetMin * 60000).toISOString(),
  description: 'probe 临时比赛（private，不进公开列表与导航胶囊），脚本结束时会自动删除。',
  cover_image: '',
  visibility: 'private',
  submission_limit: 0,
  registration_mode: 'both',
  max_team_size: 3,
  allow_team_edit: true,
  pretest_only: false,
  hacking_enabled: false,
})

const running = await post('/contests', fixture('进行中', -10, 12), adminToken)
const upcoming = await post('/contests', fixture('即将开始', 90, 210), adminToken)
// 给进行中的夹具挂一道题，才能验证「我的状态」列与整行进入比赛题目页
await post(`/contests/${running.id}/problems`, { problem_id: 437, display_id: 'A', sort_order: 1 }, adminToken)
const studentToken = await getToken('demo01', 'demo123')
await post(`/contests/${running.id}/register`, { team_name: 'probe 验证队' }, studentToken)
console.log(`夹具：进行中 #${running.id}，即将开始 #${upcoming.id}（demo01 已报名进行中的那场）`)

const browser = await chromium.launch({ channel: 'chrome' })
// 登录接口有频率限制，每个账号只登一次（getToken 带磁盘缓存），后续复用 token
const unregisteredToken = await getToken('demo05', 'demo123')
const tokens = { demo01: studentToken, e2eadmin: adminToken, demo05: unregisteredToken }
const openPage = async (user) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  context.addInitScript((t) => localStorage.setItem('yunoj_token', t), tokens[user])
  const page = await context.newPage()
  const httpErrors = []
  const requests = []
  page.on('request', (r) => requests.push(r.url().replace(BASE, '')))
  page.on('response', (r) => {
    if (r.status() >= 400) httpErrors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
  })
  return { context, page, httpErrors, requests }
}

try {
  // ==================== 列表（管理员口径） ====================
  // 夹具是 private（避免污染其他组的审计/截图），所以只有管理员能在列表里看到它们；
  // 普通选手视角的列表断言放在下一段（demo01）。
  {
    const { context, page, httpErrors, requests } = await openPage('e2eadmin')

    console.log('\n== 比赛列表：分组 / 倒计时 / 报名状态 ==')
    // N+1 回归断言：列表应直接用 /contests 返回的 is_registered，不再逐行打 /registration
    requests.length = 0
    await page.goto(`${BASE}/contests`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.contest-group')
    await page.waitForTimeout(1200)
    const perRowRegRequests = requests.filter((u) => /\/contests\/\d+\/registration$/.test(u)).length
    const listRequests = requests.filter((u) => /\/contests\?/.test(u)).length
    check('列表页不再逐行请求 /registration（N+1 已消除）', perRowRegRequests === 0, `${perRowRegRequests} 次`)
    check('列表数据来自单次 GET /contests', listRequests === 1, `${listRequests} 次`)
    const groups = (await page.locator('.contest-group-title').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '))
    check('渲染三个分组（进行中/即将开始/已结束）', groups.length === 3, groups.join(' | '))
    check(
      '分组顺序 进行中 → 即将开始 → 已结束',
      /进行中/.test(groups[0]) && /即将开始/.test(groups[1]) && /已结束/.test(groups[2]),
      groups.join(' | '),
    )
    check('进行中分组含夹具比赛', /进行中 [1-9]\d* 场/.test(groups[0]), groups[0])
    check('即将开始分组含夹具比赛', /即将开始 [1-9]\d* 场/.test(groups[1]), groups[1])

    const countdowns = await page.locator('.contest-countdown').count()
    check('进行中 / 即将开始分组显示倒计时', countdowns >= 2, `${countdowns} 个倒计时单元格`)
    const before = await page.locator('.contest-countdown').first().innerText()
    await page.waitForTimeout(3000)
    const after = await page.locator('.contest-countdown').first().innerText()
    check('倒计时自行刷新（useClock 秒级）', before !== after, `before="${before.replace(/\s+/g, ' ')}" after="${after.replace(/\s+/g, ' ')}"`)

    // 定位夹具那一行（按比赛号精确匹配，避免受列表里其它比赛影响）
    const runningRow = page.locator('.contest-table tbody tr', {
      has: page.locator('.cell-id', { hasText: new RegExp(`^${running.id}$`) }),
    })
    check('夹具比赛行存在', (await runningRow.count()) === 1, `row=${await runningRow.count()}`)
    check('行内标注赛制标签', (await runningRow.locator('td').nth(2).innerText()).includes('ACM'))
    const badgeCell = (await runningRow.locator('td').nth(4).innerText()).trim()
    check('行内报名状态取自列表字段（demo01 已报名 → 显示已报名）', badgeCell.length > 0, `报名单元格="${badgeCell}"`)
    if ((await runningRow.count()) === 1) {
      const rankCell = (await runningRow.locator('td').nth(5).innerText()).trim()
      check('「我的排名」单元格已渲染（无数据时为占位符）', rankCell.length > 0, `排名单元格="${rankCell}"`)
    }
    check('行内倒计时指向夹具结束时间', (await runningRow.locator('.contest-countdown').count()) === 1)

    await page.getByRole('button', { name: /^进行中/ }).click()
    await page.waitForFunction(() => new URL(location.href).searchParams.get('phase') === 'running')
    await page.waitForTimeout(500)
    check('筛选「进行中」后只剩一个分组', (await page.locator('.contest-group').count()) === 1)

    await page.getByRole('button', { name: /^全部/ }).click()
    await page.waitForTimeout(400)

    // 「只看我报名的」：管理员默认没报名任何比赛，勾选后应显示空状态而不报错
    await page.getByLabel('只看我报名的').check()
    await page.waitForFunction(() => new URL(location.href).searchParams.get('mine') === '1')
    await page.waitForTimeout(700)
    const mineRowsAdmin = await page.locator('.contest-table tbody tr').count()
    const emptyState = await page.locator('.empty-state').count()
    check(
      '「只看我报名的」写入 URL；管理员未报名任何比赛时显示空状态',
      page.url().includes('mine=1') && emptyState === 1 && mineRowsAdmin === 0,
      `rows=${mineRowsAdmin} empty=${emptyState}`,
    )
    await page.getByLabel('只看我报名的').uncheck()
    await page.waitForTimeout(400)

    await page.locator('.contest-table tbody tr').first().click()
    await page.waitForTimeout(700)
    check('点击整行进入比赛详情', /\/contest\/\d+$/.test(new URL(page.url()).pathname), page.url())

    // 回到稳定存在的比赛 226 收尾：避免上一次运行的夹具已被删除时，
    // 后续 request 打到已不存在的比赛（会产生与本次改动无关的 404）
    requests.length = 0
    httpErrors.length = 0
    await page.goto(`${BASE}/contest/226`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(800)
    check('列表页没有意外的 4xx/5xx', httpErrors.length === 0, [...new Set(httpErrors)].join(' | '))
    await context.close()
  }

  // ==================== 已报名选手：详情（进行中 + 已报名） ====================
  {
    const { context, page, httpErrors } = await openPage('demo01')
    console.log('\n== 比赛详情：进行中 + 已报名 ==')
    // 「只看我报名的」在真实选手身上验证：未报名的 private 夹具行应被过滤掉
    await page.goto(`${BASE}/contests`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.contest-group')
    await page.waitForTimeout(800)
    await page.getByLabel('只看我报名的').check()
    await page.waitForFunction(() => new URL(location.href).searchParams.get('mine') === '1')
    await page.waitForTimeout(700)
    const unregisteredFixtureRow = await page.locator('.contest-table tbody tr', {
      has: page.locator('.cell-id', { hasText: new RegExp(`^${upcoming.id}$`) }),
    }).count()
    const remainingBadges = await page.locator('.contest-reg-badge').allInnerTexts()
    check(
      '「只看我报名的」过滤掉未报名的比赛',
      page.url().includes('mine=1') && unregisteredFixtureRow === 0 && remainingBadges.every((t) => t.includes('已报名')),
      `fixtureRow=${unregisteredFixtureRow} badges=${remainingBadges.join(' / ')}`,
    )
    const hiddenPrivate = await page.locator('.contest-table tbody tr', {
      has: page.locator('.cell-id', { hasText: new RegExp(`^${running.id}$`) }),
    }).count()
    check('private 夹具不出现在非管理员的公开列表（不污染他人）', hiddenPrivate === 0, `row=${hiddenPrivate}`)

    await page.goto(`${BASE}/contest/${running.id}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.contest-status-bar')

    const statusBar = page.locator('.contest-status-bar')
    const statusText = (await statusBar.innerText()).replace(/\s+/g, ' ')
    check('状态条显示「进行中」与剩余倒计时', /进行中/.test(statusText) && /剩余/.test(statusText), statusText.slice(0, 80))
    check('状态条倒计时在跑', (await statusBar.locator('.contest-countdown').count()) > 0)
    check('已报名显示「队伍报名」入口', (await page.getByRole('link', { name: '队伍报名' }).count()) === 1)
    check('队伍面板显示队伍名', (await page.locator('.team-panel-name').innerText()).includes('probe 验证队'))

    const tabs = (await page.locator('.contest-tabs .tab').allInnerTexts()).map((t) => t.trim())
    check('保留 总览/我的提交/排行榜 tab', ['总览', '我的提交', '排行榜'].every((t) => tabs.includes(t)), tabs.join(' / '))
    const sideText = (await page.locator('.contest-overview-side').innerText()).replace(/\s+/g, ' ')
    check('侧栏 .side-card 展示赛制字段', /赛制/.test(sideText) && /反馈/.test(sideText) && /计分/.test(sideText) && /提交上限/.test(sideText), sideText.slice(0, 100))
    check('侧栏展示「我的成绩」', /我的成绩/.test(sideText))
    check('详情页没有意外的 4xx/5xx', httpErrors.length === 0, [...new Set(httpErrors)].join(' | '))
    const problemRows = await page.locator('.contest-problems-table tbody tr').count()
    check('题目表格有数据行', problemRows > 0, `${problemRows} 行`)
    check('题目行整行可点（clickable-row）', (await page.locator('.contest-problems-table tbody tr.clickable-row').count()) === problemRows)
    check('每行都有「我的状态」单元格', (await page.locator('.contest-problems-table .contest-my-status').count()) === problemRows)
    await page.locator('.contest-problems-table tbody tr').first().click()
    await page.waitForTimeout(800)
    check('点击题目行进入比赛题目页', new RegExp(`/contest/${running.id}/problem/\\d+`).test(page.url()), page.url())

    await page.goto(`${BASE}/contest/${running.id}`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.contest-tabs')
    await page.locator('.contest-tabs .tab', { hasText: '排行榜' }).click()
    await page.waitForTimeout(800)
    check('排行榜 tab 可跳转', /\/standings$/.test(new URL(page.url()).pathname), page.url())
    await context.close()
  }

  // ==================== 管理员视角 ====================
  {
    const { context, page, httpErrors } = await openPage('e2eadmin')
    console.log('\n== 比赛详情（管理员 226：全部 tab 与操作保留）==')
    await page.goto(`${BASE}/contest/226`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.contest-tabs')
    const tabs = (await page.locator('.contest-tabs .tab').allInnerTexts()).map((t) => t.trim())
    check(
      'tab 含 总览/全部提交/排行榜/比赛设置/消息管理/参赛者',
      ['总览', '全部提交', '排行榜', '比赛设置', '消息管理', '参赛者'].every((t) => tabs.includes(t)),
      tabs.join(' / '),
    )
    const actions = (await page.locator('.page-actions').innerText()).replace(/\s+/g, ' ')
    check('头部保留 消息管理/参赛者/编辑/删除', ['消息管理', '参赛者', '编辑', '删除'].every((t) => actions.includes(t)), actions)

    const rows = await page.locator('.contest-problems-table tbody tr').count()
    check('题目表格有数据行', rows > 0, `${rows} 行`)
    check('题目行整行可点', (await page.locator('.contest-problems-table tbody tr.clickable-row').count()) === rows)
    check('题目行有「我的状态」单元格', (await page.locator('.contest-problems-table .contest-my-status').count()) === rows)
    await page.locator('.contest-problems-table tbody tr').first().click()
    await page.waitForTimeout(800)
    check('点击题目行进入比赛题目页', /\/contest\/226\/problem\/\d+/.test(page.url()), page.url())

    console.log('\n== 比赛提交页（管理员 226）==')
    await page.goto(`${BASE}/contest/226/submissions`, { waitUntil: 'networkidle' })
    await page.waitForSelector('.contest-submissions-table')
    check('结论筛选有可访问名', (await page.locator('select[aria-label="按判题结论筛选"]').count()) === 1)
    check('题目 ID 筛选框有 label', (await page.locator('label[for="contest-problem-filter"]').count()) === 1)
    check('返回总览入口存在', (await page.getByRole('link', { name: '← 返回总览' }).count()) === 1)
    const rowsBefore = await page.locator('.contest-submissions-table tbody tr').count()
    check('默认列出提交行', rowsBefore > 0, `${rowsBefore} 行`)

    await page.selectOption('select[aria-label="按判题结论筛选"]', 'accepted')
    await page.waitForFunction(() => new URL(location.href).searchParams.get('status') === 'accepted')
    await page.waitForTimeout(700)
    const rowsAfter = await page.locator('.contest-submissions-table tbody tr').count()
    check('按结论筛选生效且写进 URL', page.url().includes('status=accepted') && rowsAfter <= rowsBefore, `${rowsBefore} → ${rowsAfter}`)

    await page.fill('#contest-problem-filter', '437')
    await page.keyboard.press('Enter')
    await page.waitForTimeout(700)
    check('题目 ID 筛选写进 URL', page.url().includes('problem_id=437'), page.url())

    await page.getByRole('button', { name: '重置' }).click()
    await page.waitForTimeout(700)
    check('重置清空筛选参数', !page.url().includes('status=') && !page.url().includes('problem_id='), page.url())

    await page.locator('.contest-submissions-table tbody tr').first().click()
    await page.waitForTimeout(700)
    check('提交行整行可点进提交详情', /\/submission\/\d+/.test(page.url()), page.url())

    check('提交页没有意外的 4xx/5xx', httpErrors.length === 0, [...new Set(httpErrors)].join(' | '))
    await context.close()
  }

  // ==================== 未报名用户：不得产生 403 请求 ====================
  {
    const { context, page, httpErrors, requests } = await openPage('demo05')
    console.log('\n== 未报名用户（demo05）：不请求答疑 / 不请求提交 ==')
    // 下面每次断言只看「本次导航之后」新增的错误与请求
    let reqMark = requests.length
    const newReqs = () => requests.slice(reqMark)
    const errMark = () => httpErrors.length
    const newErrors = (mark) => [...new Set(httpErrors.slice(mark))]

    // 用响应事件代替固定等待：等到广播守卫的报名接口回来，再看提示
    const registrationResponse = page
      .waitForResponse((r) => /\/contests\/226\/registration$/.test(r.url()), { timeout: 15000 })
      .then((r) => r.status())
      .catch((e) => `none:${e.message.slice(0, 60)}`)
    await page.goto(`${BASE}/contest/226`, { waitUntil: 'networkidle' })
    const regStatus = await registrationResponse
    await page.waitForTimeout(4000) // 原本每 3s 轮询一次，留足时间暴露 403
    let mark = errMark()
    const hintCount = await page.locator('.contest-broadcast-hint').count()
    check('详情页未发起 /communications 请求', newReqs().filter((u) => u.includes('/communications')).length === 0, newReqs().filter((u) => u.includes('/communications')).join(' | '))
    check(
      '详情页显示「报名后可查看广播与答疑」提示',
      hintCount === 1,
      `hint=${hintCount}, registration=${regStatus}, body=${(await page.locator('body').innerText()).replace(/\s+/g, ' ').slice(-120)}`,
    )
    check('详情页无 4xx/5xx', newErrors(mark).length === 0, newErrors(mark).join(' | '))

    reqMark = requests.length
    const standingsErrMark = errMark()
    await page.goto(`${BASE}/contest/226/standings`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(4000)
    check('榜单页未发起 /communications 请求', newReqs().filter((u) => u.includes('/communications')).length === 0, newReqs().filter((u) => u.includes('/communications')).join(' | '))
    check('榜单页无 4xx/5xx', newErrors(standingsErrMark).length === 0, newErrors(standingsErrMark).join(' | '))

    reqMark = requests.length
    const subErrMark = errMark()
    await page.goto(`${BASE}/contest/226/submissions`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2500)
    const subRequests = newReqs().filter((u) => /\/contests\/\d+\/submissions/.test(u)).length
    const body = await page.locator('body').innerText()
    check('提交页未发起 /submissions 请求', subRequests === 0, `${subRequests} 次`)
    check('提交页改为引导报名', /报名本场比赛后才能查看提交记录/.test(body) && (await page.getByRole('link', { name: '去报名' }).count()) === 1)
    check('提交页无 4xx/5xx', newErrors(subErrMark).length === 0, newErrors(subErrMark).join(' | '))

    // 比赛题目页（沉浸式布局）：未报名同样不得请求题目 / 答疑，且必须有语义标题
    reqMark = requests.length
    const probErrMark = errMark()
    await page.goto(`${BASE}/contest/226/problem/437`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(4000)
    const probReqs = newReqs().filter((u) => u.includes('/problems/') || u.includes('/communications'))
    const h1s = (await page.locator('h1').allInnerTexts()).map((t) => t.trim())
    check('题目页未请求 /problems 与 /communications', probReqs.length === 0, probReqs.join(' | '))
    check('题目页有语义标题（h1 请先报名参加该比赛）', h1s.some((t) => t.includes('请先报名参加该比赛')), h1s.join(' | '))
    check('题目页提供「报名参赛」入口', (await page.getByRole('link', { name: '报名参赛' }).count()) === 1)
    check('题目页无 4xx/5xx', newErrors(probErrMark).length === 0, newErrors(probErrMark).join(' | '))
    await context.close()
  }

  // ==================== 已报名参赛者：广播/答疑行为不受影响 ====================
  {
    const { context, page, httpErrors, requests } = await openPage('demo01')
    console.log('\n== 已报名参赛者（demo01 在 186）：答疑照常请求 ==')

    // 186 = 滚榜演示赛，demo01 已报名；若本机数据被重置则跳过
    const probeResponse = await page
      .goto(`${BASE}/contest/186`, { waitUntil: 'networkidle' })
      .then(() => true)
      .catch(() => false)
    if (!probeResponse) {
      console.log('  · 跳过：无法打开 /contest/186')
    } else {
      await page.waitForTimeout(4500) // 守卫每 3s 轮询一次，足够看到请求
      const commRequests = requests.filter((u) => u.includes('/communications')).length
      const hint = await page.locator('.contest-broadcast-hint').count()
      const panel = await page.locator('#contest-communications').count()
      check('已报名用户照常请求答疑接口', commRequests > 0, `${commRequests} 次`)
      check('已报名用户不显示报名提示', hint === 0, `hint=${hint}`)
      check('答疑/广播区正常渲染', panel === 1, `panel=${panel}`)
      check('已报名用户无 4xx/5xx', httpErrors.length === 0, [...new Set(httpErrors)].join(' | '))
    }
    await context.close()
  }
} finally {
  await browser.close()
  await cleanup()
  console.log('夹具已清理')
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exitCode = fail === 0 ? 0 : 1
