# YunOJ 选手端界面重构 · 实施契约

> 这份文件是并行重构的唯一事实来源。任何页面重写都必须遵守这里的令牌、组件类与文件归属。
> 基调：**浅色蓝调 + 高信息密度**，面向「刷题用户」的使用习惯与使用场景。

## 1. 已完成（不要重复改动）

| 领域 | 文件 | 说明 |
| --- | --- | --- |
| 设计令牌 | `frontend/src/styles/tokens.css` | `--c-*` 语义色、`--fs-*` 字号、`--space-*` 间距、`--h-*` 控件高度、`--verdict-*` 判定色；`--bg/--primary` 与 `--app-*` 是兼容层 |
| 基础层 | `frontend/src/styles/base.css` | 排版、焦点环、滚动条、`.visually-hidden`、`.skip-link` |
| 布局层 | `frontend/src/styles/layout.css` | `main.app-shell`、`app-shell-wide`、`.page-header-standard`、`.toolbar`、`.layout-side`、`.stat-grid` |
| 组件层 | `frontend/src/styles/components.css` | `.button*`、`.card/.panel/.side-card`、`.data-table`（44px 行 / 38px 表头）、`.tag-chip`、`.badge*`、`.status-badge/.status-flag`、`.tabs/.tab`、`.empty-state`、`.pagination`、`.breadcrumb`、`.progress`、`.menu/.menu-item`、`.toast`、`.kv-list`、`.segmented` |
| 题库页 | `frontend/src/pages/ProblemList.tsx` + `styles/pages/problems.css` | 状态列、状态/难度/标签多选、排序、每页条数、进度侧栏、随机一题、`/` 快捷搜索 |
| 单题页 | `frontend/src/pages/ProblemDetail.tsx` + `components/ProblemWorkbench.tsx` + `styles/pages/problem.css` | 默认「题面 + 编辑器」工作台，左栏 题目/我的提交/题解/讨论，右栏编辑器 + 自测抽屉，可拖拽分栏、上一题/下一题 |

新增后端接口（已实现，可直接调用）：
- `GET /api/problems/facets` → `{ total, solved, difficulties[], tags[] }`
- `GET /api/problems?keyword=&difficulty=1&difficulty=2&tag=数学&my_status=todo|attempted|accepted&sort=id|difficulty|difficulty_desc|acceptance|newest|submissions&page=&size=`
- `GET /api/problems/{id}/neighbors` → `{ prev, next }`
- `GET /api/submissions` 新增筛选：`language=<语言键>`、`created_after=` / `created_before=`（RFC3339 或 Unix 秒，非法值忽略）。
  注意：普通用户只能查自己的提交（后端强制 `user_id`，防改 URL 查他人），管理员才能按 `user_id` 查全量。
- `GET /api/rankings?keyword=` 按用户名过滤（名次仍为全站名次）。
- `GET /api/profile/favorites` 的每条 item 现在带 `my_status`（`accepted` / `wrong_answer` / 空串=未做，字段始终存在），收藏页不再需要额外拉状态映射。
- `POST /api/notifications/read-all` → `{ marked: n }`，一次 SQL 批量已读；前端封装为 `markAllNotificationsRead()`。

## 2. 必须遵守的规则

1. **只用设计基座的类**：按钮一律 `.button .button-{primary,secondary,ghost,danger} [.button-sm]`，卡片 `.card/.panel/.side-card`，表格 `.table-frame > .data-table`，标签页 `.tabs > .tab`，空状态 `.empty-state`，筛选条 `.toolbar`，分段筛选 `.segmented`。不要新造按钮/表格样式。
2. **颜色只走 token**：禁止硬编码 `#xxx`（判定色用 `var(--verdict-*)`，语义色用 `var(--c-*)`）。难度色沿用 `.difficulty-level-N` 提供的 `--difficulty-color/--difficulty-bg`。
3. **文件归属**：只修改分配给你的页面文件 + 你自己的 `frontend/src/styles/pages/<你的>.css`。
   - 不要改 `styles.css`、`foundation.css`、`tokens.css`、`base.css`、`layout.css`、`components.css`、`main.tsx`、`App.tsx`（import 已预置好）。
   - 不要改 `ProblemList.tsx`、`ProblemDetail.tsx`、`ProblemWorkbench.tsx`、`Navbar.tsx`、`Home.tsx`。
   - `types.ts` / `api.ts`：只允许在你需要的**末尾**追加导出，不要重排、不要改动他人类型。
