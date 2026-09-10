import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { extractError, getSubmissions, rejudgeSubmission } from '../api'
import Pagination from '../components/Pagination'
import PageHeader from '../components/PageHeader'
import SubmissionFlags from '../components/SubmissionFlags'
import { useAuth } from '../context/AuthContext'
import { SUBMISSION_STATUSES, type SubmissionListItem } from '../types'
import { formatMemory, formatRunTime, formatTime } from '../utils/format'
import { getStatusInfo, isPendingStatus, type StatusColor } from '../utils/status'

const PAGE_SIZE = 20

/** 时间范围：由后端 created_after 做真实筛选（服务端过滤 + 分页口径一致）。 */
type TimeRange = 'all' | 'today' | 'week'

const TIME_RANGES: { key: TimeRange; label: string; hint: string }[] = [
  { key: 'all', label: '全部时间', hint: '不做时间筛选' },
  { key: 'today', label: '今天', hint: '只看今天（本地时区 0 点起）的提交' },
  { key: 'week', label: '近 7 天', hint: '只看最近 7 天的提交' },
]

const RANGE_KEYS = TIME_RANGES.map((r) => r.key)

function isTimeRange(value: string | null): value is TimeRange {
  return value !== null && (RANGE_KEYS as string[]).includes(value)
}

function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** 把「今天 / 近 7 天」换算成 RFC3339 下界，交给后端过滤（不再只筛当前页）。 */
function rangeCreatedAfter(range: TimeRange): string | undefined {
  if (range === 'today') return new Date(startOfToday()).toISOString()
  if (range === 'week') return new Date(startOfToday() - 6 * 24 * 60 * 60 * 1000).toISOString()
  return undefined
}

/** 后端只接受正整数 id，非数字输入直接忽略，避免 400。 */
function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, '')
}

/** 十六进制色值 -> rgb 分量串，供结论色块的柔和底色使用。 */
function hexToRgb(hex: string): string {
  const v = hex.trim().replace('#', '')
  const full = v.length === 3 ? v.split('').map((c) => c + c).join('') : v
  const n = Number.parseInt(full, 16)
  if (!/^[0-9a-f]{6}$/i.test(full) || Number.isNaN(n)) return '37, 99, 216'
  return `${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}`
}

/** 从设计令牌读取判定色，页面 CSS 里不允许出现硬编码色值。 */
function verdictVars(color: StatusColor): React.CSSProperties {
  const hex = getComputedStyle(document.documentElement)
    .getPropertyValue(`--verdict-${color}`)
    .trim()
  if (!hex) return {}
  return {
    ['--verdict-color' as string]: `var(--verdict-${color})`,
    ['--verdict-rgb' as string]: hexToRgb(hex),
  }
}

