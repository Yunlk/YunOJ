import { NavLink } from 'react-router-dom'

/**
 * 题目管理导航：把「题面设置 / 数据设置 / 题目管理」放进同一个上下文，
 * 不用在编辑页与测试点页之间靠返回键来回找。
 *
 * - 题面设置：题面、难度、标签、时限、题型与评测器配置
 * - 数据设置：测试点列表、单点编辑与 ZIP 批量导入（新建题目还没有 id 时禁用）
 * - 题目管理：回到题目列表
 */
export default function ProblemAdminTabs({ problemId }: { problemId?: number | string }) {
  const id = problemId === undefined || problemId === '' ? null : problemId
  const cls = ({ isActive }: { isActive: boolean }) => `tab${isActive ? ' active' : ''}`

  return (
    <nav className="tabs problem-admin-tabs" aria-label="题目管理导航">
      <NavLink to={id ? `/problem/${id}/edit` : '/problem/new'} className={cls} end>
        题面设置
      </NavLink>
      {id ? (
        <NavLink to={`/admin/problems/${id}/tests`} className={cls}>
          数据设置
        </NavLink>
      ) : (
        <span className="tab tab-disabled" aria-disabled="true" title="保存题目后即可配置测试点">
          数据设置
        </span>
      )}
      <NavLink to="/admin/problems" className={cls} end>
        题目管理
      </NavLink>
    </nav>
  )
}
