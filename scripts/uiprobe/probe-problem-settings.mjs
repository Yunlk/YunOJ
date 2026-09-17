// 题目设置验收：提供者 / 显示分数 / 题目附件（三块新能力）。
// 用法：node scripts/uiprobe/probe-problem-settings.mjs [--problem 437]
//
// 会真实写入再还原：提供者与 show_score 用原值回滚，附件上传后删除。
// 需要管理员凭据（.env 的 UI_ADMIN_*）与一个可写的已发布题目。
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { requireAdminCreds, STUDENT_USER, STUDENT_PASS } from './env.mjs'

const args = process.argv.slice(2)
const argOf = (n, d = '') => (args.indexOf(`--${n}`) >= 0 ? args[args.indexOf(`--${n}`) + 1] : d)
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const PROBLEM_ID = Number(argOf('problem', '437'))

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const admin = requireAdminCreds()
const adminToken = await getToken(admin.user, admin.pass)
const adminAuth = { Authorization: `Bearer ${adminToken}` }
const studentToken = await getToken(STUDENT_USER, STUDENT_PASS)
const studentAuth = { Authorization: `Bearer ${studentToken}` }

const getJSON = async (path, headers = adminAuth) => {
  const r = await fetch(`${API}${path}`, { headers })
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`)
  return r.json()
}

const original = await getJSON(`/problems/${PROBLEM_ID}`)
console.log(`\n== 题目设置：P${PROBLEM_ID}（原 provider=${JSON.stringify(original.provider)} show_score=${original.show_score}）==`)

// 后端 decodeJSON 开了 DisallowUnknownFields：请求体只能是 problemPayload 认识的字段，
// 因此不能用 GET 回来的 DTO 直接回灌（id/created_at/testcase_count 等会被拒）。
const payloadFrom = (p, overrides = {}) => ({
  title: p.title,
  statement: p.statement,
  input_format: p.input_format,
  output_format: p.output_format,
  hint: p.hint,
  samples: p.samples,
  time_limit_ms: p.time_limit_ms,
  memory_limit_kb: p.memory_limit_kb,
  difficulty: p.difficulty,
  tags: p.tags,
  type: p.type,
  checker_mode: p.checker_mode,
  spj_source: p.spj_source ?? '',
  interactor_source: p.interactor_source ?? '',
  hack_generator_source: p.hack_generator_source ?? '',
  hack_reference_source: p.hack_reference_source ?? '',
  hack_target_source: p.hack_target_source ?? '',
  testcase_scores: p.testcase_scores ?? [],
  submission_limit: p.submission_limit,
  status: p.status,
  provider: p.provider ?? '',
  show_score: p.show_score !== false,
  ...overrides,
})

const putProblem = async (body) => {
  const res = await fetch(`${API}/problems/${PROBLEM_ID}`, {
    method: 'PUT',
    headers: { ...adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

/** 同样的保存动作，但作用在任意题目上（得分脱敏要用「有提交的那道题」验证）。 */
const putProblemOn = async (problemId, body) => {
  const res = await fetch(`${API}/problems/${problemId}`, {
    method: 'PUT',
    headers: { ...adminAuth, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return res
}

const restore = async () => {
  await putProblem(payloadFrom(original))
}

// 上次运行若中途失败可能留下 probe- 前缀的附件，先清掉保证可重复运行
try {
  const stale = await getJSON(`/problems/${PROBLEM_ID}/attachments`)
  for (const item of stale.items.filter((a) => a.filename.startsWith('probe-'))) {
    await fetch(`${API}/problems/${PROBLEM_ID}/attachments/${item.id}`, { method: 'DELETE', headers: adminAuth })
  }
} catch {
  // 清理失败不阻断主流程
}

try {
  /* ---------- 1. 提供者 + 显示分数 ---------- */
  const put = await putProblem(payloadFrom(original, { provider: 'probe 来源 Codeforces 1900E', show_score: false }))
  check('保存题目设置（PUT /problems/:id）成功', put.ok, `${put.status} ${put.ok ? '' : await put.text()}`)
  const saved = await getJSON(`/problems/${PROBLEM_ID}`)
  check('提供者已持久化', saved.provider === 'probe 来源 Codeforces 1900E', JSON.stringify(saved.provider))
  check('显示分数开关已持久化（false）', saved.show_score === false, String(saved.show_score))

  const publicView = await (await fetch(`${API}/problems/${PROBLEM_ID}`)).json()
  check('提供者对匿名可见', publicView.provider === 'probe 来源 Codeforces 1900E', JSON.stringify(publicView.provider))
  check('show_score 对匿名可见（前端据此隐藏得分）', publicView.show_score === false, String(publicView.show_score))

  /* ---------- 2. show_score=false 时的得分脱敏 ---------- */
  // 用「该账号最近一条提交」所在的题做验证，避免依赖固定题目有没有提交记录。
  const studentSubs = await getJSON('/submissions?size=5', studentAuth)
  const sample = (studentSubs.items ?? [])[0]
  if (!sample) {
    console.log(`  ! ${STUDENT_USER} 没有任何提交，跳过得分脱敏断言`)
  } else {
    const targetId = sample.problem_id
    const targetOriginal = await getJSON(`/problems/${targetId}`)
    try {
      await putProblemOn(targetId, payloadFrom(targetOriginal, { show_score: false }))
      const asStudent = await (await fetch(`${API}/submissions/${sample.id}`, { headers: studentAuth })).json()
      const asAdmin = await (await fetch(`${API}/submissions/${sample.id}`, { headers: adminAuth })).json()
      check(`关闭显示分数（P${targetId}）后选手看不到得分`, asStudent.score === 0, `score=${asStudent.score}`)
      check('关闭显示分数后选手看不到逐点得分', asStudent.case_scores === null, JSON.stringify(asStudent.case_scores))
      check('管理员仍能看到真实得分', asAdmin.score === sample.score && asAdmin.case_scores !== null,
        `管理员 score=${asAdmin.score} cases=${asAdmin.case_scores === null ? 'null' : 'ok'}`)

      const listAsStudent = await getJSON(`/submissions?problem_id=${targetId}&size=1`, studentAuth)
      check('提交列表里的得分同样被抹掉', listAsStudent.items[0].score === 0, String(listAsStudent.items[0].score))

      await putProblemOn(targetId, payloadFrom(targetOriginal, { show_score: true }))
      const reopened = await (await fetch(`${API}/submissions/${sample.id}`, { headers: studentAuth })).json()
      check('打开显示分数后选手重新看到得分', reopened.score === sample.score, `${reopened.score} vs ${sample.score}`)
    } finally {
      await putProblemOn(targetId, payloadFrom(targetOriginal))
    }
  }

  /* ---------- 3. 附件：上传 / 列表 / 下载 / 删除 ---------- */
  console.log('\n== 题目附件 ==')
  const filename = 'probe-附件 样例.zip'
  const content = Buffer.from(`probe attachment ${Date.now()}`)
  const form = new FormData()
  form.append('file', new Blob([content], { type: 'application/zip' }), filename)
  const uploadRes = await fetch(`${API}/problems/${PROBLEM_ID}/attachments`, {
    method: 'POST',
    headers: adminAuth,
    body: form,
  })
  const uploaded = await uploadRes.json().catch(() => null)
  check('上传附件返回 201', uploadRes.status === 201, String(uploadRes.status))
  check('附件保留了原始文件名（含中文与空格）', uploaded?.filename === filename, JSON.stringify(uploaded?.filename))
  check('附件记录了字节数', uploaded?.size_bytes === content.length, `${uploaded?.size_bytes} vs ${content.length}`)

  const list = await getJSON(`/problems/${PROBLEM_ID}/attachments`)
  const mine = list.items.find((a) => a.id === uploaded?.id)
  check('附件列表包含刚上传的文件', Boolean(mine), JSON.stringify(list.items.map((a) => a.filename)))
  check('列表不泄露服务器存储路径', mine !== undefined && !('storage_path' in mine), Object.keys(mine ?? {}).join(','))

  const anonList = await (await fetch(`${API}/problems/${PROBLEM_ID}/attachments`)).json()
  check('已发布题目的附件对匿名可读', anonList.items.some((a) => a.id === uploaded?.id))

  const dl = await fetch(`${API}/problems/${PROBLEM_ID}/attachments/${uploaded?.id}/download`)
  const dlBytes = Buffer.from(await dl.arrayBuffer())
  check('下载返回 200 且内容一致', dl.status === 200 && dlBytes.equals(content), `${dl.status} ${dlBytes.length}B`)
  const disposition = dl.headers.get('content-disposition') ?? ''
  check('下载头带文件名（RFC 5987 兼容中文）', disposition.includes('attachment') && disposition.includes("filename*=UTF-8''"),
    disposition)
  check('下载头禁止类型嗅探', dl.headers.get('x-content-type-options') === 'nosniff',
    String(dl.headers.get('x-content-type-options')))

  /* ---------- 4. 界面：题目设置标签与附件展示 ---------- */
  console.log('\n== 界面 ==')
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), adminToken)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => { if (r.status() >= 400) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`) })

  await page.goto(`${BASE}/problem/${PROBLEM_ID}/edit?tab=settings`, { waitUntil: 'networkidle' })
  const activeTabs = await page.locator('.problem-admin-tabs .tab.active').allInnerTexts()
  check('题目设置标签唯一选中', activeTabs.length === 1 && activeTabs[0].trim() === '题目设置', activeTabs.join('/'))
  check('题目设置里能改提供者', (await page.locator('#p-provider').inputValue()) === 'probe 来源 Codeforces 1900E')
  check('题目设置里有显示分数开关', (await page.locator('#p-show-score').count()) === 1)
  check('题目设置里有附件表（新上传的文件在列）',
    (await page.locator('.attachment-table .attachment-name', { hasText: 'probe-' }).count()) === 1)
  check('保存按钮为「保存并去配置数据」',
    (await page.getByRole('button', { name: '保存并去配置数据' }).count()) === 1)
  check('题面设置标签仍可切换', (await page.locator('.problem-admin-tabs .tab', { hasText: '题面设置' }).count()) === 1)

  await page.goto(`${BASE}/problem/${PROBLEM_ID}`, { waitUntil: 'networkidle' })
  const metaText = (await page.locator('.wb-meta-row').innerText()).replace(/\s+/g, ' ')
  check('题目页展示提供者', metaText.includes('probe 来源 Codeforces 1900E'), metaText.slice(0, 80))
  const attachments = await page.locator('.attachment-list .attachment-link').count()
  check('题目页出现附件区', attachments >= 1, `${attachments} 个`)
  check('题目页附件文件名可读', (await page.locator('.attachment-list').innerText()).includes('probe-'))
  await browser.close()
  check('页面无脚本错误与 4xx/5xx', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '))

  /* ---------- 5. 删除附件 + 还原题目 ---------- */
  console.log('\n== 清理 ==')
  const del = await fetch(`${API}/problems/${PROBLEM_ID}/attachments/${uploaded?.id}`, {
    method: 'DELETE',
    headers: adminAuth,
  })
  check('删除附件返回 204', del.status === 204, String(del.status))
  const after = await getJSON(`/problems/${PROBLEM_ID}/attachments`)
  check('删除后附件不在列表', !after.items.some((a) => a.id === uploaded?.id))
  const dlAfter = await fetch(`${API}/problems/${PROBLEM_ID}/attachments/${uploaded?.id}/download`)
  check('删除后下载返回 404', dlAfter.status === 404, String(dlAfter.status))
} finally {
  await restore()
  const restored = await getJSON(`/problems/${PROBLEM_ID}`)
  check('题目已还原（provider/show_score 回到原值）',
    (restored.provider ?? '') === (original.provider ?? '') && (restored.show_score !== false) === (original.show_score !== false),
    `provider=${JSON.stringify(restored.provider)} show_score=${restored.show_score}`)
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exitCode = fail === 0 ? 0 : 1
