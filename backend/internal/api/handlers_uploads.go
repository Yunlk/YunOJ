package api

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
)

const maxMarkdownImageBytes = 4 << 20

var markdownImageExtByType = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/gif":  "gif",
	"image/webp": "webp",
}

// handleUploadMarkdownImage 上传可嵌入 Markdown 的位图图片。
// 图片与具体比赛解耦，便于新建比赛时先插图再保存说明。
func (a *API) handleUploadMarkdownImage(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, maxMarkdownImageBytes+1<<20)
	if err := r.ParseMultipartForm(maxMarkdownImageBytes + 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, "解析图片上传失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少图片文件（multipart 字段名 file）")
		return
	}
	defer file.Close()
	b, err := io.ReadAll(io.LimitReader(file, maxMarkdownImageBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取图片失败")
		return
	}
	if len(b) > maxMarkdownImageBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "图片不能超过 4MB")
		return
	}
	ext, ok := markdownImageExtByType[http.DetectContentType(b)]
	if !ok {
		writeError(w, http.StatusBadRequest, "仅支持 JPG、PNG、GIF、WebP 图片")
		return
	}

	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		writeError(w, http.StatusInternalServerError, "生成图片名称失败")
		return
	}
	filename := fmt.Sprintf("md-%d-%s.%s", time.Now().UnixNano(), hex.EncodeToString(random[:]), ext)
	relativePath := path.Join("markdown-images", filename)
	if err := os.MkdirAll(filepath.Join(a.cfg.DataDir, "markdown-images"), 0o755); err != nil {
		slogError(r, "创建 Markdown 图片目录", err)
		writeError(w, http.StatusInternalServerError, "保存图片失败")
		return
	}
	if err := os.WriteFile(filepath.Join(a.cfg.DataDir, relativePath), b, 0o644); err != nil {
		slogError(r, "保存 Markdown 图片", err)
		writeError(w, http.StatusInternalServerError, "保存图片失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{
		"url": "/api/markdown-images/" + filename,
	})
}

// handleServeMarkdownImage 提供 Markdown 图片，文件名仅允许服务端生成的单层名称。
func (a *API) handleServeMarkdownImage(w http.ResponseWriter, r *http.Request) {
	filename := chi.URLParam(r, "filename")
	if filename == "" || path.Base(filename) != filename || strings.ContainsAny(filename, `/\\`) {
		writeError(w, http.StatusNotFound, "图片不存在")
		return
	}
	ext := strings.ToLower(filepath.Ext(filename))
	if ext != ".jpg" && ext != ".png" && ext != ".gif" && ext != ".webp" {
		writeError(w, http.StatusNotFound, "图片不存在")
		return
	}
	b, err := os.ReadFile(filepath.Join(a.cfg.DataDir, "markdown-images", filename))
	if err != nil {
		writeError(w, http.StatusNotFound, "图片不存在")
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(b))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(b)
}
