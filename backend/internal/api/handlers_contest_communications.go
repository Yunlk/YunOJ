package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

type contestAnnouncementPayload struct {
	Title   string `json:"title"`
	Content string `json:"content"`
	Pinned  bool   `json:"pinned"`
}

type contestQuestionPayload struct {
	Content string `json:"content"`
}

type contestQuestionAnswerPayload struct {
	Answer string `json:"answer"`
	Public bool   `json:"public"`
}

func (a *API) getContestForCommunication(w http.ResponseWriter, r *http.Request) (model.Contest, bool) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return model.Contest{}, false
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return model.Contest{}, false
	}
	if err != nil {
		slogError(r, "比赛沟通信息", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return model.Contest{}, false
	}
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return model.Contest{}, false
	}
	return c, true
}

// handleContestCommunications 返回比赛广播和当前用户可见的答疑。
func (a *API) handleContestCommunications(w http.ResponseWriter, r *http.Request) {
	c, ok := a.getContestForCommunication(w, r)
	if !ok {
		return
	}
	u, loggedIn := userFromCtx(r.Context())
	if !loggedIn {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	isAdmin := u.Role == model.RoleAdmin
	if !isAdmin {
		registered, err := a.store.IsContestTeam(r.Context(), c.ID, u.ID)
		if err != nil || !registered {
			writeError(w, http.StatusForbidden, "请先报名参加该比赛")
			return
		}
	}
	announcements, err := a.store.ListContestAnnouncements(r.Context(), c.ID)
	if err != nil {
		slogError(r, "比赛广播", err)
		writeError(w, http.StatusInternalServerError, "查询广播失败")
		return
	}
	questions, err := a.store.ListContestQuestions(r.Context(), c.ID, u.ID, isAdmin)
	if err != nil {
		slogError(r, "比赛答疑", err)
		writeError(w, http.StatusInternalServerError, "查询答疑失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"announcements": announcements,
		"questions":     questions,
	})
}

// handleCreateContestAnnouncement 由管理员发布比赛广播。
func (a *API) handleCreateContestAnnouncement(w http.ResponseWriter, r *http.Request) {
	c, ok := a.getContestForCommunication(w, r)
	if !ok {
		return
	}
	u, _ := userFromCtx(r.Context())
	var req contestAnnouncementPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Title = strings.TrimSpace(req.Title)
	req.Content = strings.TrimSpace(req.Content)
	if len([]rune(req.Title)) > 120 {
		writeError(w, http.StatusBadRequest, "广播标题不能超过 120 字符")
		return
	}
	if req.Content == "" || len(req.Content) > 64<<10 {
		writeError(w, http.StatusBadRequest, "广播内容不能为空且不能超过 64KB")
		return
	}
	item := model.ContestAnnouncement{
		ContestID: c.ID, AuthorID: u.ID, Title: req.Title, Content: req.Content, Pinned: req.Pinned,
	}
	if err := a.store.CreateContestAnnouncement(r.Context(), &item); err != nil {
		slogError(r, "发布比赛广播", err)
		writeError(w, http.StatusInternalServerError, "发布广播失败")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// handleDeleteContestAnnouncement 由管理员删除比赛广播。
func (a *API) handleDeleteContestAnnouncement(w http.ResponseWriter, r *http.Request) {
	c, ok := a.getContestForCommunication(w, r)
	if !ok {
		return
	}
	aid, err := strconv.ParseInt(chi.URLParam(r, "announcement_id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的广播 ID")
		return
	}
	if err := a.store.DeleteContestAnnouncement(r.Context(), c.ID, aid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "广播不存在")
			return
		}
		slogError(r, "删除比赛广播", err)
		writeError(w, http.StatusInternalServerError, "删除广播失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleCreateContestQuestion 由报名选手提交比赛答疑。
func (a *API) handleCreateContestQuestion(w http.ResponseWriter, r *http.Request) {
	c, ok := a.getContestForCommunication(w, r)
	if !ok {
		return
	}
	u, loggedIn := userFromCtx(r.Context())
	if !loggedIn {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	if u.Role != model.RoleAdmin {
		registered, err := a.store.IsContestTeam(r.Context(), c.ID, u.ID)
		if err != nil || !registered {
			writeError(w, http.StatusForbidden, "请先报名参加该比赛")
			return
		}
	}
	var req contestQuestionPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Content = strings.TrimSpace(req.Content)
	if req.Content == "" || len(req.Content) > 16<<10 {
		writeError(w, http.StatusBadRequest, "提问不能为空且不能超过 16KB")
		return
	}
	item := model.ContestQuestion{ContestID: c.ID, AskerID: u.ID, Content: req.Content}
	if err := a.store.CreateContestQuestion(r.Context(), &item); err != nil {
		slogError(r, "提交比赛答疑", err)
		writeError(w, http.StatusInternalServerError, "提交问题失败")
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

// handleAnswerContestQuestion 由管理员发布或修正比赛答疑。
func (a *API) handleAnswerContestQuestion(w http.ResponseWriter, r *http.Request) {
	c, ok := a.getContestForCommunication(w, r)
	if !ok {
		return
	}
	qid, err := strconv.ParseInt(chi.URLParam(r, "question_id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的问题 ID")
		return
	}
	var req contestQuestionAnswerPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	req.Answer = strings.TrimSpace(req.Answer)
	if req.Answer == "" || len(req.Answer) > 16<<10 {
		writeError(w, http.StatusBadRequest, "回答不能为空且不能超过 16KB")
		return
	}
	u, _ := userFromCtx(r.Context())
	if err := a.store.AnswerContestQuestion(r.Context(), c.ID, qid, u.ID, req.Answer, req.Public); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "问题不存在")
			return
		}
		slogError(r, "回答比赛答疑", err)
		writeError(w, http.StatusInternalServerError, "保存回答失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}
