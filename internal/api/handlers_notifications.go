package api

import (
	"errors"
	"net/http"
	"strings"

	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

type notificationPayload struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Kind    string `json:"kind"`
}

// handleListNotifications 列出当前用户通知。
func (a *API) handleListNotifications(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	items, err := a.store.ListNotifications(r.Context(), u.ID, 100)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询通知失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleReadNotification 标记通知已读。
func (a *API) handleReadNotification(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的通知 ID")
		return
	}
	if err := a.store.MarkNotificationRead(r.Context(), u.ID, id); err != nil {
		writeError(w, http.StatusNotFound, "通知不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleCreateNotification 发布全站通知。
func (a *API) handleCreateNotification(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	var req notificationPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Title) == "" || strings.TrimSpace(req.Content) == "" {
		writeError(w, http.StatusBadRequest, "标题和内容不能为空")
		return
	}
	if len(req.Title) > 128 || len(req.Content) > 64<<10 {
		writeError(w, http.StatusBadRequest, "通知内容过长")
		return
	}
	if req.Kind == "" {
		req.Kind = "system"
	}
	item := model.Notification{AuthorID: u.ID, Kind: req.Kind, Title: strings.TrimSpace(req.Title), Content: req.Content}
	if err := a.store.CreateNotification(r.Context(), &item); err != nil {
		writeError(w, http.StatusInternalServerError, "发布通知失败")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// handleDeleteNotification 管理员删除全站通知。
func (a *API) handleDeleteNotification(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的通知 ID")
		return
	}
	item, err := a.store.GetNotification(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "通知不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取通知失败")
		return
	}
	if item.RecipientID != nil {
		writeError(w, http.StatusBadRequest, "只能删除全站通知")
		return
	}
	if _, err := a.store.Pool().Exec(r.Context(), `DELETE FROM notifications WHERE id = $1`, id); err != nil {
		writeError(w, http.StatusInternalServerError, "删除通知失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
