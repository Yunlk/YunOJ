package api

import (
	"crypto/rand"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	// maxAttachmentBytes 单个附件上限。题目附件多为压缩包/PDF，给到 32MB。
	maxAttachmentBytes = 32 << 20
	// maxAttachmentsPerProblem 每题附件数量上限，避免把题目当网盘用。
	maxAttachmentsPerProblem = 20
	// attachmentDir 附件目录名（相对 DATA_DIR），与测试数据分开存放。
	attachmentDir = "problem-attachments"
)

// attachmentDTO 对外暴露的附件信息（不包含服务器上的存储路径）。
type attachmentDTO struct {
	ID          int64     `json:"id"`
	ProblemID   int64     `json:"problem_id"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	Uploader    string    `json:"uploader,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

func toAttachmentDTO(a model.ProblemAttachment) attachmentDTO {
	return attachmentDTO{
		ID: a.ID, ProblemID: a.ProblemID, Filename: a.Filename, ContentType: a.ContentType,
		SizeBytes: a.SizeBytes, Uploader: a.Uploader, CreatedAt: a.CreatedAt,
	}
}

// safeAttachmentName 归一化用户提交的文件名：只保留基名，剔除路径分隔符与控制字符。
func safeAttachmentName(name string) string {
	name = strings.ReplaceAll(name, "\\", "/")
	name = path.Base(name)
	name = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == ".." {
		return "attachment"
	}
	if len([]rune(name)) > 120 {
		name = string([]rune(name)[:120])
	}
	return name
}

// handleListProblemAttachments 列出题目附件。已发布题目对所有人开放，未发布仅管理员可见。
func (a *API) handleListProblemAttachments(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err != nil {
		slogError(r, "题目附件", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if !a.canViewProblem(r, p) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	items, err := a.store.ListProblemAttachments(r.Context(), id)
	if err != nil {
		slogError(r, "题目附件", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	dtos := make([]attachmentDTO, 0, len(items))
	for _, item := range items {
		dtos = append(dtos, toAttachmentDTO(item))
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": dtos, "total": len(dtos)})
}

// handleUploadProblemAttachment 上传题目附件（管理员）。
func (a *API) handleUploadProblemAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "题目不存在")
			return
		}
		slogError(r, "题目附件", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if count, err := a.store.CountProblemAttachments(r.Context(), id); err == nil && count >= maxAttachmentsPerProblem {
		writeError(w, http.StatusBadRequest, fmt.Sprintf("每题最多 %d 个附件，请先删除不用的", maxAttachmentsPerProblem))
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxAttachmentBytes+1<<20)
	if err := r.ParseMultipartForm(maxAttachmentBytes + 1<<20); err != nil {
		writeError(w, http.StatusBadRequest, "解析上传失败（单文件上限 32MB）")
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少附件（multipart 字段名 file）")
		return
	}
	defer file.Close()

	dir := filepath.Join(a.cfg.DataDir, attachmentDir, strconv.FormatInt(id, 10))
	if err := os.MkdirAll(dir, 0o755); err != nil {
		slogError(r, "创建附件目录", err)
		writeError(w, http.StatusInternalServerError, "保存附件失败")
		return
	}
	var random [8]byte
	if _, err := rand.Read(random[:]); err != nil {
		slogError(r, "生成附件名", err)
		writeError(w, http.StatusInternalServerError, "保存附件失败")
		return
	}
	stored := fmt.Sprintf("%d-%s%s", time.Now().UnixNano(), hex.EncodeToString(random[:]), filepath.Ext(header.Filename))
	abs := filepath.Join(dir, stored)

	out, err := os.Create(abs)
	if err != nil {
		slogError(r, "创建附件文件", err)
		writeError(w, http.StatusInternalServerError, "保存附件失败")
		return
	}
	written, copyErr := io.Copy(out, io.LimitReader(file, maxAttachmentBytes+1))
	closeErr := out.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(abs)
		slogError(r, "写入附件", firstErr(copyErr, closeErr))
		writeError(w, http.StatusInternalServerError, "保存附件失败")
		return
	}
	if written > maxAttachmentBytes {
		_ = os.Remove(abs)
		writeError(w, http.StatusRequestEntityTooLarge, "单个附件不能超过 32MB")
		return
	}
	if written == 0 {
		_ = os.Remove(abs)
		writeError(w, http.StatusBadRequest, "附件内容为空")
		return
	}

	filename := safeAttachmentName(header.Filename)
	contentType := header.Header.Get("Content-Type")
	if contentType == "" {
		contentType = mime.TypeByExtension(strings.ToLower(filepath.Ext(filename)))
	}
	uploader, _ := userFromCtx(r.Context())
	attachment := model.ProblemAttachment{
		ProblemID:   id,
		Filename:    filename,
		ContentType: contentType,
		SizeBytes:   written,
		StoragePath: path.Join(attachmentDir, strconv.FormatInt(id, 10), stored),
	}
	if uploader.ID > 0 {
		attachment.UploadedBy = &uploader.ID
	}
	if err := a.store.CreateProblemAttachment(r.Context(), &attachment); err != nil {
		_ = os.Remove(abs)
		slogError(r, "写入附件记录", err)
		writeError(w, http.StatusInternalServerError, "保存附件失败")
		return
	}
	attachment.Uploader = uploader.Username
	writeJSON(w, http.StatusCreated, toAttachmentDTO(attachment))
}

// handleDeleteProblemAttachment 删除题目附件（管理员），同时清理磁盘文件。
func (a *API) handleDeleteProblemAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	attachmentID, err := strconv.ParseInt(chi.URLParam(r, "attachment_id"), 10, 64)
	if err != nil || attachmentID <= 0 {
		writeError(w, http.StatusBadRequest, "无效的附件 ID")
		return
	}
	removed, err := a.store.DeleteProblemAttachment(r.Context(), id, attachmentID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "附件不存在")
		return
	}
	if err != nil {
		slogError(r, "删除附件", err)
		writeError(w, http.StatusInternalServerError, "删除失败")
		return
	}
	if removed.StoragePath != "" {
		_ = os.Remove(filepath.Join(a.cfg.DataDir, filepath.FromSlash(removed.StoragePath)))
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleDownloadProblemAttachment 下载题目附件。已发布题目对所有人开放。
func (a *API) handleDownloadProblemAttachment(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	attachmentID, err := strconv.ParseInt(chi.URLParam(r, "attachment_id"), 10, 64)
	if err != nil || attachmentID <= 0 {
		writeError(w, http.StatusBadRequest, "无效的附件 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if !a.canViewProblem(r, p) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	attachment, err := a.store.GetProblemAttachment(r.Context(), id, attachmentID)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "附件不存在")
		return
	}
	if err != nil {
		slogError(r, "下载附件", err)
		writeError(w, http.StatusInternalServerError, "下载失败")
		return
	}
	f, err := os.Open(filepath.Join(a.cfg.DataDir, filepath.FromSlash(attachment.StoragePath)))
	if err != nil {
		writeError(w, http.StatusNotFound, "附件文件已丢失")
		return
	}
	defer f.Close()

	if contentType := attachment.ContentType; contentType != "" {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", "application/octet-stream")
	}
	// 附件一律作为下载处理，禁止浏览器内联执行（nosniff 防类型嗅探）。
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", contentDisposition(attachment.Filename))
	if attachment.SizeBytes > 0 {
		w.Header().Set("Content-Length", strconv.FormatInt(attachment.SizeBytes, 10))
	}
	_, _ = io.Copy(w, f)
}

// contentDisposition 生成兼顾问号与中文文件名的下载头（ASCII 回退 + RFC 5987）。
func contentDisposition(filename string) string {
	fallback := strings.Map(func(r rune) rune {
		if r < 32 || r > 126 || r == '"' || r == '\\' {
			return '_'
		}
		return r
	}, filename)
	if fallback == "" {
		fallback = "attachment"
	}
	return fmt.Sprintf(`attachment; filename="%s"; filename*=UTF-8''%s`, fallback, urlEncodeRFC5987(filename))
}

func urlEncodeRFC5987(s string) string {
	const hexDigits = "0123456789ABCDEF"
	var b strings.Builder
	for i := 0; i < len(s); i++ {
		c := s[i]
		if (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9') ||
			c == '-' || c == '.' || c == '_' || c == '~' {
			b.WriteByte(c)
			continue
		}
		b.WriteByte('%')
		b.WriteByte(hexDigits[c>>4])
		b.WriteByte(hexDigits[c&0x0f])
	}
	return b.String()
}

// canViewProblem 公共接口的可见性：已发布题目对所有人可见，未发布仅管理员可见。
func (a *API) canViewProblem(r *http.Request, p model.Problem) bool {
	if p.Status == model.ProblemStatusPublished {
		return true
	}
	u, ok := userFromCtx(r.Context())
	return ok && u.Role == model.RoleAdmin
}

func firstErr(errs ...error) error {
	for _, err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
