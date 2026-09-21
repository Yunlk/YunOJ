// 函数题（LeetCode 风格）端到端验收。
//
// 覆盖：建题 → 配语言模板（含占位符校验）→ 传测试点 → 发布 →
//       提交「只写函数体」→ 必须 AC 且拿满分；
//       提交「完整程序」→ 也必须 AC（不能被拼装逻辑弄成重复 main）；
//       提交缺占位符的模板 → 保存被拒；
//       非函数题带模板 → 保存被拒；
//       选手端能拿到初始代码、拿不到模板；
//       自测（/test）对函数题同样走拼装。
// 跑完自动删除测试题目与测试数据。
import { chromium } from 'playwright-core'
import { getToken } from './auth.mjs'
import { requireAdminCreds, STUDENT_USER, STUDENT_PASS } from './env.mjs'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'

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

const admin = requireAdminCreds()
const adminToken = await getToken(admin.user, admin.pass)
const adminAuth = { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' }
const studentToken = await getToken(STUDENT_USER, STUDENT_PASS)
const studentAuth = { Authorization: `Bearer ${studentToken}`, 'Content-Type': 'application/json' }

const CPP_TEMPLATE = `#include <bits/stdc++.h>
using namespace std;

{{code}}

int main() {
    int a, b;
    if (!(cin >> a >> b)) return 0;
    cout << add(a, b) << endl;
    return 0;
}`

const CPP_INITIAL = `int add(int a, int b) {
    // TODO: 在这里实现
    return 0;
}`

const basePayload = (overrides = {}) => ({
  title: 'probe 函数题（临时）',
  statement: '读入两个整数，输出它们的和。**你只需要实现 `add` 函数。**',
  input_format: '两个整数 a b',
  output_format: '一个整数 a+b',
  hint: '',
  samples: [{ input: '1 2', output: '3', note: '' }],
  time_limit_ms: 1000,
  memory_limit_kb: 262144,
  difficulty: 1,
  tags: ['probe'],
  type: 'function',
  checker_mode: 'token',
  spj_source: '',
  interactor_source: '',
  hack_generator_source: '',
  hack_reference_source: '',
  hack_target_source: '',
  testcase_scores: [],
  submission_limit: 0,
  status: 'draft',
  provider: '',
  show_score: true,
  harnesses: { cpp: { template: CPP_TEMPLATE, initial_code: CPP_INITIAL } },
  ...overrides,
})

let problemId = 0
let contestId = 0
let attachmentId = 0
const cleanup = async () => {
  if (attachmentId && problemId) {
    await fetch(`${API}/problems/${problemId}/attachments/${attachmentId}`, {
      method: 'DELETE', headers: adminAuth,
    })
  }
  if (contestId) {
    await fetch(`${API}/contests/${contestId}`, { method: 'DELETE', headers: adminAuth })
  }
  if (!problemId) return
  await fetch(`${API}/problems/${problemId}`, { method: 'DELETE', headers: adminAuth })
}

try {
  /* ---------- 1. 校验：函数题的模板约束 ---------- */
  console.log('\n== 校验 ==')
  const noPlaceholder = await fetch(`${API}/problems`, {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify(basePayload({ harnesses: { cpp: { template: 'int main(){}', initial_code: '' } } })),
  })
  check('模板缺少 {{code}} 占位符时创建被拒', noPlaceholder.status === 400, String(noPlaceholder.status))

  const noHarness = await fetch(`${API}/problems`, {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify(basePayload({ harnesses: {} })),
  })
  check('函数题不给任何语言模板时创建被拒', noHarness.status === 400, String(noHarness.status))

  const strayHarness = await fetch(`${API}/problems`, {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify(basePayload({ type: 'standard' })),
  })
  check('非函数题带语言模板时创建被拒', strayHarness.status === 400, String(strayHarness.status))

  // 初始代码是选手打开 IDE 看到的函数骨架（力扣风格），留空必须被拒。
  const emptyInitial = await fetch(`${API}/problems`, {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify(basePayload({ harnesses: { cpp: { template: CPP_TEMPLATE, initial_code: '   ' } } })),
  })
  check('初始代码为空时创建被拒（否则选手面对空编辑器）', emptyInitial.status === 400, String(emptyInitial.status))

  /* ---------- 2. 建题 ---------- */
  console.log('\n== 建立函数题 ==')
  const created = await fetch(`${API}/problems`, {
    method: 'POST', headers: adminAuth, body: JSON.stringify(basePayload()),
  })
  const problem = await created.json()
  problemId = problem?.id ?? 0
  check('函数题创建成功', created.status === 201 && problemId > 0, `${created.status} ${JSON.stringify(problem).slice(0, 120)}`)

  const detail = await (await fetch(`${API}/problems/${problemId}`, { headers: adminAuth })).json()
  check('详情里 type 为 function', detail.type === 'function', String(detail.type))
  check('管理员能读回模板', detail.harnesses?.cpp?.template?.includes('{{code}}') === true)
  check('管理员能读回初始代码', detail.harnesses?.cpp?.initial_code === CPP_INITIAL)

  const asStudent = await (await fetch(`${API}/problems/${problemId}`, { headers: studentAuth })).json()
  check('选手拿不到驱动模板（只给初始代码）', asStudent.harnesses === undefined,
    JSON.stringify(Object.keys(asStudent.harnesses ?? {})))
  check('未发布题目选手看不到（404/403）', asStudent.error !== undefined || asStudent.id === undefined,
    JSON.stringify(asStudent).slice(0, 80))

  /* ---------- 3. 测试点 ---------- */
  console.log('\n== 测试点与发布 ==')
  const addCase = async (inText, outText, score) => {
    const form = new FormData()
    form.append('in', new Blob([inText]), 'in.txt')
    form.append('out', new Blob([outText]), 'out.txt')
    form.append('score', String(score))
    return fetch(`${API}/problems/${problemId}/testcases`, { method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form })
  }
  const c1 = await addCase('1 2\n', '3\n', 50)
  const c2 = await addCase('10 20\n', '30\n', 50)
  check('测试点 1 添加成功', c1.status === 201, String(c1.status))
  check('测试点 2 添加成功', c2.status === 201, String(c2.status))

  const published = await fetch(`${API}/problems/${problemId}`, {
    method: 'PUT', headers: adminAuth, body: JSON.stringify(basePayload({ status: 'published' })),
  })
  check('函数题可以发布（总分 100）', published.status === 200, `${published.status} ${published.ok ? '' : await published.text()}`)

  // 发布后选手应当能拿到初始代码
  const studentView = await (await fetch(`${API}/problems/${problemId}`, { headers: studentAuth })).json()
  check('发布后选手能读到初始代码（用于预填编辑器）', studentView.initial_codes?.cpp === CPP_INITIAL,
    JSON.stringify(studentView.initial_codes))

  /* ---------- 4. 提交：只写函数体 ---------- */
  console.log('\n== 提交评测 ==')
  // 后端对同一用户有 10 秒提交间隔限流（这是产品行为，不是 bug）：
  // 连发会拿到 429 而没有 id，因此这里串行提交并在必要时等待重试。
  const submit = async (code, language = 'cpp') => {
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(`${API}/submissions`, {
        method: 'POST', headers: studentAuth,
        body: JSON.stringify({ problem_id: problemId, language, code }),
      })
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 11000))
        continue
      }
      const body = await res.json()
      if (!res.ok) throw new Error(`提交失败 ${res.status}: ${JSON.stringify(body)}`)
      return { status: res.status, id: body?.id ?? 0 }
    }
    throw new Error('提交持续被限流，未取得提交 ID')
  }
  const waitVerdict = async (id, timeoutMs = 120000) => {
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const res = await fetch(`${API}/submissions/${id}`, { headers: adminAuth })
      const s = await res.json()
      if (s.status && !['pending', 'judging', 'queued', 'running'].includes(s.status)) return s
      await new Promise((r) => setTimeout(r, 900))
    }
    return null
  }

  const bodyOnly = await submit('int add(int a, int b) {\n    return a + b;\n}')
  const v1 = await waitVerdict(bodyOnly.id)
  check('只写函数体 → Accepted', v1?.status === 'accepted', `${v1?.status} ${v1?.compile_error ?? ''}`.slice(0, 200))
  check('只写函数体 → 满分 100', v1?.score === 100, `score=${v1?.score}`)

  // 完整程序也必须能过（拼装逻辑不能制造重复 main）
  const fullProgram = `#include <iostream>
int main() {
    int a, b;
    std::cin >> a >> b;
    std::cout << a + b << std::endl;
    return 0;
}`
  const full = await submit(fullProgram)
  const v2 = await waitVerdict(full.id)
  check('提交完整程序 → 也 Accepted（不会重复定义 main）', v2?.status === 'accepted',
    `${v2?.status} ${v2?.compile_error ?? ''}`.slice(0, 300))

  // 错误答案要判 WA，而不是因为拼装问题变成编译错误
  const wrong = await submit('int add(int a, int b) {\n    return a - b;\n}')
  const v3 = await waitVerdict(wrong.id)
  check('错误函数体 → Wrong Answer（不是编译错误）', v3?.status === 'wrong_answer',
    `${v3?.status} ${v3?.compile_error ?? ''}`.slice(0, 200))

  // 没配模板的语言应当给出明确原因
  const pySubmit = await submit('def add(a, b):\n    return a + b', 'python')
  const v4 = await waitVerdict(pySubmit.id)
  check('未配置模板的语言给出明确提示', v4?.status === 'compile_error' && /模板/.test(v4?.compile_error ?? ''),
    `${v4?.status} ${v4?.compile_error ?? ''}`.slice(0, 160))

  /* ---------- 5. 自测也走拼装 ---------- */
  const runRes = await fetch(`${API}/problems/${problemId}/test`, {
    method: 'POST', headers: studentAuth,
    body: JSON.stringify({ language: 'cpp', code: 'int add(int a, int b) {\n    return a + b;\n}', optimize: true, input: '3 4\n' }),
  })
  const runBody = await runRes.json().catch(() => null)
  check('自测：函数体拼装后能运行并输出 7',
    runRes.ok && String(runBody?.stdout ?? '').trim() === '7', JSON.stringify(runBody).slice(0, 200))

  /* ---------- 6. 管理端界面 ---------- */
  console.log('\n== 界面 ==')
  const browser = await chromium.launch({ channel: 'chrome' })
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), adminToken)
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`HTTP ${r.status()} ${r.url().replace(BASE, '')}`)
  })

  await page.goto(`${BASE}/problem/${problemId}/edit?tab=settings`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /函数题/ }).first().click()
  await page.waitForTimeout(400)
  check('题目设置里出现「函数题语言模板」区', (await page.locator('.harness-fieldset').count()) === 1)
  check('模板编辑器带出该语言的模板内容',
    (await page.locator('#h-template').inputValue()).includes('{{code}}'))
  check('初始代码也带出来了', (await page.locator('#h-initial').inputValue()).includes('add'))
  check('可以添加其它语言的模板', (await page.locator('.harness-add').count()) === 1)

  await page.goto(`${BASE}/problem/${problemId}`, { waitUntil: 'networkidle' })
  // 读 Monaco 渲染出的代码行：.monaco-editor 整体 innerText 只包含行号栏，读不到代码。
  await page
    .waitForFunction(
      () => document.querySelectorAll('.view-lines .view-line').length > 0,
      { timeout: 15000 },
    )
    .catch(() => {})
  const editorText = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.view-lines .view-line'))
      .map((l) => l.textContent)
      .join('\n'),
  )
  check('管理员预览时编辑器也预填骨架', /add/.test(editorText), editorText.slice(0, 80).replace(/\s+/g, ' '))

  // 用选手身份再验一次：预填是给选手用的，必须确认选手侧真的能看到骨架。
  const studentCtx = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  await studentCtx.addInitScript((t) => localStorage.setItem('yunoj_token', t), studentToken)
  const studentPage = await studentCtx.newPage()
  await studentPage.goto(`${BASE}/problem/${problemId}`, { waitUntil: 'networkidle' })
  await studentPage
    .waitForFunction(
      () => document.querySelectorAll('.view-lines .view-line').length > 0,
      { timeout: 15000 },
    )
    .catch(() => {})
  const studentEditor = await studentPage.evaluate(() =>
    Array.from(document.querySelectorAll('.view-lines .view-line'))
      .map((l) => l.textContent)
      .join('\n'),
  )
  check('选手编辑器预填了函数骨架（含 add）', /add/.test(studentEditor),
    studentEditor.slice(0, 80).replace(/\s+/g, ' '))
  await studentCtx.close()

  /* ---------- 6. 函数题 + Exact 判定（复用标准判定通路） ---------- */
  console.log('\n== 函数题 + Exact 判定 ==')
  const exactCreated = await fetch(`${API}/problems`, {
    method: 'POST', headers: adminAuth,
    body: JSON.stringify(basePayload({ title: 'probe 函数题 exact（临时）', checker_mode: 'exact' })),
  })
  const exactProblem = await exactCreated.json().catch(() => null)
  const exactId = exactProblem?.id ?? 0
  check('函数题允许 Exact 判定', exactCreated.status === 201 && exactId > 0,
    `${exactCreated.status} ${JSON.stringify(exactProblem).slice(0, 120)}`)
  if (exactId) {
    try {
      const f = new FormData()
      // 期望输出带尾随空行：token 判定会忽略，exact 判定必须要求逐字节一致
      f.append('in', new Blob(['2 3\n']), 'in.txt')
      f.append('out', new Blob(['5\n\n']), 'out.txt')
      f.append('score', '100')
      await fetch(`${API}/problems/${exactId}/testcases`, {
        method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: f,
      })
      await fetch(`${API}/problems/${exactId}`, {
        method: 'PUT', headers: adminAuth,
        body: JSON.stringify(basePayload({ title: 'probe 函数题 exact（临时）', checker_mode: 'exact', status: 'published' })),
      })
      let exactSubId = 0
      for (let attempt = 0; attempt < 8 && !exactSubId; attempt++) {
        const res = await fetch(`${API}/submissions`, {
          method: 'POST', headers: studentAuth,
          body: JSON.stringify({ problem_id: exactId, language: 'cpp', code: 'int add(int a, int b) {\n    return a + b;\n}' }),
        })
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 11000))
          continue
        }
        const body = await res.json()
        if (!res.ok) throw new Error(`提交失败 ${res.status}: ${JSON.stringify(body)}`)
        exactSubId = body?.id ?? 0
      }
      const ev = await waitVerdict(exactSubId)
      // 期望输出 "5\n\n"、选手输出 "5\n"：exact 模式下 token 相同但空白不同 → 判 PE
      // （CompareOutput 的设计：exact 且 token 相同则 PE，否则 WA；token 模式会直接 AC）。
      // 拿到 PE 即证明函数题确实复用了 exact 判定通路，而不是退化成 token。
      check('Exact 判定下空白差异判 PE（证明确实走了 exact 通路）',
        ev?.status === 'presentation_error', `${ev?.status} ${ev?.compile_error ?? ''}`.slice(0, 160))
    } finally {
      await fetch(`${API}/problems/${exactId}`, { method: 'DELETE', headers: adminAuth })
      const eg = await fetch(`${API}/problems/${exactId}`, { headers: adminAuth })
      check('临时 exact 函数题已清理', eg.status === 404, String(eg.status))
    }
  }

  /* ---------- 7. 迁移包往返：导出 → 导入后模板必须还在 ---------- */
  console.log('\n== 迁移包往返 ==')
  let importedId = 0
  try {
    const exp = await fetch(`${API}/problems/${problemId}/package`, { headers: adminAuth })
    check('函数题可以导出迁移包', exp.ok, String(exp.status))
    const zipBuf = Buffer.from(await exp.arrayBuffer())
    check('迁移包非空', zipBuf.length > 0, `${zipBuf.length} bytes`)

    const form = new FormData()
    form.append('file', new Blob([zipBuf]), 'problem.zip')
    const imp = await fetch(`${API}/problems/import`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: form,
    })
    const impBody = await imp.json().catch(() => null)
    // 导入接口返回 201 与嵌套结构 { problem: { id, ... } }
    importedId = impBody?.problem?.id ?? impBody?.id ?? 0
    check('迁移包可以导入', imp.ok && importedId > 0, `${imp.status} ${JSON.stringify(impBody).slice(0, 160)}`)
    if (importedId) {
      const imported = await (await fetch(`${API}/problems/${importedId}`, { headers: adminAuth })).json()
      check('导入后题型仍是函数题', imported.type === 'function', String(imported.type))
      check('导入后驱动模板完整保留',
        imported.harnesses?.cpp?.template === CPP_TEMPLATE,
        JSON.stringify(imported.harnesses?.cpp?.template ?? null).slice(0, 90))
      check('导入后初始代码完整保留', imported.harnesses?.cpp?.initial_code === CPP_INITIAL)
    }
  } finally {
    if (importedId) await fetch(`${API}/problems/${importedId}`, { method: 'DELETE', headers: adminAuth })
  }

  /* ---------- 8. 比赛内的函数题：同样预填、同样拼装 ---------- */
  console.log('\n== 比赛内函数题 ==')
  // 建一场「进行中」的比赛，把函数题挂进去，用选手身份报名后验证：
  // 比赛题面接口要给出 initial_codes，比赛提交也要走拼装（judge 按题目标 type 判定）。
  const now = Date.now()
  const contestPayload = {
    title: 'probe 函数题比赛（临时）',
    mode: 'ACM', feedback: 'realtime', score_mode: 'all_or_nothing',
    penalty_minutes: 20, freeze_duration_minutes: 0, dynamic_delay_minutes: 0,
    rank_keys: [], start_time: new Date(now - 3600_000).toISOString(),
    end_time: new Date(now + 3600_000).toISOString(),
    description: '', cover_image: '', visibility: 'public',
    reg_start_time: null, reg_end_time: null,
    submission_limit: 0, registration_mode: 'individual', max_team_size: 1,
    allow_team_edit: false, pretest_only: false, hacking_enabled: false,
  }
  const contestRes = await fetch(`${API}/contests`, {
    method: 'POST', headers: adminAuth, body: JSON.stringify(contestPayload),
  })
  const contestBody = await contestRes.json().catch(() => null)
  contestId = contestBody?.id ?? contestBody?.contest?.id ?? 0
  check('临时比赛创建成功', contestRes.ok && contestId > 0, `${contestRes.status} ${JSON.stringify(contestBody).slice(0, 140)}`)

  if (contestId) {
    const added = await fetch(`${API}/contests/${contestId}/problems`, {
      method: 'POST', headers: adminAuth,
      body: JSON.stringify({ problem_id: problemId, display_id: 'A', sort_order: 1, score: null, submission_limit: null, theme_color: '' }),
    })
    check('函数题加入比赛成功', added.ok, `${added.status} ${added.ok ? '' : await added.text()}`)

    const reg = await fetch(`${API}/contests/${contestId}/register`, {
      method: 'POST', headers: studentAuth, body: JSON.stringify({ team_name: '' }),
    })
    check('选手报名成功', reg.ok, `${reg.status} ${reg.ok ? '' : await reg.text()}`)

    const cv = await fetch(`${API}/contests/${contestId}/problems/${problemId}`, { headers: studentAuth })
    const cvBody = await cv.json().catch(() => null)
    check('比赛题面给选手下发初始代码', cvBody?.problem?.initial_codes?.cpp === CPP_INITIAL,
      JSON.stringify(cvBody?.problem?.initial_codes))
    check('比赛题面不下发驱动模板', cvBody?.problem?.harnesses === undefined,
      JSON.stringify(Object.keys(cvBody?.problem?.harnesses ?? {})))

    // 比赛提交同样要拼装（选手只写函数体）
    const contestSubmit = async (code, language = 'cpp') => {
      for (let attempt = 0; attempt < 8; attempt++) {
        const res = await fetch(`${API}/contests/${contestId}/submit`, {
          method: 'POST', headers: studentAuth,
          body: JSON.stringify({ problem_id: problemId, language, code }),
        })
        if (res.status === 429) {
          await new Promise((r) => setTimeout(r, 11000))
          continue
        }
        const body = await res.json()
        if (!res.ok) throw new Error(`比赛提交失败 ${res.status}: ${JSON.stringify(body)}`)
        return { id: body?.id ?? 0 }
      }
      throw new Error('比赛提交持续被限流')
    }
    const cSub = await contestSubmit('int add(int a, int b) {\n    return a + b;\n}')
    const cv1 = await waitVerdict(cSub.id)
    check('比赛内「只写函数体」→ Accepted', cv1?.status === 'accepted',
      `${cv1?.status} ${cv1?.compile_error ?? ''}`.slice(0, 200))

    // 比赛内界面：编辑器同样预填骨架
    const contestCtx = await browser.newContext({ viewport: { width: 1440, height: 950 } })
    await contestCtx.addInitScript((t) => localStorage.setItem('yunoj_token', t), studentToken)
    const contestPage = await contestCtx.newPage()
    await contestPage.goto(`${BASE}/contest/${contestId}/problem/${problemId}`, { waitUntil: 'networkidle' })
    await contestPage
      .waitForFunction(() => document.querySelectorAll('.view-lines .view-line').length > 0, { timeout: 15000 })
      .catch(() => {})
    const contestEditor = await contestPage.evaluate(() =>
      Array.from(document.querySelectorAll('.view-lines .view-line')).map((l) => l.textContent).join('\n'),
    )
    check('比赛内解题页编辑器预填函数骨架', /add/.test(contestEditor),
      contestEditor.slice(0, 80).replace(/\s+/g, ' '))

    /* ---- 比赛内附件：必须显示（比赛专用题常为草稿，公共可见性规则看不到它） ---- */
    // 关键点：把题目切成草稿态。比赛专用题绝大多数是草稿，
    // 此时「已发布题目对所有人可见」的规则不适用，只有参赛者才该看到附件。
    const toDraft = await fetch(`${API}/problems/${problemId}`, {
      method: 'PUT', headers: adminAuth, body: JSON.stringify(basePayload({ status: 'draft' })),
    })
    check('可以把比赛题切回草稿态（模拟比赛专用题）', toDraft.ok, String(toDraft.status))

    const attForm = new FormData()
    attForm.append('file', new Blob(['probe-attachment']), 'probe-比赛附件.txt')
    const attUp = await fetch(`${API}/problems/${problemId}/attachments`, {
      method: 'POST', headers: { Authorization: `Bearer ${adminToken}` }, body: attForm,
    })
    const attBody = await attUp.json().catch(() => null)
    attachmentId = attBody?.id ?? 0
    check('管理员可给题目上传附件', attUp.ok && attachmentId > 0,
      `${attUp.status} ${JSON.stringify(attBody).slice(0, 120)}`)

    if (attachmentId) {
      // 选手经比赛报名后必须能列出并下载草稿题的附件（这正是修复点之前会 404 的场景）
      const stuList = await fetch(`${API}/problems/${problemId}/attachments`, { headers: studentAuth })
      const stuBody = await stuList.json().catch(() => null)
      check('参赛选手能列出草稿比赛题的附件',
        stuList.ok && (stuBody?.items ?? []).some((a) => a.id === attachmentId),
        `${stuList.status} ${JSON.stringify(stuBody).slice(0, 140)}`)

      const stuDl = await fetch(`${API}/problems/${problemId}/attachments/${attachmentId}/download`, {
        headers: studentAuth,
      })
      check('参赛选手能下载草稿比赛题的附件', stuDl.ok, String(stuDl.status))

      // 未报名/未登录的人不应经此放行（草稿题 + 非参赛者 → 404）
      const anonList = await fetch(`${API}/problems/${problemId}/attachments`)
      check('未登录者看不到草稿比赛题的附件', anonList.status === 404, String(anonList.status))
      const anonDl = await fetch(`${API}/problems/${problemId}/attachments/${attachmentId}/download`)
      check('未登录者下载草稿比赛题附件返回 404', anonDl.status === 404, String(anonDl.status))

      // 界面上附件区必须渲染出来
      await contestPage.reload({ waitUntil: 'networkidle' })
      const attCount = await contestPage.locator('.attachment-list .attachment-link').count()
      check('比赛内解题页显示附件区', attCount >= 1, `${attCount} 个`)
    }

    /* ---- 「恢复函数」按钮：改坏代码后一键还原骨架 ---- */
    // 走真实交互：点编辑器 → 全选 → 输入垃圾代码 → 按钮出现 → 点击 → 确认 → 还原
    const editorBox = contestPage.locator('.monaco-editor').first()
    await editorBox.click()
    await contestPage.keyboard.press('Control+A')
    await contestPage.keyboard.type('int add(int a,int b){return a-b;} // 改坏了')
    await contestPage.waitForTimeout(600)
    const restoreBtn = contestPage.getByRole('button', { name: '恢复函数' })
    check('改坏代码后出现「恢复函数」按钮', (await restoreBtn.count()) === 1)
    contestPage.once('dialog', (d) => d.accept())
    await restoreBtn.click()
    await contestPage.waitForTimeout(600)
    const restored = await contestPage.evaluate(() =>
      Array.from(document.querySelectorAll('.view-lines .view-line')).map((l) => l.textContent).join('\n'),
    )
    check('点「恢复函数」后编辑器还原成函数骨架',
      /add/.test(restored) && !/改坏了/.test(restored), restored.slice(0, 80).replace(/\s+/g, ' '))
    check('与骨架一致时按钮自动隐藏（避免点了没反应）', (await restoreBtn.count()) === 0)
    await contestCtx.close()
  }
  await browser.close()
  check('界面无脚本错误与 5xx', errors.length === 0, [...new Set(errors)].slice(0, 3).join(' | '))
} finally {
  await cleanup()
  const gone = await fetch(`${API}/problems/${problemId}`, { headers: adminAuth })
  check('临时函数题已清理', gone.status === 404, String(gone.status))
  if (contestId) {
    const cGone = await fetch(`${API}/contests/${contestId}`, { headers: adminAuth })
    check('临时比赛已清理', cGone.status === 404, String(cGone.status))
  }
}

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
process.exitCode = fail === 0 ? 0 : 1
