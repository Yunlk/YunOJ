// 验证测试点 ZIP 预览接口：空/缺项数组必须返回 []（而不是 JSON null），
// 否则前端 `zipPreview.unpaired.length` 会抛
// 「can't access property "length", zipPreview.unpaired is null」。
import { Buffer } from 'node:buffer'
import { getToken } from './auth.mjs'
import { ADMIN_USER, ADMIN_PASS } from './env.mjs'

const API = process.env.YUNOJ_API ?? 'http://127.0.0.1:8090/api'
const token = await getToken(ADMIN_USER, ADMIN_PASS)
const auth = { Authorization: `Bearer ${token}` }

/** 用最简 ZIP（stored，无压缩）打包文本文件 */
function makeZip(files) {
  const chunks = []
  const central = []
  let offset = 0
  for (const [name, content] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8')
    const data = Buffer.from(content, 'utf8')
    const crc = crc32(data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    local.writeUInt16LE(0, 28)
    chunks.push(local, nameBuf, data)

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
  return Buffer.concat([...chunks, centralBuf, end])
}

function crc32(buf) {
  let c
  const table = []
  for (let n = 0; n < 256; n++) {
    c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  let crc = 0xffffffff
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

const post = async (path, zipBuffer, filename) => {
  const form = new FormData()
  form.append('file', new Blob([zipBuffer], { type: 'application/zip' }), filename)
  const r = await fetch(`${API}${path}`, { method: 'POST', headers: auth, body: form })
  const text = await r.text()
  let json = null
  try { json = JSON.parse(text) } catch { json = text }
  return { status: r.status, json, raw: text }
}

const case1 = await post('/problems/437/testcases/preview', makeZip({ '1.in': '1 2\n', '1.out': '3\n' }), 'ok.zip')
console.log('== 完全成对 ==')
console.log('  HTTP', case1.status, '| unpaired =', JSON.stringify(case1.json?.unpaired), '| 类型', Array.isArray(case1.json?.unpaired) ? 'array ✓' : typeof case1.json?.unpaired)

const case2 = await post('/problems/437/testcases/preview', makeZip({ '1.in': '1 2\n', '2.out': '9\n' }), 'bad.zip')
console.log('== 有未配对文件 ==')
console.log('  HTTP', case2.status, '| unpaired =', JSON.stringify(case2.json?.unpaired), '| pairs =', JSON.stringify(case2.json?.pairs))

console.log('\n结论:', Array.isArray(case1.json?.unpaired) ? '空数组返回 []，前端 .length 安全 ✓' : '仍可能返回 null ✗')
