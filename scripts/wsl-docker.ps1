# YunOJ 的 Docker 栈管理（运行在 WSL Arch 里，从 Windows 侧调用）
#
# 背景：本项目 Docker 已从 Docker Desktop 迁移到 WSL Arch 发行版，
#       容器内的 127.0.0.1 端口经 WSL 转发后，Windows 侧仍可用 localhost 访问。
#
# 用法：
#   pwsh -File scripts/wsl-docker.ps1                 # 查看状态（默认）
#   pwsh -File scripts/wsl-docker.ps1 up              # 拉起 postgres redis judge
#   pwsh -File scripts/wsl-docker.ps1 up postgres redis
#   pwsh -File scripts/wsl-docker.ps1 ps
#   pwsh -File scripts/wsl-docker.ps1 logs judge      # 也可 logs -f backend
#   pwsh -File scripts/wsl-docker.ps1 restart judge
#   pwsh -File scripts/wsl-docker.ps1 build           # 重建镜像
#   pwsh -File scripts/wsl-docker.ps1 db-shell        # 进 psql
#   pwsh -File scripts/wsl-docker.ps1 db-backup       # 导出数据库到 .tools/migration/
#   pwsh -File scripts/wsl-docker.ps1 shell           # 进 WSL 仓库目录
#
# 环境变量：YUNOJ_WSL_DISTRO 可覆盖发行版名（默认 Arch）
[CmdletBinding()]
param(
  [Parameter(Position = 0)]
  [ValidateSet('status', 'up', 'down', 'ps', 'logs', 'restart', 'build', 'db-shell', 'db-backup', 'shell')]
  [string]$Action = 'status',

  [Parameter(Position = 1, ValueFromRemainingArguments = $true)]
  [string[]]$Rest = @()
)

$ErrorActionPreference = 'Stop'
$Distro = if ($env:YUNOJ_WSL_DISTRO) { $env:YUNOJ_WSL_DISTRO } else { 'Arch' }

# 仓库路径：Windows -> WSL（D:\git\YunOJ -> /mnt/d/git/YunOJ）
$RepoWin = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$Drive = $RepoWin.Substring(0, 1).ToLower()
$RepoWsl = "/mnt/$Drive" + ($RepoWin.Substring(2) -replace '\\', '/')

function Invoke-InWsl {
  param([string]$Command)
  & wsl.exe -d $Distro bash -lc $Command
  if ($LASTEXITCODE -ne 0) {
    throw "WSL 命令失败（exit $LASTEXITCODE）: $Command"
  }
}

$composeArgs = ($Rest -join ' ').Trim()

switch ($Action) {
  'status' {
    Write-Host "=== WSL 发行版 [$Distro] ===" -ForegroundColor Cyan
    $state = (wsl.exe -l -v | Out-String) -split "`n" | Where-Object { $_ -match $Distro }
    Write-Host ($state -join "`n")

    Write-Host "`n=== Docker 服务 ===" -ForegroundColor Cyan
    Invoke-InWsl "systemctl is-active docker; docker version --format 'server={{.Server.Version}}'"

    Write-Host "`n=== 容器状态 ===" -ForegroundColor Cyan
    Invoke-InWsl "cd '$RepoWsl' && docker compose ps"

    Write-Host "`n=== 端口可达性（Windows 侧）===" -ForegroundColor Cyan
    foreach ($p in 5432, 6379, 8090) {
      $r = Test-NetConnection -ComputerName 127.0.0.1 -Port $p -WarningAction SilentlyContinue
      $mark = if ($r.TcpTestSucceeded) { '可达' } else { '不可达' }
      Write-Host ("  127.0.0.1:{0,-6} {1}" -f $p, $mark)
    }
  }
  'up' {
    $services = if ($composeArgs) { $composeArgs } else { 'postgres redis judge' }
    Write-Host "在 WSL 里启动: $services" -ForegroundColor Cyan
    Invoke-InWsl "cd '$RepoWsl' && docker compose up -d $services"
    Start-Sleep -Seconds 4
    Invoke-InWsl "cd '$RepoWsl' && docker compose ps"
  }
  'down' {
    Write-Host "停止容器（保留数据卷与 data/ 目录）" -ForegroundColor Cyan
    Invoke-InWsl "cd '$RepoWsl' && docker compose down"
  }
  'ps' { Invoke-InWsl "cd '$RepoWsl' && docker compose ps" }
  'logs' {
    $target = if ($composeArgs) { $composeArgs } else { '' }
    Invoke-InWsl "cd '$RepoWsl' && docker compose logs --tail 40 $target"
  }
  'restart' {
    $target = if ($composeArgs) { $composeArgs } else { '' }
    Invoke-InWsl "cd '$RepoWsl' && docker compose restart $target"
  }
  'build' {
    Write-Host "在 WSL 里构建镜像（isolate 编译较慢，请耐心）" -ForegroundColor Cyan
    Invoke-InWsl "cd '$RepoWsl' && docker compose build $composeArgs"
  }
  'db-shell' {
    Invoke-InWsl "docker exec -it yunoj-postgres-1 psql -U yunoj -d yunoj"
  }
  'db-backup' {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $dirWin = Join-Path $RepoWin '.tools\migration'
    New-Item -ItemType Directory -Force -Path $dirWin | Out-Null
    $fileWin = Join-Path $dirWin "yunoj-$stamp.dump"
    $fileWsl = "$RepoWsl/.tools/migration/yunoj-$stamp.dump"
    Write-Host "导出数据库到 $fileWin" -ForegroundColor Cyan
    Invoke-InWsl "docker exec yunoj-postgres-1 pg_dump -U yunoj -d yunoj -Fc -f /tmp/backup.dump && docker cp yunoj-postgres-1:/tmp/backup.dump '$fileWsl' && docker exec yunoj-postgres-1 rm -f /tmp/backup.dump"
    Get-Item $fileWin | Select-Object Name, @{ n = 'SizeMB'; e = { [math]::Round($_.Length / 1MB, 2) } } | Format-Table -AutoSize
  }
  'shell' {
    Write-Host "进入 WSL [$Distro] 的仓库目录 $RepoWsl" -ForegroundColor Cyan
    & wsl.exe -d $Distro --cd $RepoWsl
  }
}
