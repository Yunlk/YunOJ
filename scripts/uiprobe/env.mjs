// 验收工具的统一凭据来源。
//
// 设计：受版本控制的脚本里**不允许**出现管理员口令。凭据从仓库根目录的 .env
// （已被 .gitignore 忽略）读取，键名：
//   UI_ADMIN_USER / UI_ADMIN_PASS   —— 管理员账号（audit/shoot/stress/probe 的管理端断言与截图用）
//   UI_STUDENT_USER / UI_STUDENT_PASS —— 可选，默认用种子学生账号 demo05/demo123
//
// 若未配置管理员凭据，工具会给出明确提示而不是悄悄用一个已泄露的默认口令。
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const here = dirname(fileURLToPath(import.meta.url))
const ENV_PATH = resolve(here, '../../.env')

function loadEnvFile(path) {
  const out = {}
  try {
    for (const raw of readFileSync(path, 'utf8').split('\n')) {
      const line = raw.trim()
      if (!line || line.startsWith('#')) continue
      const eq = line.indexOf('=')
      if (eq <= 0) continue
      const key = line.slice(0, eq).trim()
      let value = line.slice(eq + 1).trim()
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1)
      }
      out[key] = value
    }
  } catch {
    // 没有 .env 时全部走默认值
  }
  return out
}

const fileEnv = loadEnvFile(ENV_PATH)
const pick = (key, fallback = '') => process.env[key] ?? fileEnv[key] ?? fallback

export const ENV_FILE = ENV_PATH

/** 管理员凭据（来自 .env 的 UI_ADMIN_*；未配置时为空串，工具会提示）。 */
export const ADMIN_USER = pick('UI_ADMIN_USER')
export const ADMIN_PASS = pick('UI_ADMIN_PASS')

/** 学生凭据：种子账号，口令本来就写在 seedcontests/seeddemo 源码里，不构成额外泄露。 */
export const STUDENT_USER = pick('UI_STUDENT_USER', 'demo05')
export const STUDENT_PASS = pick('UI_STUDENT_PASS', 'demo123')

/** 取管理员凭据，缺失时抛错并指路。 */
export function requireAdminCreds() {
  if (!ADMIN_USER || !ADMIN_PASS) {
    throw new Error(
      `缺少管理员凭据：请在 ${ENV_PATH} 中配置 UI_ADMIN_USER 与 UI_ADMIN_PASS（该文件已被 .gitignore 忽略）`,
    )
  }
  return { user: ADMIN_USER, pass: ADMIN_PASS }
}
