package api

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"time"

	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// handleProfile 返回当前用户的个人中心聚合数据。
func (a *API) handleProfile(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	var ranking any
	if model.IsStudent(u.Role) {
		u.Rating = 1000
		if item, rankingErr := a.store.GetUserRankingEntry(r.Context(), u.ID); rankingErr == nil {
			u.Rating = item.Rating
			u.Rank = item.Rank
			ranking = item
		} else if !errors.Is(rankingErr, store.ErrNotFound) {
			slogError(r, "用户排名", rankingErr)
		}
	}
	total, accepted, problems, contests, err := a.store.GetUserSubmissionStats(r.Context(), u.ID)
	if err != nil {
		slogError(r, "个人统计", err)
		writeError(w, http.StatusInternalServerError, "查询个人统计失败")
		return
	}
	activity, err := a.store.ListUserActivity(r.Context(), u.ID, time.Now().AddDate(-1, 0, -1))
	if err != nil {
		slogError(r, "个人热力图", err)
		writeError(w, http.StatusInternalServerError, "查询个人活动失败")
		return
	}
	contestItems, err := a.store.ListUserContestSummaries(r.Context(), u.ID)
	if err != nil {
		slogError(r, "个人比赛", err)
		writeError(w, http.StatusInternalServerError, "查询个人比赛失败")
		return
	}
	recent, _, err := a.store.ListSubmissions(r.Context(), store.SubmissionFilter{
		UserID: &u.ID, Page: 1, Size: 8,
	})
	if err != nil {
		slogError(r, "个人提交", err)
		writeError(w, http.StatusInternalServerError, "查询个人提交失败")
		return
	}
	recentItems := make([]submissionListItem, 0, len(recent))
	for _, s := range recent {
		recentItems = append(recentItems, submissionListItem{
			ID: s.ID, ProblemID: s.ProblemID, ProblemTitle: s.ProblemTitle,
			UserID: s.UserID, Username: s.Username, Language: s.Language,
			Status: s.Status, TimeMs: s.TimeMs, MemoryKb: s.MemoryKb,
			Score: s.Score, CreatedAt: s.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"user":    u,
		"ranking": ranking,
		"stats": map[string]int64{
			"total_submissions":    total,
			"accepted_submissions": accepted,
			"attempted_problems":   problems,
			"contests":             contests,
		},
		"activity":           activity,
		"recent_submissions": recentItems,
		"contests":           contestItems,
	})
}

// handleUploadUserAvatar 上传当前用户头像。
func (a *API) handleUploadUserAvatar(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	r.Body = http.MaxBytesReader(w, r.Body, maxAvatarBytes+1<<20)
	if err := r.ParseMultipartForm(4 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "解析上传内容失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少文件字段 file")
		return
	}
	defer file.Close()
	img, err := io.ReadAll(io.LimitReader(file, maxAvatarBytes+1))
	if err != nil || len(img) > maxAvatarBytes {
		writeError(w, http.StatusBadRequest, "头像不能超过 2MB")
		return
	}
	ct := http.DetectContentType(img)
	ext, ok := avatarExtByType[ct]
	if !ok {
		writeError(w, http.StatusBadRequest, "头像仅支持 JPG/PNG/GIF/WebP 图片")
		return
	}
	filename := fmt.Sprintf("avatars/u%d_%d.%s", u.ID, time.Now().UnixNano(), ext)
	if err := os.MkdirAll(filepath.Join(a.cfg.DataDir, "avatars"), 0o755); err != nil {
		slogError(r, "创建用户头像目录", err)
		writeError(w, http.StatusInternalServerError, "保存头像失败")
		return
	}
	if err := os.WriteFile(filepath.Join(a.cfg.DataDir, filename), img, 0o644); err != nil {
		slogError(r, "保存用户头像", err)
		writeError(w, http.StatusInternalServerError, "保存头像失败")
		return
	}
	if u.Avatar != "" {
		_ = os.Remove(filepath.Join(a.cfg.DataDir, u.Avatar))
	}
	if err := a.store.UpdateUserAvatar(r.Context(), u.ID, filename); err != nil {
		slogError(r, "更新用户头像记录", err)
		writeError(w, http.StatusInternalServerError, "保存头像失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"avatar": filename})
}

// handleServeUserAvatar 提供用户头像文件。头像本身不包含敏感信息，可公开读取。
func (a *API) handleServeUserAvatar(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的用户 ID")
		return
	}
	u, err := a.store.GetUserByID(r.Context(), id)
	if err != nil {
		if err == store.ErrNotFound {
			writeError(w, http.StatusNotFound, "用户不存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "读取头像失败")
		return
	}
	dir, base := path.Split(u.Avatar)
	if u.Avatar == "" || dir != "avatars/" || base == "" || base == "." || base == ".." {
		writeError(w, http.StatusNotFound, "该用户未上传头像")
		return
	}
	b, err := os.ReadFile(filepath.Join(a.cfg.DataDir, u.Avatar))
	if err != nil {
		writeError(w, http.StatusNotFound, "头像文件不存在")
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(b))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(b)
}
