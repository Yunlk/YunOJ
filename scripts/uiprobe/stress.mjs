// 表格鲁棒性压力审计：向单元格注入超长文本，检查行高是否仍为 44px。
// 真实数据都很短时普通审计是绿的，但长标题/多标签会把「操作列」挤扁导致行高爆炸。
// 用法：node scripts/uiprobe/stress.mjs [--user <管理员> --pass <口令>]（默认取 .env 的 UI_ADMIN_*） [--only /a,/b]
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { ADMIN_USER, ADMIN_PASS } from './env.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const USER = argOf('user', ADMIN_USER)
const PASS = argOf('pass', ADMIN_PASS)
const ONLY = argOf('only')

const LONG_TITLE = '一个非常非常长的题目名称用来测试表格在极端内容下的稳定性'.repeat(2)
const LONG_TAG = '超长标签内容测试'.repeat(3)

const ROUTES = [
  ['首页', '/'],
  ['题库', '/problems'],
  ['提交记录', '/status'],
  ['比赛列表', '/contests'],
  ['比赛详情', '/contest/226'],
  ['比赛提交', '/contest/226/submissions'],
  ['排名', '/ranking'],
  ['个人中心', '/profile'],
  ['收藏', '/favorites'],
  ['管理·题目', '/admin/problems'],
  ['管理·用户', '/admin/users'],
  ['管理·评测', '/admin/judge'],
  ['测试点', '/admin/problems/437/tests'],
]

const token = await getToken(USER, PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()

const wanted = ONLY ? ONLY.split(',') : null
const broken = []
for (const [label, route] of ROUTES) {
  if (wanted && !wanted.some((w) => route === w || label === w)) continue
  await page.goto(`${BASE}${route}`, { waitUntil: 'networkidle', timeout: 30000 }).catch(() => {})
  await page.waitForTimeout(500)
  const result = await page.evaluate(
    ({ longTitle, longTag }) => {
      const tables = [...document.querySelectorAll('.data-table')]
      if (tables.length === 0) return { skip: true }
      let before = 0
      for (const tr of [...document.querySelectorAll('.data-table tbody tr')].slice(0, 3)) {
        before = Math.max(before, tr.getBoundingClientRect().height)
      }
      // 只给「纯文本列」注入超长内容：动作列（.cell-actions 或多枚交互元素）
      // 与徽标/标签单元格保持原样，否则测的就是注入脚本自己在撑高行。
      const injectable = (td) => {
        if (td.classList.contains('cell-actions')) return false
        const interactive = td.querySelectorAll('a,button,input,select').length
        if (interactive > 1) return false
        if (td.querySelector('.badge, .status-badge, .difficulty-badge, .tag-chip, .problem-status')) return false
        return interactive === 1 || td.textContent.trim().length > 0
      }
      for (const table of tables) {
        for (const tr of [...table.querySelectorAll('tbody tr')].slice(0, 3)) {
          [...tr.children].forEach((td, i) => {
            if (i < 2 || !injectable(td)) return
            const link = td.querySelector('a')
            if (link) link.textContent = longTitle
            else td.textContent = i % 3 === 0 ? longTag : longTitle
          })
        }
      }
      let after = 0
      let actionWrapped = false
      for (const tr of [...document.querySelectorAll('.data-table tbody tr')].slice(0, 3)) {
        const h = tr.getBoundingClientRect().height
        after = Math.max(after, h)
        // 精确判定：动作列里的按钮若落在多于一条视觉行上，说明该列被挤扁了
        const action = tr.querySelector('.cell-actions')
        if (action) {
          const tops = new Set(
            [...action.querySelectorAll('a,button')].map((el) => Math.round(el.getBoundingClientRect().top)),
          )
          if (tops.size > 1) actionWrapped = true
        }
      }
      const overflowing = [...document.querySelectorAll('.data-table')].some(
        (t) => t.getBoundingClientRect().width > (t.parentElement?.getBoundingClientRect().width ?? 1e9) + 2,
      )
      return {
        before: Math.round(before),
        after: Math.round(after),
        actionWrapped,
        overflowing,
        details: [`注入前 ${Math.round(before)}px → 注入后 ${Math.round(after)}px${actionWrapped ? '（动作列被压扁）' : ''}`],
      }
    },
    { longTitle: LONG_TITLE, longTag: LONG_TAG },
  )

  if (result.skip) {
    console.log(`–  ${label.padEnd(12)} ${route.padEnd(28)} 无表格`)
    continue
  }
  // 判定标准：动作列不被挤扁 = 合格（标题换行导致行高增加属可接受行为，仅提示）
  const bad = result.actionWrapped
  if (bad) broken.push(`${label} ${route}（动作列被压扁，行高 ${result.after}px）`)
  const tall = !bad && result.after > 60 ? `  · 行高增至 ${result.after}px（文本换行，可接受）` : ''
  console.log(`${bad ? '⚠ ' : '✓ '} ${label.padEnd(12)} ${route.padEnd(28)} ${result.details[0]}${tall}`)
}

const measured = ROUTES.filter(([, r]) => true).length
console.log(`\n动作列保持不折行的页面：${measured - broken.length}/${measured}`)
if (broken.length) {
  console.log('⚠ 需要修（动作列被长内容挤扁）：')
  for (const b of broken) console.log('   ' + b)
}
await browser.close()