4. **信息密度**：表格行高走 `.data-table` 默认值；页面主容器用 `<PageHeader>`；表格多的页面在 `App.tsx` 之外无法改 shell，因此页面内部用 `.toolbar` 承载筛选、`.table-summary` 承载总数摘要。
5. **中文文案**，与现有风格一致（简洁、动词开头、不用感叹号）。所有表单控件必须有 `<label>` 或 `aria-label`（审计脚本会检查）。
6. **键盘可达**：主要动作是按钮/链接而不是 `div onClick`；整行可点时加 `className="clickable-row"` 并保留行内链接。
7. 不新增第三方依赖；不改后端代码。

## 3. 各页面目标（按刷题场景）

### A. 提交记录 `/status` + 提交详情 `/submission/:id`
场景：刷完一题后回看"我这次到底哪里挂了"，或按结论找题。
- 顶部：`PageHeader` + `.toolbar`：
  - 关键快捷：「只看我的」开关（一键把 `user_id` 设为自己）、问题号输入、结论 `select`、语言 `select`、时间范围（今天/近 7 天/全部，可用 `created_after`？若后端不支持就只做前端可用的筛选，不要造假参数）
  - 提交号/题目/用户三个筛选字段合并为一行，避免三行表单
- 表格：`状态(色块+缩写) | # | 题目 | 用户 | 语言 | 耗时 | 内存 | 时间`，整行可点进详情，行内提供「重测」(仅管理员) 与「查看代码」
- 分页保留；总数摘要放 `.table-summary`
- 提交详情页：结论区用大号色块 + 关键指标（耗时/内存/语言/时间/比赛），测试点表格紧凑化，代码块支持复制；管理员显示重测按钮
- 所有筛选必须写进 URL（`useSearchParams`），刷新与分享后状态不丢

### B. 比赛 `/contests` + `/contest/:id` + `/contest/:id/submissions`
场景：赛前报名、赛中进题、赛后看榜。
- 比赛列表：从纯表格改成**分组列表**——「进行中」「即将开始」「已结束」，进行中的显示**倒计时**（每 30s 刷新，已存在 `utils/clock.ts` 可复用），每行显示赛制标签、时间、报名状态、我的排名（若有数据）
- 比赛详情首页：把「题目 / 赛制 / 我的状态」突出出来：
  - 顶部状态条：比赛状态 + 倒计时 / 开始时间 + 报名按钮
  - 题目表格：题号、标题、我的状态（AC 绿 / 尝试）、通过率；整行可点进入比赛题目页
  - 赛制信息放侧栏 `.side-card`（保留现有信息，别丢字段）
  - 保留原有 tab 导航（总览/全部提交/排行榜/比赛设置/消息管理），不要删除功能
- 比赛提交页：筛选 + 表格密度统一；保留比赛内跳转按钮

### C. 个人中心 `/profile` + 收藏 `/favorites` + 通知 `/notifications`
场景：看自己的刷题进度与待办。
- 个人中心：`layout-side`（主区 + 侧栏）
  - 主区：刷题活动热力图（保留现有实现，只调密度）、最近提交表、参加过的比赛
  - 侧栏：账号信息卡、综合分/排名、**进度卡**（用 `/api/problems/facets` 的 `solved/total` 与难度分布，复用 `.difficulty-progress` 的样式思路但写在你自己的 CSS 里）
  - 空状态用 `.empty-state`，给下一步动作（如「去题库刷题」）
- 收藏：表格 + 难度/状态列，提供「取消收藏」与直接进入题目的操作
- 通知：列表化（未读高亮 + 「全部标为已读」若有接口），空状态友好

