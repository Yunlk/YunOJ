package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

type discussionPayload struct {
	Content string `json:"content"`
}
type editorialPayload struct {
	Content string `json:"content"`
}

// handleProblemLearning 返回收藏状态、讨论和官方题解。
func (a *API) handleProblemLearning(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) || p.Status != model.ProblemStatusPublished {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	discussions, err := a.store.ListProblemDiscussions(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询讨论失败")
		return
	}
	var favorite bool
	if u, ok := userFromCtx(r.Context()); ok {
		favorite, _ = a.store.IsProblemFavorite(r.Context(), u.ID, id)
	}
	resp := map[string]any{"discussions": discussions, "favorite": favorite}
	if editorial, editorialErr := a.store.GetProblemEditorial(r.Context(), id); editorialErr == nil {
		resp["editorial"] = editorial
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleToggleProblemFavorite 收藏/取消收藏。
func (a *API) handleToggleProblemFavorite(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	favorite, err := a.store.ToggleProblemFavorite(r.Context(), u.ID, id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "更新收藏失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"favorite": favorite})
}

// handleListFavorites 返回当前用户收藏题目。
func (a *API) handleListFavorites(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	items, err := a.store.ListFavoriteProblems(r.Context(), u.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询收藏失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleCreateProblemDiscussion 创建题目讨论。
func (a *API) handleCreateProblemDiscussion(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	var req discussionPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := store.ValidateDiscussionContent(req.Content); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	item := model.ProblemDiscussion{ProblemID: id, UserID: u.ID, Content: strings.TrimSpace(req.Content), Username: u.Username}
	if err := a.store.CreateProblemDiscussion(r.Context(), &item); err != nil {
		writeError(w, http.StatusInternalServerError, "发布讨论失败")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// handleDeleteProblemDiscussion 删除讨论。
func (a *API) handleDeleteProblemDiscussion(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的讨论 ID")
		return
	}
	admin := u.Role == model.RoleAdmin
	if err := a.store.DeleteProblemDiscussion(r.Context(), id, u.ID, admin); err != nil {
		writeError(w, http.StatusNotFound, "讨论不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleUpsertProblemEditorial 保存官方题解。
func (a *API) handleUpsertProblemEditorial(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	var req editorialPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.Content) > 64<<10 {
		writeError(w, http.StatusBadRequest, "题解过长（最大 64KB）")
		return
	}
	if err := a.store.UpsertProblemEditorial(r.Context(), id, u.ID, req.Content); err != nil {
		writeError(w, http.StatusInternalServerError, "保存题解失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
