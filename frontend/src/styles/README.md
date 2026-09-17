# 前端样式分层与设计基座

面向「刷题用户」的浅色蓝调界面：**高信息密度**（表格 44px 行、控件 34px 高）、**动作优先**（打开题目即工作台、题库首屏给状态与筛选）。
新页面只允许组合这里的令牌与组件类，不要新增按钮/表格/卡片的私有样式。

## 1. 引入顺序（`src/main.tsx`）

```
styles.css           历史单体样式（仍在迁移中，勿新增规则）
styles/foundation.css 公共页面基础（历史整理层，勿新增规则）
styles/tokens.css     设计令牌：唯一颜色/间距/字号来源
styles/base.css       排版、焦点、滚动条、无障碍基础设施
styles/layout.css     页面骨架：容器、页头、工具栏、分栏、统计栅格
styles/components.css 组件：按钮/表单/表格/卡片/徽标/标签页/空状态/分页/提示
styles/shell.css      顶部导航 .appbar 与命令面板
styles/pages/*.css    页面级样式（每个页面一个文件）
```

后加载者生效；`foundation.css` 中形如 `.app-shell .data-table td` 的规则特异性较高，
需要覆盖时同样用 `.app-shell` 前缀（见 `components.css` 中表格段落）。

## 2. 令牌（`tokens.css`）

| 类别 | 令牌 | 说明 |
| --- | --- | --- |
| 品牌 | `--c-primary` `--c-primary-hover` `--c-primary-soft` `--c-primary-border` | 主色 `#2563d8` |
| 表面 | `--c-bg` `--c-surface` `--c-surface-2/3` `--c-surface-hover` | 卡片、表头、悬停底 |
| 文字 | `--c-text` `--c-text-2` `--c-text-3` | 主/次/弱 |
| 语义 | `--c-positive` `--c-danger` `--c-warning` `--c-info`（各带 `-soft`/`-border`） | 成功/危险/警告/信息 |
| 判定 | `--verdict-{green,red,orange,indigo,purple,blue,yellow,cyan,rose,darkgray,gray}` | 与 `utils/status.ts` 的 color 名一一对应 |
| 字号 | `--fs-11`…`--fs-26`，正文 `--fs-14` | |
| 尺寸 | `--h-ctl`(34) `--h-ctl-sm`(28) `--h-ctl-lg`(40) `--h-row`(44) `--h-row-head`(38) `--h-nav`(54) | 密度基准 |
| 间距 | `--space-1`(4) … `--space-8`(32) | |
| 圆角/阴影 | `--radius-sm/--radius/--radius-lg/--radius-pill`、`--shadow-sm/--shadow/--shadow-lg` | |
| 宽度 | `--content-width`(1360) `--content-width-wide`(1600) `--content-width-narrow`(920) | |

兼容层：`--bg/--surface/--border/--text/--primary/--green/--red/…` 与 `--app-*` 都映射到上面这套，
因此尚未迁移的页面会自动继承新配色与新密度。

## 3. 组件类（`components.css`）

- 按钮：`.button` + `.button-primary|secondary|outline|ghost|danger`，尺寸 `.button-sm|lg`，`.button-block`，图标 `.icon-btn`
- 表单：`.form-group`/`.field`/`.field-label`/`.field-hint`、`.check-row`、`.search-form`、`.search-input`、`.select-input`
- 表格：`.table-frame > .data-table`（44px 行 / 38px 表头）、`.table-summary`、单元格辅助 `.cell-id .cell-num .cell-right .cell-actions .cell-tight`、整行可点 `.clickable-row`
- 容器：`.card`、`.panel`（`.panel-head/.panel-title/.panel-body`）、`.side-card`、`.section`（`.section-head/.section-title/.section-hint`）、`.kv-list`
- 徽标：`.tag-chip`（可点 `.tag-chip-link`）、`.badge` + `.badge-{positive,danger,warning,info}`、`.status-badge.status-{color}`、`.status-flag-{pretest,system,hacked}`
- 标签页：`.tabs > .tab`（`.active`、`.tab-count`）
- 反馈：`.empty-state`（`.empty-state-title/.empty-state-hint`）、`.skeleton`、`.info-message/.success-message/.warning-message/.error-message`、`.toast-stack > .toast`
- 导航元素：`.pagination`、`.breadcrumb`、`.progress`、`.menu/.menu-item/.menu-sep`、`.segmented`、`.toolbar`
- 布局：`main.app-shell`（`-wide`/`-narrow` 变体）、`.layout-side`、`.layout-split`、`.stat-grid > .stat-tile`、`.workbench-shell/.workbench-pane`

页面级（`styles/pages/*.css`）只在基座缺位时补结构性类，例如单题页的
`.wb-*`（工作台分栏）与 `.attachment-list`（题面下方的附件下载列表）、
管理端的 `.problem-admin-tabs`（题面设置 / 题目设置 / 数据设置）与 `.attachment-table`。

## 4. 交互约定

- 快捷键：`Ctrl/⌘+K` 打开命令面板；`/` 在页面存在 `[data-search-shortcut]` 输入框时聚焦它，否则打开命令面板
- 倒计时统一用 `utils/clock.ts` 的 `useClock()`（服务端时间校正）+ `formatRemaining()`
- 筛选状态写进 URL（`useSearchParams`），刷新与分享不丢
- 表单控件必须有 `<label for>` 或 `aria-label`；整行可点时保留行内链接并 `stopPropagation`
- 颜色只用令牌；难以避免时用页面级 `.app-shell` 前缀覆盖

## 5. 验证工具（`scripts/uiprobe/`）

```powershell
# 一键全量：类型检查 → 生产构建 → 双端审计 → 对比度 → 4 组交互断言
pwsh -File scripts/uiprobe/verify-ui.ps1            # 加 -SkipBuild 可跳过构建（更快）

# 单跑某一项
cd D:\git\YunOJ\frontend; .\node_modules\.bin\tsc.cmd -p tsconfig.app.json --noEmit
# 注意：根 tsconfig.json 是 references 方案，`npx tsc --noEmit` 什么都不检查（永远 0 错）
cd D:\git\YunOJ; node scripts/uiprobe/audit.mjs --verbose     # 布局指标 + a11y + HTTP 错误
cd D:\git\YunOJ; node scripts/uiprobe/probe.mjs               # 题库交互断言
cd D:\git\YunOJ; node scripts/uiprobe/probe-problem.mjs       # 单题工作台断言
cd D:\git\YunOJ; node scripts/uiprobe/probe-shell.mjs         # 导航/首页/排名断言
cd D:\git\YunOJ; node scripts/uiprobe/probe-profile.mjs       # 个人中心/收藏/通知断言
cd D:\git\YunOJ; node scripts/uiprobe/probe-problem-settings.mjs  # 提供者/显示分数/附件（需管理员）
cd D:\git\YunOJ; node scripts/uiprobe/shoot.mjs --tag x       # 整页截图到 shots/
```

判定标准：审计输出无「无标签控件 / 横向溢出 / HTTP 4xx-5xx」，表格行高 44px、表头 38px；
登录统一用 `scripts/uiprobe/auth.mjs` 的 `getToken()`（带缓存，后端登录有限流）；
管理员凭据从仓库根目录 `.env` 的 `UI_ADMIN_*` 读取（见 `scripts/uiprobe/env.mjs`）。