### D. 管理端视觉统一（不改流程）
范围：`AdminJudge`、`AdminUsers`、`AdminNotifications`、`ProblemAdmin`、`ProblemForm`、`TestcaseAdmin`、`ContestForm`、`ContestProblemManagerPage`、`ContestMessagesPage`、`ContestParticipants`、`ContestRegister`、`Groups`、`GroupDetail`、`AssignmentDetail`、`SubmitFile`、`Settings`、`Login`、`Register`、`NotFound`、`RollingDemoPage`。
- 目标：统一到设计基座（按钮/输入/卡片/表格/徽标），修掉审计报出的「无标签控件」，表格密度与全站一致
- **不要改动业务流程、接口调用与表单字段**；只做视觉与可访问性收敛
- 若发现某页用了 `styles.css` 里的旧类且无法通过新类收敛，可在你自己的 `styles/pages/admin.css` 里写作用域覆盖

## 4. 验证要求（必须做，并把结果写进交付报告）

```powershell
# 1) 类型检查（必须 0 错误）
#    ⚠ 必须指定 tsconfig.app.json：根 tsconfig.json 是 { files: [], references: [...] }，
#      普通 `tsc --noEmit` 不检查任何文件（永远 exit 0，是假绿灯）。
cd D:\git\YunOJ\frontend; npx tsc -p tsconfig.app.json --noEmit
#    等价：npm run build（内部为 tsc -b && vite build）

# 2) 布局与可访问性审计（会打印页高、表格行高、溢出、无标签控件、HTTP 错误）
cd D:\git\YunOJ; node scripts/uiprobe/audit.mjs --only <你的路由,逗号分隔>

# 3) 截图（给自己留证，也给用户看）
cd D:\git\YunOJ; node scripts/uiprobe/shoot.mjs --tag <你的标签> --only <你的路由>
```
要求：审计输出中**没有**「无标签控件」「横向溢出」「HTTP 4xx/5xx」；表格行高 44px、表头 38px。
如需交互验证，可仿照 `scripts/uiprobe/probe.mjs` 写一个自己的 probe 脚本（放在 `scripts/uiprobe/`）。

**并行期的噪声（重要）**：多个组同时改文件时，Vite 可能对正在写入的模块返回一次 `HTTP 500 /src/pages/X.tsx`，
这不是真实缺陷——**重跑一次即可**；若连续两次仍 500，才是真的语法/转译错误（用 `tsc -p tsconfig.app.json` 确认）。
同理，页面在别人改动落盘的瞬间可能短暂白屏，先硬刷新再判断。

## 5. 已有工具
- `node scripts/uiprobe/audit.mjs --verbose`：布局指标 + 首屏文本 + a11y + HTTP 错误
- `node scripts/uiprobe/shoot.mjs --tag x --only /a,/b`：整页截图到 `scripts/uiprobe/shots/`
- `node scripts/uiprobe/probe.mjs` / `probe-problem.mjs` / `probe-shell.mjs`：题库存题/工作台/导航交互断言（可仿写自己的）
- **登录统一走 `scripts/uiprobe/auth.mjs` 的 `getToken(user, pass)`**：30 分钟磁盘缓存（写入 `.cache/`，已 gitignore）。
  后端登录有速率限制（同用户名 5 分钟 12 次），直接 fetch 登录很容易触发 `429`，遇到就等 3-5 分钟或换账号。
- **凭据一律不写进受版本控制的文件**（`scripts/uiprobe/env.mjs` 负责读取）：
  - 管理员：仓库根目录 `.env` 里的 `UI_ADMIN_USER` / `UI_ADMIN_PASS`（`.env` 已被 gitignore）
  - 学生：`UI_STUDENT_USER` / `UI_STUDENT_PASS`，缺省用种子账号 `demo05/demo123`
  - 缺失管理员凭据时工具会直接报错并指路，而不是回落到某个默认口令
- 快捷键约定：`/` 由导航层分发——页面内存在带 `data-search-shortcut` 属性的输入框时聚焦它，否则打开命令面板（`Ctrl/⌘+K` 永远打开面板）。
- 种子账号：`demo01/demo123`（学生，有提交数据）、`demo05..demo20/demo123`（种子学生，口令见 `cmd/seedcontests`）
- 前端 dev server：http://127.0.0.1:5173 （已运行，HMR 生效）；后端：http://127.0.0.1:8090
  后端由 `pwsh -File scripts/dev-server.ps1` 启动（会加载 `.env`；`go run` 直接跑不会加载，只会用内置开发默认值）
- 顶部导航已重构为 `.appbar`（旧 `.navbar` 不再渲染）；倒计时统一用 `utils/clock.ts` 的 `useClock()` + `formatRemaining()`
