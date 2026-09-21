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
#
# 管理员凭据来自仓库根目录的 .env（UI_ADMIN_USER / UI_ADMIN_PASS，该文件已被 gitignore），
# 受版本控制的脚本里不写死口令；也可用参数临时覆盖。

param(
  [switch]$SkipBuild,
  [string]$Student = 'demo05',
  [string]$StudentPass = 'demo123',
  [string]$Admin = '',
  [string]$AdminPass = ''
)

$ErrorActionPreference = 'Continue'
$root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
# 注意：PowerShell 函数内 `$failures += ...` 只改函数局部副本（数组是值语义），
# 必须写 $script:failures，否则汇总会把失败报成通过。
$script:failures = @()
$results = [ordered]@{}

function Get-DotEnv([string]$path) {
  $map = @{}
  if (-not (Test-Path $path)) { return $map }
  foreach ($line in Get-Content $path) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -le 0) { continue }
    $map[$t.Substring(0, $i).Trim()] = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
  }
  return $map
}

$envFile = Get-DotEnv (Join-Path $root '.env')
if (-not $Admin) { $Admin = $envFile['UI_ADMIN_USER'] }
if (-not $AdminPass) { $AdminPass = $envFile['UI_ADMIN_PASS'] }
if (-not $Admin -or -not $AdminPass) {
  Write-Host "缺少管理员凭据：请在 $root\.env 里配置 UI_ADMIN_USER 与 UI_ADMIN_PASS（该文件已被 gitignore）" -ForegroundColor Red
  exit 2
}

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
  node scripts/uiprobe/audit.mjs --user $Admin --pass $AdminPass --only /contest/226,/contest/226/standings,/contest/226/submissions,/contest/226/problem/437,/admin/problems,/admin/users,/admin/judge,/admin/problems/437/tests,/problem/437/edit,/problem/437/edit?tab=settings,/problem/437/submit-file,/contest/new,/demo/rolling
  Pop-Location
}

# 5) 对比度（WCAG AA）
Step '对比度 (WCAG AA)' -expectFailMarker '低于 AA 的文字：[1-9]' {
  Push-Location $root
  node scripts/uiprobe/contrast.mjs --user $Student --pass $StudentPass
  Pop-Location
}

# 6) 交互断言（probe-problem-settings 需要管理员凭据，用 $Admin 跑）
foreach ($probe in 'probe.mjs', 'probe-problem.mjs', 'probe-shell.mjs') {
  Step "交互断言 · $probe" {
    Push-Location $root
    node "scripts/uiprobe/$probe" --user $Student --pass $StudentPass
    Pop-Location
  }
}

Step "交互断言 · probe-profile.mjs" {
  Push-Location $root
  node scripts/uiprobe/probe-profile.mjs --user $Student --pass $StudentPass
  Pop-Location
}

Step "交互断言 · probe-problem-settings.mjs" {
  Push-Location $root
  node scripts/uiprobe/probe-problem-settings.mjs
  Pop-Location
}

Step "交互断言 · probe-function-problem.mjs" {
  Push-Location $root
  node scripts/uiprobe/probe-function-problem.mjs
  Pop-Location
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