export default function Status() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'
  const navigate = useNavigate()

  const [searchParams, setSearchParams] = useSearchParams()
  const page = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const problemId = digitsOnly(searchParams.get('problem_id') ?? '')
  const userId = digitsOnly(searchParams.get('user_id') ?? '')
  const status = searchParams.get('status') ?? ''
  const lang = searchParams.get('lang') ?? ''
  const rangeParam = searchParams.get('range')
  const range: TimeRange = isTimeRange(rangeParam) ? rangeParam : 'all'

  const [items, setItems] = useState<SubmissionListItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // 表单里尚未提交的输入（URL 是已生效的筛选）
  const [fProblem, setFProblem] = useState(problemId)
  const [fUser, setFUser] = useState(userId)
  const [fStatus, setFStatus] = useState(status)
  const [fLang, setFLang] = useState(lang)

  const [reloading, setReloading] = useState(0)
  const [rejudgingId, setRejudgingId] = useState(0)
  const [notice, setNotice] = useState('')

  const problemInputRef = useRef<HTMLInputElement>(null)

  // 回退/前进或从外部链接进来时，让输入框跟随 URL
  useEffect(() => {
    setFProblem(problemId)
  }, [problemId])
  useEffect(() => {
    setFUser(userId)
  }, [userId])
  useEffect(() => {
    setFStatus(status)
  }, [status])
  useEffect(() => {
    setFLang(lang)
  }, [lang])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    getSubmissions({
      page,
      size: PAGE_SIZE,
      problem_id: problemId || undefined,
      // user_id 对所有登录用户都下发；普通用户由后端强制收紧为本人（见 userFilterRestricted 提示）
      user_id: userId || undefined,
      status: status || undefined,
      created_after: rangeCreatedAfter(range),
    })
      .then((data) => {
        if (cancelled) return
        setItems(data.items)
        setTotal(data.total)
      })
      .catch((err) => {
        if (!cancelled) setError(extractError(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [isAdmin, page, problemId, reloading, status, userId])

  // 键盘：/ 由导航统一分发（题目号输入标记了 data-search-shortcut，会优先获得焦点）

  const buildParams = useCallback(
    (patch: Record<string, string>) => {
      const next = new URLSearchParams()
      const merged: Record<string, string> = {
        problem_id: problemId,
        user_id: userId,
        status,
        lang,
        range: range === 'all' ? '' : range,
        ...patch,
      }
      for (const key of ['problem_id', 'user_id', 'status', 'lang', 'range']) {
        const value = merged[key]
        if (value) next.set(key, value)
      }
      const nextPage = Number(merged.page ?? '1')
      next.set('page', String(nextPage > 1 ? nextPage : 1))
      return next
    },
    [lang, problemId, range, status, userId],
  )

  const applyFilters = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    setSearchParams(
      buildParams({
        problem_id: digitsOnly(fProblem),
        user_id: digitsOnly(fUser),
        status: fStatus,
        lang: fLang,
        page: '1',
      }),
    )
  }

  const resetFilters = () => {
    setFProblem('')
    setFUser('')
    setFStatus('')
    setFLang('')
    setSearchParams({ page: '1' })
  }

  const setRange = (next: TimeRange) => {
    setSearchParams(buildParams({ range: next === 'all' ? '' : next, page: '1' }))
  }

  const toggleMine = () => {
    if (!user) return
    const nextUserId = scope === 'mine' ? '' : String(user.id)
    setFUser(nextUserId)
    setSearchParams(buildParams({ user_id: nextUserId, page: '1' }))
  }

  const changePage = (nextPage: number) => {
    setSearchParams(buildParams({ page: String(nextPage) }))
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const onRejudge = async (id: number) => {
    setRejudgingId(id)
    setNotice('')
    try {
      await rejudgeSubmission(id)
      setNotice(`提交 #${id} 已加入重测队列，稍后刷新即可看到新结论。`)
      setReloading((n) => n + 1)
    } catch (err) {
      setNotice(`重测失败：${extractError(err)}`)
    } finally {
      setRejudgingId(0)
    }
  }

  const hasFilters = Boolean(problemId || userId || status || lang || range !== 'all')

  // 列表范围：标题、摘要与提示都跟着它走，避免「标题写我的、数据是全站」这种自相矛盾。
  //   all    —— 全站提交（管理员不带 user_id 时）
  //   mine   —— 我的提交（筛选的 user_id 就是自己）
  //   others —— 指定用户（筛选的 user_id 是别人）
  //   self   —— 未指定用户，但后端只会返回本人的提交（普通用户的默认视图）
  const scope: 'all' | 'mine' | 'others' | 'self' = userId
    ? Number(userId) === user?.id
      ? 'mine'
      : 'others'
    : isAdmin
      ? 'all'
      : 'self'

  // 后端 handleListSubmissions 对普通用户强制 f.UserID = 自己，URL 里的 user_id 会被忽略。
  // 这里如实告知，不做「看似筛了别人的提交、其实是自己的」这种静默误导。
  const userFilterRestricted = !isAdmin && scope === 'others'

  // 时间范围已交给后端 created_after 过滤，这里的 items 就是最终结果（分页口径一致）
  const visibleItems = items
  const hiddenByRange = 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const firstIndex = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
  const lastIndex = Math.min(page * PAGE_SIZE, total)
  const colspan = isAdmin ? 8 : 7
  const scopeLabel =
    scope === 'all'
      ? '全站提交'
      : scope === 'others'
        ? `用户 #${userId} 的提交`
        : scope === 'mine'
          ? '我的提交'
          : '仅本人可见'
  const scopeDescription =
    scope === 'all'
      ? '按题目、用户与结论检索全站提交，可直接重测或查看代码。'
      : scope === 'mine'
        ? '只看你提交的记录：结论、耗时、内存与代码。'
        : scope === 'self'
          ? '当前可见范围是你自己的提交（比赛内提交请在对应比赛页查看）。'
          : `查看用户 #${userId} 的公开提交记录。`

  return (
    <div>
      <PageHeader
        eyebrow="评测"
        title="提交记录"
        description={scopeDescription}
        actions={
          <>
            {scope !== 'mine' && user && (
              <button type="button" className="button button-secondary" onClick={toggleMine}>
                只看我的
              </button>
            )}
            <Link to="/problems" className="button button-secondary">
              去题库刷题
            </Link>
            {isAdmin && (
              <Link to="/admin/judge" className="button button-primary">
                评测机队列
              </Link>
            )}
          </>
        }
      />

      <form className="toolbar submission-filters" onSubmit={applyFilters}>
        <label className="field-label" htmlFor="sub-problem">
          题目号
        </label>
        <input
          id="sub-problem"
          ref={problemInputRef}
          className="submission-filter-input"
          type="text"
          inputMode="numeric"
          value={fProblem}
          onChange={(e) => setFProblem(digitsOnly(e.target.value))}
          placeholder="全部"
          data-search-shortcut
          title="按题目 ID 过滤，按 / 可直接聚焦"
        />
        <kbd className="submission-kbd" title="快捷键：/">
          /
        </kbd>

        <label className="field-label" htmlFor="sub-status">
          结论
        </label>
        <select
          id="sub-status"
          className="select-input"
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
        >
          <option value="">全部结论</option>
          {SUBMISSION_STATUSES.map((s) => (
            <option key={s} value={s}>
              {getStatusInfo(s).label}
            </option>
          ))}
        </select>

        <label className="field-label" htmlFor="sub-lang">
          语言
        </label>
        <select
          id="sub-lang"
          className="select-input submission-filter-lang"
          value={fLang}
          onChange={(e) => setFLang(e.target.value)}
        >
          <option value="">全部语言</option>
          <option value="cpp">C++</option>
          <option value="c">C</option>
          <option value="python">Python 3</option>
        </select>

        <label className="field-label" htmlFor="sub-user">
          用户号
        </label>
        <input
          id="sub-user"
          className="submission-filter-input"
          type="text"
          inputMode="numeric"
          value={fUser}
          onChange={(e) => setFUser(digitsOnly(e.target.value))}
          placeholder="全部"
          title={isAdmin ? '按用户 ID 过滤提交记录' : '填写自己的用户号等同于「只看我的」'}
        />
        <span className="check-row">
          <input
            type="checkbox"
            checked={scope === 'mine'}
            onChange={toggleMine}
            disabled={!user}
            aria-label="只看我的"
            title="写入或清除 user_id=<你自己的用户号>"
          />
          只看我的
        </span>

        <button type="submit" className="button button-primary">
          筛选
        </button>
        <button type="button" className="button button-secondary" onClick={resetFilters}>
          重置
        </button>

        <span className="toolbar-spacer" />

        <span className="toolbar-label" id="sub-range-label">
          时间范围
        </span>
        <span className="segmented" role="group" aria-labelledby="sub-range-label">
          {TIME_RANGES.map((r) => (
            <button
              key={r.key}
              type="button"
              aria-pressed={range === r.key}
              title={r.hint}
              onClick={() => setRange(r.key)}
            >
              {r.label}
            </button>
          ))}
        </span>
      </form>

      {range !== 'all' && (
        <p className="field-hint submission-range-hint">
          时间范围由服务端过滤：{range === 'today' ? '仅今天' : '最近 7 天'}提交，共 {total} 条。
        </p>
      )}

      <div className="submission-scope">
        <span className={scope === 'mine' ? 'badge badge-info' : 'badge'}>范围：{scopeLabel}</span>
        {userFilterRestricted && (
          <span className="field-hint">
            提交可见范围仅限本人，已忽略 user_id={userId}，下面是你的提交记录。
          </span>
        )}
      </div>

      {error && <div className="error-message">{error}</div>}
      {notice && <div className="info-message">{notice}</div>}

      {!loading && (items.length > 0 || hasFilters) && (
        <div className="table-summary">
          <span>
            {total > 0 ? (
              <>
                {scope === 'all'
                  ? '全站共 '
                  : scope === 'others'
                    ? `用户 #${userId} 共 `
                    : scope === 'mine'
                      ? '我的提交共 '
                      : '共 '}
                <strong>{total}</strong> 条提交 · 第 {firstIndex}–{lastIndex} 条 · 第 {page}/{totalPages} 页
              </>
            ) : (
              <>没有匹配的提交</>
            )}
            {hasFilters && <span className="table-summary-filter"> · 已筛选</span>}
          </span>
          <span>
            {range !== 'all' && hiddenByRange > 0
              ? `本页 ${visibleItems.length} 条符合时间范围，另有 ${hiddenByRange} 条在本页但超出范围`
              : '点击任意一行查看评测详情与代码'}
          </span>
        </div>
      )}

      <div className="table-frame">
        <table className="data-table submissions-table">
          <thead>
            <tr>
              <th style={{ width: 104 }}>结论</th>
              <th style={{ width: 76 }}>提交号</th>
              <th>题目</th>
              {isAdmin && <th style={{ width: 128 }}>用户</th>}
              <th style={{ width: 90 }}>语言</th>
              <th style={{ width: 96 }}>耗时</th>
              <th style={{ width: 96 }}>内存</th>
              <th style={{ width: 158 }}>提交时间</th>
              {isAdmin && <th className="cell-actions">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={colspan} className="table-empty">
                  加载中…
                </td>
              </tr>
            ) : visibleItems.length === 0 ? (
              <tr>
                <td colSpan={colspan} className="table-empty">
                  {items.length > 0
                    ? '本页没有符合时间范围的提交，可切回「全部时间」。'
                    : hasFilters
                      ? '没有符合条件的提交，试着放宽筛选条件。'
                      : '还没有提交记录，去题库选一道题开始吧。'}
                </td>
              </tr>
            ) : (
              visibleItems.map((s) => {
                const pending = isPendingStatus(s.status)
                return (
                  <tr
                    key={s.id}
                    className="clickable-row"
                    onClick={() => navigate(`/submission/${s.id}`)}
                  >
                    <td>
                      <span
                        className={`submission-verdict${pending ? ' submission-verdict-pending' : ''}`}
                        style={verdictVars(getStatusInfo(s.status).color)}
                        title={`判定：${getStatusInfo(s.status).label}`}
                      >
                        <span className="submission-verdict-bar" aria-hidden="true" />
                        {getStatusInfo(s.status).label}
                      </span>
                      <SubmissionFlags
                        pretestOnly={s.pretest_only}
                        systemTested={s.system_tested}
                        isHacked={s.is_hacked}
                      />
                    </td>
                    <td className="cell-id">
                      <Link to={`/submission/${s.id}`} onClick={(e) => e.stopPropagation()}>
                        #{s.id}
                      </Link>
                    </td>
                    <td>
                      <Link
                        to={`/problem/${s.problem_id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="problem-link"
                      >
                        {s.problem_title}
                      </Link>
                      <span className="submission-problem-id">#{s.problem_id}</span>
                    </td>
                    {isAdmin && <td>{s.username}</td>}
                    <td className="mono">{s.language}</td>
                    <td className="cell-num mono">{formatRunTime(s.time_ms)}</td>
                    <td className="cell-num mono">{formatMemory(s.memory_kb)}</td>
                    <td className="mono submission-time-cell">{formatTime(s.created_at)}</td>
                    {isAdmin && (
                      <td className="cell-actions">
                        <span className="submission-row-buttons">
                          <button
                            type="button"
                            className="button button-secondary button-sm"
                            disabled={rejudgingId === s.id}
                            title="重新评测这条提交"
                            onClick={(e) => {
                              e.stopPropagation()
                              void onRejudge(s.id)
                            }}
                          >
                            {rejudgingId === s.id ? '重测中' : '重测'}
                          </button>
                          <Link
                            to={`/submission/${s.id}`}
                            className="button button-ghost button-sm"
                            onClick={(e) => e.stopPropagation()}
                          >
                            查看代码
                          </Link>
                        </span>
                      </td>
                    )}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {!loading && (
        <div className="submission-row-hint field-hint">
          {isAdmin
            ? '点击整行进入评测详情；行内「重测」会重新评测该提交（仅管理员）。'
            : '点击整行进入评测详情，可查看测试点结果与代码。'}
          {isAdmin && visibleItems[0] && (
            <>
              {' 最近一条：'}
              <Link to={`/submission/${visibleItems[0].id}`}>#{visibleItems[0].id}</Link>
            </>
          )}
        </div>
      )}

      {!loading && visibleItems.length === 0 && items.length === 0 && hasFilters && (
        <div className="empty-state submission-empty">
          <div className="empty-state-title">没有符合条件的提交</div>
          <div className="empty-state-hint">
            题目号只接受数字 ID，结论与语言需与下拉选项一致。清空筛选即可看到全部提交。
          </div>
          <button type="button" className="button button-primary" onClick={resetFilters}>
            清空筛选
          </button>
        </div>
      )}

      {!loading && items.length === 0 && !hasFilters && (
        <div className="empty-state submission-empty">
          <div className="empty-state-title">还没有提交记录</div>
          <div className="empty-state-hint">
            在题目页写完代码提交后会出现在这里；每次提交的结论、耗时与内存都会保留。
          </div>
          <Link to="/problems" className="button button-primary">
            去题库选一题
          </Link>
        </div>
      )}

      <Pagination page={page} total={total} size={PAGE_SIZE} onChange={changePage} />
    </div>
  )
}
