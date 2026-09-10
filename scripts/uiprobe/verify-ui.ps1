# YunOJ 前端一键验收
#
# 用法：pwsh -File scripts/uiprobe/verify-ui.ps1            # 全量
#       pwsh -File scripts/uiprobe/verify-ui.ps1 -SkipBuild # 跳过生产构建（更快）
#
# 前提：
#   1) 后端 :8090、前端 dev server :5173 已运行（见 scripts/dev-server.ps1 与 npm run dev）；
#   2) 本目录已执行过 npm install（提供 playwright-core，用于驱动系统 Chrome）。
# 判定标准：类型检查 0 错、构建成功、审计无「无标签控件/横向溢出/HTTP 4xx-5xx」、
#           表格行高 44px、对比度 0 违规、各 probe 全绿。

param(
  [switch]$SkipBuild,
  [string]$Student = 'demo05',
  [string]$StudentPass = 'demo123',
  [string]$Admin = 'e2eadmin',
  [string]$AdminPass = 'Yunoj#2026'
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# 注意：PowerShell 函数内 `$failures += ...` 只改函数局部副本（数组是值语义），
# 必须写 $script:failures，否则汇总会把失败报成通过。
$script:failures = @()
$results = [ordered]@{}

function Step($name, [scriptblock]$body, [string]$expectFailMarker = '') {
  Write-Host "`n=== $name ===" -ForegroundColor Cyan
  $output = & $body 2>&1 | Out-String
  $code = $LASTEXITCODE
  $bad = $false
  if ($code -ne 0) { $bad = $true }
  if ($expectFailMarker -and $output -match $expectFailMarker) { $bad = $true }
  $results[$name] = if ($bad) { 'FAIL' } else { 'PASS' }
  if ($bad) { $script:failures += $name }
  $output.Trim() -split "`n" | Select-Object -Last 18 | ForEach-Object { Write-Host "  $_" }
}

# 1) 类型检查（必须指定 tsconfig.app.json：根 tsconfig 是 references 方案，普通 tsc 是空操作）
Step '类型检查 (tsc -p tsconfig.app.json)' {
  Push-Location "$root\frontend"; npx tsc -p tsconfig.app.json --noEmit; Pop-Location
}

# 2) 生产构建
if (-not $SkipBuild) {
  Step '生产构建 (tsc -b && vite build)' {
    Push-Location "$root\frontend"; npm run build; Pop-Location
  }
}

# 3) 布局 / 可访问性审计：选手端
Step '审计 · 选手端' -expectFailMarker '无标签控件|横向溢出|HTTP 4' {
  Push-Location $root
  node scripts/uiprobe/audit.mjs --user $Student --pass $StudentPass --only /,/problems,/problem/437,/status,/contests,/ranking,/profile,/favorites,/notifications,/settings,/groups
  Pop-Location
}

# 4) 布局 / 可访问性审计：比赛与管理端
Step '审计 · 比赛与管理端' -expectFailMarker '无标签控件|横向溢出|HTTP 4' {
  Push-Location $root
  node scripts/uiprobe/audit.mjs --user $Admin --pass $AdminPass --only /contest/226,/contest/226/standings,/contest/226/submissions,/contest/226/problem/437,/admin/problems,/admin/users,/admin/judge,/admin/problems/437/tests,/problem/437/edit,/problem/437/submit-file,/contest/new,/demo/rolling
  Pop-Location
}

# 5) 对比度（WCAG AA）
Step '对比度 (WCAG AA)' -expectFailMarker '低于 AA 的文字：[1-9]' {
  Push-Location $root
  node scripts/uiprobe/contrast.mjs --user $Student --pass $StudentPass
  Pop-Location
}

# 6) 交互断言
foreach ($probe in 'probe.mjs', 'probe-problem.mjs', 'probe-shell.mjs') {
  Step "交互断言 · $probe" {
    Push-Location $root
    node "scripts/uiprobe/$probe" --user $Student --pass $StudentPass
    Pop-Location
  }
}

Write-Host "`n================ 汇总 ================" -ForegroundColor Cyan
foreach ($k in $results.Keys) {
  $color = if ($results[$k] -eq 'PASS') { 'Green' } else { 'Red' }
  Write-Host ("  {0,-34} {1}" -f $k, $results[$k]) -ForegroundColor $color
}
if ($script:failures.Count -eq 0) {
  Write-Host "`n✅ 全部通过" -ForegroundColor Green
  exit 0
}
Write-Host ("`n❌ 未通过：{0}" -f ($script:failures -join '、')) -ForegroundColor Red
exit 1
