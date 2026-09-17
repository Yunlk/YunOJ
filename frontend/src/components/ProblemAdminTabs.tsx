import { Link } from 'react-router-dom'

export type ProblemAdminTab = 'statement' | 'settings' | 'tests'

/**
 * 题目管理导航：一个题目的三块工作区，都在同一套导航里切换，不用靠返回键找。
 *
 * - 题面设置：标题、题面、输入输出格式、提示、样例（`/problem/:id/edit`）
 * - 题目设置：提供者、难度、标签、显示分数、题目状态、限制与评测器、附件
 *   （同一个页面用 `?tab=settings` 切换，表单状态不丢）
 * - 数据设置：测试点列表与 ZIP 批量导入（`/admin/problems/:id/tests`；新建题目还没有 id 时置灰）
 */
export default function ProblemAdminTabs({
  problemId,
  active,
}: {
  problemId?: number | string
  active: ProblemAdminTab
}) {
  const id = problemId === undefined || problemId === '' ? null : problemId
  const base = id ? `/problem/${id}/edit` : '/problem/new'
  // 不用 NavLink：题面设置与题目设置是同一个 pathname（只差 ?tab=），
  // NavLink 只看 pathname，会把两个标签同时标成 active。
  const linkClass = (key: ProblemAdminTab) => `tab${active === key ? ' active' : ''}`

  return (
    <nav className="tabs problem-admin-tabs" aria-label="题目管理导航">
      <Link to={base} className={linkClass('statement')} aria-current={active === 'statement' ? 'page' : undefined}>
        题面设置
      </Link>
      <Link
        to={`${base}?tab=settings`}
        className={linkClass('settings')}
        aria-current={active === 'settings' ? 'page' : undefined}
      >
        题目设置
      </Link>
      {id ? (
        <Link
          to={`/admin/problems/${id}/tests`}
          className={linkClass('tests')}
          aria-current={active === 'tests' ? 'page' : undefined}
        >
          数据设置
        </Link>
      ) : (
        <span className="tab tab-disabled" aria-disabled="true" title="保存题目后即可配置测试点">
          数据设置
        </span>
      )}
    </nav>
  )
}
