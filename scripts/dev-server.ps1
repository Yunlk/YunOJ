# 本地开发：启动 backend API 服务（原生运行，不依赖 Docker）
# 前置：postgres/redis 已就绪（docker compose up -d postgres redis）
# 用法：pwsh -File scripts/dev-server.ps1
$ErrorActionPreference = 'Stop'

# 国内网络默认走 goproxy.cn，海外可改为 https://proxy.golang.org,direct
$env:GOPROXY = if ($env:GOPROXY) { $env:GOPROXY } else { 'https://goproxy.cn,direct' }
$env:GOTOOLCHAIN = 'local'

Set-Location (Join-Path $PSScriptRoot '..\backend')
go run ./cmd/server
