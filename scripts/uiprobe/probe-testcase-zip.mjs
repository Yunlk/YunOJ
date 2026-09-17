// 在真实页面上验证测试点 ZIP 预览：上传「完全成对」与「有未配对文件」两种包，
// 断言预览区正常渲染且页面无 JS 异常（用户报的
// 「can't access property "length", zipPreview.unpaired is null」即发生在这里）。
//
// 只走预览接口，不点「确认导入」，因此不会改动任何题目数据。
// 用法：node scripts/uiprobe/probe-testcase-zip.mjs
import { chromium } from 'playwright-core'
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getToken } from './auth.mjs'
import { ADMIN_USER, ADMIN_PASS } from './env.mjs'

const BASE = process.env.YUNOJ_WEB ?? 'http://127.0.0.1:5173'
const PROBLEM = process.env.PROBLEM_ID ?? '437'

function crc32(buf) {
  const table = []
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

function makeZip(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    parts.push(local, nameBuf, data)

    const cd = Buffer.alloc(46)
    cd.writeUInt32LE(0x02014b50, 0)
    cd.writeUInt16LE(20, 4)
    cd.writeUInt16LE(20, 6)
    cd.writeUInt32LE(crc, 16)
    cd.writeUInt32LE(data.length, 20)
    cd.writeUInt32LE(data.length, 24)
    cd.writeUInt16LE(nameBuf.length, 28)
    cd.writeUInt32LE(offset, 42)
    central.push(cd, nameBuf)
    offset += local.length + nameBuf.length + data.length
  }
  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(Object.keys(files).length, 8)
  end.writeUInt16LE(Object.keys(files).length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBuf, end])
}

let pass = 0
let fail = 0
const check = (name, ok, detail = '') => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) } else { fail++; console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`) }
}

const dir = mkdtempSync(join(tmpdir(), 'yunoj-zip-'))
const okZip = join(dir, 'paired.zip')
const badZip = join(dir, 'unpaired.zip')
writeFileSync(okZip, makeZip({ '1.in': '1 2\n', '1.out': '3\n' }))
writeFileSync(badZip, makeZip({ '1.in': '1 2\n', '2.out': '9\n' }))

const token = await getToken(ADMIN_USER, ADMIN_PASS)
const browser = await chromium.launch({ channel: 'chrome' })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
await context.addInitScript((t) => localStorage.setItem('yunoj_token', t), token)
const page = await context.newPage()
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

await page.goto(`${BASE}/admin/problems/${PROBLEM}/tests`, { waitUntil: 'networkidle' })
// ZIP 专用输入是 #tc-zip（accept=".zip"）；页面上另有两个单测试点的文件输入，
// 用 .first() 会选错（那次上传不会有任何请求）。
const zipInput = () => page.locator('input#tc-zip, input[accept=".zip"]').first()

console.log('\n== 成对 ZIP 预览 ==')
await zipInput().setInputFiles(okZip)
await page.waitForTimeout(1500)
const okText = await page.locator('.zip-preview').innerText().catch(() => '')
check('预览区渲染', okText.length > 0, okText.replace(/\s+/g, ' ').slice(0, 60))
check('显示成对测试点数（无 unpaired 报错）', /解析结果：1 组成对测试点/.test(okText.replace(/\s+/g, ' ')), okText.replace(/\s+/g, ' ').slice(0, 80))
check('成对包判定为可导入', /可导入/.test(okText) && !/无法导入/.test(okText), okText.replace(/\s+/g, ' ').slice(0, 80))

console.log('\n== 有未配对文件的 ZIP 预览 ==')
await page.reload({ waitUntil: 'networkidle' })
await zipInput().setInputFiles(badZip)
await page.waitForTimeout(1500)
const badText = (await page.locator('.zip-preview').innerText().catch(() => '')).replace(/\s+/g, ' ')
check('预览区渲染', badText.length > 0, badText.slice(0, 60))
check('列出未配对文件', /未配对文件/.test(badText) && /1\.in/.test(badText), badText.slice(0, 90))
check('提示无法导入', /无法导入/.test(badText), badText.slice(0, 90))

check('全程无 JS 异常', errors.length === 0, errors.slice(0, 2).join(' | '))

console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
await browser.close()
process.exitCode = fail === 0 ? 0 : 1
