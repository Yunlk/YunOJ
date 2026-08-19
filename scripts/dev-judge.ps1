# 本地开发：启动评测机（原生运行）
# 仅限 Linux：需要 isolate（sudo apt install isolate 或编译 third_party/isolate）
# 用法：pwsh -File scripts/dev-judge.ps1   （Linux 下的 pwsh，或改用 bash 等价命令）
$ErrorActionPreference = 'Stop'

$env:GOPROXY = if ($env:GOPROXY) { $env:GOPROXY } else { 'https://goproxy.cn,direct' }
$env:GOTOOLCHAIN = 'local'
# 裸 Linux 服务器可开启 cgroup 精确内存计量
$env:ISOLATE_CG = if ($env:ISOLATE_CG) { $env:ISOLATE_CG } else { 'false' }

Set-Location (Join-Path $PSScriptRoot '..')
go run ./cmd/judge
