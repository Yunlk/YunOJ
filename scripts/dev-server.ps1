# 本地开发：启动 backend API 服务（原生运行，不依赖 Docker）
# 前置：postgres/redis 已就绪 —— 本机 Docker 已迁移到 WSL Arch：
#   pwsh -File scripts/wsl-docker.ps1 up      # 在 WSL 里拉起 postgres/redis/judge
# 用法：pwsh -File scripts/dev-server.ps1
#
# 端口：8080 被 National Instruments 的 NI Application Web Server 服务占用，
# 因此默认监听 8090；前端 vite 代理默认指向 8090（见 frontend/vite.config.ts）。
# 需要换端口：$env:SERVER_ADDR=':8080' 后重新运行本脚本，并同步设置 VITE_API_TARGET。
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot

# 加载仓库根目录的 .env：后端只读进程环境变量，不会自己解析 .env
# （compose 会自动读取 .env，原生 go run 不会）。不覆盖已显式设置的环境变量。
$envFile = Join-Path $root '.env'
if (Test-Path $envFile) {
  $loaded = 0
  foreach ($line in Get-Content $envFile) {
    $t = $line.Trim()
    if (-not $t -or $t.StartsWith('#')) { continue }
    $i = $t.IndexOf('=')
    if ($i -le 0) { continue }
    $key = $t.Substring(0, $i).Trim()
    $value = $t.Substring($i + 1).Trim().Trim('"').Trim("'")
    if (-not [Environment]::GetEnvironmentVariable($key, 'Process')) {
      [Environment]::SetEnvironmentVariable($key, $value, 'Process')
      $loaded++
    }
  }
  Write-Host "已从 .env 加载 $loaded 项配置（含 JWT_SECRET）"
} else {
  Write-Warning "未找到 $envFile —— 将使用内置开发默认值（JWT 密钥为公开的默认串，请勿用于生产）"
}

# 国内网络默认走 goproxy.cn，海外可改为 https://proxy.golang.org,direct
$env:GOPROXY = if ($env:GOPROXY) { $env:GOPROXY } else { 'https://goproxy.cn,direct' }
$env:GOTOOLCHAIN = 'local'
$env:SERVER_ADDR = if ($env:SERVER_ADDR) { $env:SERVER_ADDR } else { ':' + $(if ($env:HTTP_PORT) { $env:HTTP_PORT } else { '8090' }) }

Write-Host "后端监听 $($env:SERVER_ADDR)（数据库/Redis 在 WSL Arch 的容器里，127.0.0.1:5432/6379）"

Set-Location (Join-Path $root 'backend')
go run ./cmd/server
