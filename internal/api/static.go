package api

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/yunoj/yunoj/web"
)

// staticHandler 提供前端静态资源与 SPA 路由回退。
// 前端构建产物通过 go:embed 嵌入二进制，单文件部署。
func staticHandler() http.Handler {
	dist, err := web.Dist()
	if err != nil {
		panic(err)
	}
	fileServer := http.FileServer(http.FS(dist))

	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			http.NotFound(w, r)
			return
		}
		path := strings.TrimPrefix(r.URL.Path, "/")
		if path == "" {
			path = "index.html"
		}
		if _, err := dist.Open(path); err != nil {
			// 非静态资源路径（前端路由）回退到 index.html
			if idx, e := fs.ReadFile(dist, "index.html"); e == nil {
				w.Header().Set("Content-Type", "text/html; charset=utf-8")
				_, _ = w.Write(idx)
				return
			}
			http.NotFound(w, r)
			return
		}
		fileServer.ServeHTTP(w, r)
	})
}
