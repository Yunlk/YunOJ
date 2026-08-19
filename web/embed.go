// Package web 通过 go:embed 嵌入前端构建产物（web/dist），
// 使 web 服务成为单二进制部署。dist 目录需在构建前存在：
// 未构建过前端时仅有占位文件 .gitkeep（服务返回 404），
// 执行 `cd web && npm run build` 或 Docker 构建后即包含完整产物。
package web

import (
	"embed"
	"io/fs"
)

//go:embed all:dist
var dist embed.FS

// Dist 返回前端构建产物文件系统。
func Dist() (fs.FS, error) {
	return fs.Sub(dist, "dist")
}
