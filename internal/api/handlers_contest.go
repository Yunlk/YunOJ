package api

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// ---------- 请求/响应结构 ----------

type contestPayload struct {
	Title                 string     `json:"title"`
	Mode                  string     `json:"mode"`
	Feedback              string     `json:"feedback"`
	ScoreMode             string     `json:"score_mode"`
	PenaltyMinutes        int        `json:"penalty_minutes"`
	FreezeDurationMinutes int        `json:"freeze_duration_minutes"`
	RankKeys              []string   `json:"rank_keys"`
	StartTime             time.Time  `json:"start_time"`
	EndTime               time.Time  `json:"end_time"`
	Description           string     `json:"description"`
	Visibility            string     `json:"visibility"`
	RegStartTime          *time.Time `json:"reg_start_time"`
	RegEndTime            *time.Time `json:"reg_end_time"`
	SubmissionLimit       int        `json:"submission_limit"`
}

func validateContestPayload(p *contestPayload) string {
	if len(p.Title) == 0 || len(p.Title) > 128 {
		return "比赛名称长度需在 1-128 字符之间"
	}
	switch p.Mode {
	case model.ContestModeACM, model.ContestModeOI, model.ContestModeIOI:
	default:
		return "无效的比赛模式（ACM/OI/IOI）"
	}
	switch p.Feedback {
	case model.FeedbackRealtime, model.FeedbackBlind:
	default:
		return "无效的反馈模式（realtime/blind）"
	}
	switch p.ScoreMode {
	case model.ScoreModeAllOrNothing, model.ScoreModePartial:
	default:
		return "无效的计分模式（all_or_nothing/partial）"
	}
	if p.PenaltyMinutes < 0 || p.PenaltyMinutes > 600 {
		return "罚时需在 0-600 分钟之间"
	}
	if p.FreezeDurationMinutes < 0 || p.FreezeDurationMinutes > 720 {
		return "封榜时长需在 0-720 分钟之间"
	}
	if !p.EndTime.After(p.StartTime) {
		return "结束时间必须晚于开始时间"
	}
	if len(p.Description) > 64<<10 {
		return "比赛说明过长（最大 64KB）"
	}
	vis := p.Visibility
	if vis == "" {
		vis = model.ContestVisibilityPublic
	}
	switch vis {
	case model.ContestVisibilityPublic, model.ContestVisibilityPrivate:
	default:
		return "无效的比赛可见性（public/private）"
	}
	if p.RegStartTime != nil && p.RegEndTime != nil && p.RegEndTime.Before(*p.RegStartTime) {
		return "报名截止时间必须晚于报名开始时间"
	}
	if p.SubmissionLimit < 0 || p.SubmissionLimit > 1000 {
		return "默认提交上限需在 0-1000 之间（0 = 不限）"
	}
	return ""
}

func payloadToContest(p *contestPayload) model.Contest {
	vis := p.Visibility
	if vis == "" {
		vis = model.ContestVisibilityPublic
	}
	c := model.Contest{
		Title:                 p.Title,
		Mode:                  p.Mode,
		Feedback:              p.Feedback,
		ScoreMode:             p.ScoreMode,
		PenaltyMinutes:        p.PenaltyMinutes,
		FreezeDurationMinutes: p.FreezeDurationMinutes,
		RankKeys:              p.RankKeys,
		StartTime:             p.StartTime,
		EndTime:               p.EndTime,
		Description:           p.Description,
		Visibility:            vis,
		RegStartTime:          p.RegStartTime,
		RegEndTime:            p.RegEndTime,
		SubmissionLimit:       p.SubmissionLimit,
	}
	if c.RankKeys == nil {
		c.RankKeys = []string{}
	}
	return c
}

// ---------- 比赛 CRUD（管理员） ----------

func (a *API) handleCreateContest(w http.ResponseWriter, r *http.Request) {
	var payload contestPayload
	if !decodeJSON(w, r, &payload) {
		return
	}
	if msg := validateContestPayload(&payload); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	c := payloadToContest(&payload)
	if err := a.store.CreateContest(r.Context(), &c); err != nil {
		slogError(r, "创建比赛", err)
		writeError(w, http.StatusInternalServerError, "创建失败")
		return
	}
	writeJSON(w, http.StatusCreated, c)
}

func (a *API) handleUpdateContest(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	var payload contestPayload
	if !decodeJSON(w, r, &payload) {
		return
	}
	if msg := validateContestPayload(&payload); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	c := payloadToContest(&payload)
	c.ID = id
	if err := a.store.UpdateContest(r.Context(), &c); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "比赛不存在")
			return
		}
		slogError(r, "更新比赛", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	writeJSON(w, http.StatusOK, c)
}

func (a *API) handleDeleteContest(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	if err := a.store.DeleteContest(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "比赛不存在")
			return
		}
		slogError(r, "删除比赛", err)
		writeError(w, http.StatusInternalServerError, "删除失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- 比赛查询 ----------

func (a *API) handleListContests(w http.ResponseWriter, r *http.Request) {
	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	// private 比赛不出现在公开列表（管理员可见全部）
	items, total, err := a.store.ListContests(r.Context(), page, size, isAdmin)
	if err != nil {
		slogError(r, "比赛列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// contestProblemDTO 比赛题目视图（含标题与分值/上限覆盖）。
type contestProblemDTO struct {
	ProblemID int64  `json:"problem_id"`
	DisplayID string `json:"display_id"`
	SortOrder int    `json:"sort_order"`
	Title     string `json:"title"`
	// Score 单题分值覆盖（NULL = 用题目 manifest 总分）
	Score *int `json:"score"`
	// SubmissionLimit 单题提交上限覆盖（NULL = 继承比赛默认，0 = 不限）
	SubmissionLimit *int `json:"submission_limit"`
}

func (a *API) contestProblemsDTO(ctx context.Context, contestID int64) ([]contestProblemDTO, error) {
	cps, err := a.store.ListContestProblems(ctx, contestID)
	if err != nil {
		return nil, err
	}
	dtos := make([]contestProblemDTO, 0, len(cps))
	for _, cp := range cps {
		dto := contestProblemDTO{
			ProblemID: cp.ProblemID, DisplayID: cp.DisplayID, SortOrder: cp.SortOrder,
			Score: cp.Score, SubmissionLimit: cp.SubmissionLimit,
		}
		if p, err := a.store.GetProblem(ctx, cp.ProblemID); err == nil {
			dto.Title = p.Title
		}
		dtos = append(dtos, dto)
	}
	return dtos, nil
}

// contestVisibleTo 比赛可见性校验：private 比赛仅管理员与已报名用户可见
// （不可见时返回 404 错误消息，隐藏存在性）。
func (a *API) contestVisibleTo(r *http.Request, c model.Contest) (bool, string) {
	if c.Visibility != model.ContestVisibilityPrivate {
		return true, ""
	}
	u, loggedIn := userFromCtx(r.Context())
	if loggedIn && u.Role == model.RoleAdmin {
		return true, ""
	}
	if loggedIn {
		if registered, err := a.store.IsContestTeam(r.Context(), c.ID, u.ID); err == nil && registered {
			return true, ""
		}
	}
	return false, "比赛不存在"
}

func (a *API) handleGetContest(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "比赛详情", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	// private 比赛：仅管理员/报名者可见（404 隐藏存在性）
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return
	}
	problems, err := a.contestProblemsDTO(r.Context(), id)
	if err != nil {
		slogError(r, "比赛题目", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	u, loggedIn := userFromCtx(r.Context())
	resp := map[string]any{"contest": c, "problems": problems}
	if loggedIn {
		registered, _ := a.store.IsContestTeam(r.Context(), id, u.ID)
		resp["is_registered"] = registered
		resp["is_admin"] = u.Role == model.RoleAdmin
		if registered {
			if t, err := a.store.GetContestTeam(r.Context(), id, u.ID); err == nil {
				resp["my_team"] = map[string]any{"team_name": t.TeamName, "avatar": t.Avatar}
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---------- 比赛题目管理（管理员） ----------

// contestProblemPayload 添加/更新比赛题目的请求体。
type contestProblemPayload struct {
	ProblemID int64  `json:"problem_id"`
	DisplayID string `json:"display_id"`
	SortOrder int    `json:"sort_order"`
	// Score 单题分值覆盖（NULL = 用题目 manifest 总分）
	Score *int `json:"score"`
	// SubmissionLimit 单题提交上限覆盖（NULL = 继承比赛默认，0 = 不限）
	SubmissionLimit *int `json:"submission_limit"`
}

// validateContestProblemPayload 校验比赛题目字段。
func validateContestProblemPayload(p *contestProblemPayload) string {
	if strings.TrimSpace(p.DisplayID) == "" {
		return "请填写题号（如 A、B、P1）"
	}
	if len([]rune(p.DisplayID)) > 32 {
		return "题号最长 32 字符"
	}
	if p.Score != nil && (*p.Score < 0 || *p.Score > 100) {
		return "单题分值需在 0-100 之间"
	}
	if p.SubmissionLimit != nil && (*p.SubmissionLimit < 0 || *p.SubmissionLimit > 1000) {
		return "单题提交上限需在 0-1000 之间（0 = 不限）"
	}
	return ""
}

func (a *API) handleAddContestProblem(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	if _, err := a.store.GetContest(r.Context(), cid); err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	var req contestProblemPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := validateContestProblemPayload(&req); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if _, err := a.store.GetProblem(r.Context(), req.ProblemID); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err := a.store.AddContestProblem(r.Context(), model.ContestProblem{
		ContestID: cid, ProblemID: req.ProblemID, DisplayID: strings.TrimSpace(req.DisplayID),
		SortOrder: req.SortOrder, Score: req.Score, SubmissionLimit: req.SubmissionLimit,
	}); err != nil {
		slogError(r, "添加比赛题目", err)
		writeError(w, http.StatusInternalServerError, "操作失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleUpdateContestProblem 更新单道比赛题目（题号/分值/上限覆盖）。
func (a *API) handleUpdateContestProblem(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	pid, err := strconv.ParseInt(chi.URLParam(r, "problem_id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	var req contestProblemPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := validateContestProblemPayload(&req); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := a.store.UpdateContestProblem(r.Context(), model.ContestProblem{
		ContestID: cid, ProblemID: pid, DisplayID: strings.TrimSpace(req.DisplayID),
		Score: req.Score, SubmissionLimit: req.SubmissionLimit,
	}); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "该题目不属于本场比赛")
			return
		}
		slogError(r, "更新比赛题目", err)
		writeError(w, http.StatusInternalServerError, "操作失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleReorderContestProblems 拖拽排序：按给定题目 ID 顺序重写 sort_order。
func (a *API) handleReorderContestProblems(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	var req struct {
		ProblemIDs []int64 `json:"problem_ids"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	cps, err := a.store.ListContestProblems(r.Context(), cid)
	if err != nil {
		slogError(r, "重排比赛题目", err)
		writeError(w, http.StatusInternalServerError, "操作失败")
		return
	}
	if len(req.ProblemIDs) != len(cps) {
		writeError(w, http.StatusBadRequest, "必须提供全部比赛题目的完整排列")
		return
	}
	seen := map[int64]bool{}
	for _, pid := range req.ProblemIDs {
		if seen[pid] {
			writeError(w, http.StatusBadRequest, "题目 ID 重复")
			return
		}
		seen[pid] = true
	}
	for _, cp := range cps {
		if !seen[cp.ProblemID] {
			writeError(w, http.StatusBadRequest, "排列与比赛题目不一致")
			return
		}
	}
	if err := a.store.ReorderContestProblems(r.Context(), cid, req.ProblemIDs); err != nil {
		slogError(r, "重排比赛题目", err)
		writeError(w, http.StatusInternalServerError, "操作失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

func (a *API) handleRemoveContestProblem(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	pid, err := strconv.ParseInt(chi.URLParam(r, "problem_id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if err := a.store.RemoveContestProblem(r.Context(), cid, pid); err != nil {
		slogError(r, "移除比赛题目", err)
		writeError(w, http.StatusInternalServerError, "操作失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// ---------- 报名 ----------

func (a *API) handleRegisterContest(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	if _, err := a.store.GetContest(r.Context(), cid); err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	var req struct {
		TeamName string `json:"team_name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.TeamName) == 0 || len(req.TeamName) > 64 {
		writeError(w, http.StatusBadRequest, "队伍名长度需在 1-64 字符之间")
		return
	}
	// 报名时间窗校验（默认随比赛时间窗）
	c, err := a.store.GetContest(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if msg := contestRegWindowError(c, time.Now()); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := a.store.AddContestTeam(r.Context(), model.ContestTeam{
		ContestID: cid, TeamID: u.ID, TeamName: req.TeamName,
	}); err != nil {
		slogError(r, "比赛报名", err)
		writeError(w, http.StatusInternalServerError, "报名失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- 队伍头像 ----------

const maxAvatarBytes = 2 << 20 // 头像上限 2MB

var avatarExtByType = map[string]string{
	"image/jpeg": "jpg",
	"image/png":  "png",
	"image/gif":  "gif",
	"image/webp": "webp",
}

// handleUploadContestAvatar 上传/更新本队头像（需已报名）。
func (a *API) handleUploadContestAvatar(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
	if err != nil || !registered {
		writeError(w, http.StatusForbidden, "请先报名参加该比赛")
		return
	}
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
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取文件失败")
		return
	}
	if len(img) > maxAvatarBytes {
		writeError(w, http.StatusBadRequest, "头像不能超过 2MB")
		return
	}
	// 魔数校验：仅接受位图格式（拒绝 SVG 等可携带脚本的格式）
	ct := http.DetectContentType(img)
	ext, ok := avatarExtByType[ct]
	if !ok {
		writeError(w, http.StatusBadRequest, "头像仅支持 JPG/PNG/GIF/WebP 图片")
		return
	}
	// 时间戳文件名：重复上传不会命中旧缓存，旧文件随后删除
	filename := fmt.Sprintf("avatars/c%d_t%d_%d.%s", cid, u.ID, time.Now().Unix(), ext)
	if err := os.MkdirAll(filepath.Join(a.cfg.DataDir, "avatars"), 0o755); err != nil {
		slogError(r, "创建头像目录", err)
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	if err := os.WriteFile(filepath.Join(a.cfg.DataDir, filename), img, 0o644); err != nil {
		slogError(r, "保存头像", err)
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	if old, err := a.store.GetContestTeam(r.Context(), cid, u.ID); err == nil && old.Avatar != "" && old.Avatar != filename {
		_ = os.Remove(filepath.Join(a.cfg.DataDir, old.Avatar))
	}
	if err := a.store.UpdateContestTeamAvatar(r.Context(), cid, u.ID, filename); err != nil {
		slogError(r, "更新头像记录", err)
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"avatar": filename})
}

// handleServeContestAvatar 对外提供头像文件（排行榜/滚榜展示用，公开访问）。
func (a *API) handleServeContestAvatar(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	tid, err := strconv.ParseInt(chi.URLParam(r, "team_id"), 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的队伍 ID")
		return
	}
	team, err := a.store.GetContestTeam(r.Context(), cid, tid)
	if err != nil {
		writeError(w, http.StatusNotFound, "队伍不存在")
		return
	}
	// 防路径穿越：必须是 avatars/ 下的单层纯文件名（路径统一使用正斜杠）
	dir, base := path.Split(team.Avatar)
	if team.Avatar == "" || dir != "avatars/" || base == "" || base == "." || base == ".." {
		writeError(w, http.StatusNotFound, "该队伍未上传头像")
		return
	}
	b, err := os.ReadFile(filepath.Join(a.cfg.DataDir, team.Avatar))
	if err != nil {
		writeError(w, http.StatusNotFound, "头像文件不存在")
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(b))
	w.Header().Set("Cache-Control", "public, max-age=31536000, immutable")
	_, _ = w.Write(b)
}

// ---------- 比赛内提交 ----------

// contestRegWindow 报名时间窗：未单独配置时随比赛时间窗。
func contestRegWindow(c model.Contest) (start, end time.Time) {
	start, end = c.StartTime, c.EndTime
	if c.RegStartTime != nil {
		start = *c.RegStartTime
	}
	if c.RegEndTime != nil {
		end = *c.RegEndTime
	}
	return start, end
}

// contestRegWindowError 报名时间窗校验：[reg_start, reg_end)。返回空串表示可报名。
func contestRegWindowError(c model.Contest, now time.Time) string {
	start, end := contestRegWindow(c)
	if now.Before(start) {
		return "报名尚未开始"
	}
	if !now.Before(end) {
		return "报名已截止"
	}
	return ""
}

// contestSubmitWindowError 比赛提交时间窗校验：有效区间为 [start_time, end_time)，
// end_time 整点（含）起不再接受提交。返回空串表示在窗口内。
func contestSubmitWindowError(c model.Contest, now time.Time) string {
	if now.Before(c.StartTime) {
		return "比赛尚未开始"
	}
	if !now.Before(c.EndTime) {
		return "比赛已结束"
	}
	return ""
}

func (a *API) handleContestSubmit(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "比赛提交", err)
		writeError(w, http.StatusInternalServerError, "提交失败")
		return
	}

	// 1. 报名校验
	registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
	if err != nil || !registered {
		writeError(w, http.StatusForbidden, "请先报名参加该比赛")
		return
	}
	// 2. 时间窗口校验：[start_time, end_time)，end_time 整点起拒绝
	if msg := contestSubmitWindowError(c, time.Now()); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	var req submitRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg, status := a.validateSubmitBasics(r, req.Language, req.Code, u.ID); msg != "" {
		writeError(w, status, msg)
		return
	}

	// 3. 题目必须属于该比赛
	var cp *model.ContestProblem
	cps, _ := a.store.ListContestProblems(r.Context(), cid)
	for i := range cps {
		if cps[i].ProblemID == req.ProblemID {
			cp = &cps[i]
			break
		}
	}
	if cp == nil {
		writeError(w, http.StatusBadRequest, "该题目不属于本场比赛")
		return
	}

	// 4. 题目状态：published/draft 可提交（比赛专用题可为草稿），disabled 不可
	problem, err := a.store.GetProblem(r.Context(), req.ProblemID)
	if err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if !problemContestSubmitAllowed(problem) {
		writeError(w, http.StatusBadRequest, "该题目已停用，无法提交")
		return
	}
	// 5. 提交次数限制：单题覆盖值（NULL=继承比赛默认，0=不限）
	limit := c.SubmissionLimit
	if cp.SubmissionLimit != nil {
		limit = *cp.SubmissionLimit
	}
	if limit > 0 {
		n, err := a.store.CountTeamProblemSubmissions(r.Context(), cid, req.ProblemID, u.ID)
		if err == nil && n >= int64(limit) {
			writeError(w, http.StatusForbidden, fmt.Sprintf("该题提交次数已达上限（%d 次）", limit))
			return
		}
	}

	optimize := true
	if req.Optimize != nil {
		optimize = *req.Optimize
	}
	cidCopy := cid
	id, err := a.store.CreateSubmissionFull(r.Context(), req.ProblemID, u.ID, req.Language, req.Code, optimize, &cidCopy)
	if err != nil {
		slogError(r, "创建比赛提交", err)
		writeError(w, http.StatusInternalServerError, "提交失败")
		return
	}
	if err := a.queue.Push(r.Context(), id); err != nil {
		slogError(r, "比赛提交入队", err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// ---------- 排行榜 ----------

func (a *API) buildContestContext(ctx context.Context, c model.Contest) (contest.ContestContext, []contestProblemDTO, map[int64]string, error) {
	teams, err := a.store.ListContestTeams(ctx, c.ID)
	if err != nil {
		return contest.ContestContext{}, nil, nil, err
	}
	teamMap := make(map[int64]string, len(teams))
	avatarMap := make(map[int64]string, len(teams))
	for _, t := range teams {
		teamMap[t.TeamID] = t.TeamName
		avatarMap[t.TeamID] = t.Avatar
	}
	problems, err := a.contestProblemsDTO(ctx, c.ID)
	if err != nil {
		return contest.ContestContext{}, nil, nil, err
	}
	ids := make([]int64, 0, len(problems))
	for _, p := range problems {
		ids = append(ids, p.ProblemID)
	}
	return contest.ContestContext{
		StartTime:      c.StartTime,
		PenaltyMinutes: c.PenaltyMinutes,
		Problems:       ids,
		Teams:          teamMap,
		RankKeys:       c.RankKeys,
	}, problems, avatarMap, nil
}

// freezeAt 返回封榜时间；无封榜返回零值。
func freezeAt(c model.Contest) time.Time {
	if c.FreezeDurationMinutes <= 0 {
		return time.Time{}
	}
	return c.EndTime.Add(-time.Duration(c.FreezeDurationMinutes) * time.Minute)
}

func (a *API) handleContestStandings(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "排行榜", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}

	// private 比赛：仅管理员/报名者可见（404 隐藏存在性）
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return
	}

	// 盲评：比赛进行中且非管理员不可见
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	if c.Feedback == model.FeedbackBlind && time.Now().Before(c.EndTime) && !isAdmin {
		writeError(w, http.StatusForbidden, "比赛进行中（盲评），排行榜暂不可见")
		return
	}

	ctx := r.Context()
	cctx, problems, avatars, err := a.buildContestContext(ctx, c)
	if err != nil {
		slogError(r, "排行榜上下文", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	subs, err := a.store.ListContestSubmissions(ctx, cid)
	if err != nil {
		slogError(r, "排行榜提交", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}

	resp := map[string]any{
		"contest":  c,
		"problems": problems,
		"mode":     c.Mode,
	}

	switch c.Mode {
	case model.ContestModeACM:
		fa := freezeAt(c)
		frozenActive := !fa.IsZero() && time.Now().After(fa)
		fb := time.Time{}
		if frozenActive {
			fb = fa
		}
		standings, frozenSubs := contest.BuildACMStandings(cctx, subs, fb)
		dtos := acmStandingsDTO(standings, problems, avatars)
		markFirstBlood(dtos)
		resp["standings"] = dtos
		if frozenActive {
			resp["freeze_at"] = fa
			resp["frozen_submissions"] = len(frozenSubs)
		}
	case model.ContestModeOI, model.ContestModeIOI:
		// 各题测试点满分：权威来源为 manifest（与 judge 评测用分值一致）
		scores := map[int64][]int{}
		for _, p := range problems {
			tcs, err := a.store.ListTestcases(ctx, p.ProblemID)
			if err != nil {
				continue
			}
			vals := make([]int, 0, len(tcs))
			for _, t := range tcs {
				vals = append(vals, t.Score)
			}
			scores[p.ProblemID] = vals
		}
		modeA := c.Mode == model.ContestModeOI
		standings := contest.BuildOIStandings(cctx, subs, scores, modeA)
		resp["standings"] = oiStandingsDTO(standings, problems, avatars)
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---------- 滚榜（管理员） ----------

func (a *API) handleContestRollBoard(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "滚榜", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if c.Mode != model.ContestModeACM {
		writeError(w, http.StatusBadRequest, "只有 ACM 赛制支持滚榜")
		return
	}
	ctx := r.Context()
	cctx, problems, avatars, err := a.buildContestContext(ctx, c)
	if err != nil {
		slogError(r, "滚榜上下文", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	subs, err := a.store.ListContestSubmissions(ctx, cid)
	if err != nil {
		slogError(r, "滚榜提交", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	base, frozen := contest.BuildACMStandings(cctx, subs, freezeAt(c))
	events := contest.RollBoard(cctx, base, frozen)

	type rollEventDTO struct {
		SubmissionID int64            `json:"submission_id"`
		ProblemID    int64            `json:"problem_id"`
		TeamID       int64            `json:"team_id"`
		TeamName     string           `json:"team_name"`
		TeamAvatar   string           `json:"team_avatar"`
		RankBefore   int              `json:"rank_before"`
		RankAfter    int              `json:"rank_after"`
		Standings    []acmStandingDTO `json:"standings"`
	}
	dtos := make([]rollEventDTO, 0, len(events))
	for _, e := range events {
		sd := acmStandingsDTO(e.Standings, problems, avatars)
		markFirstBlood(sd)
		dtos = append(dtos, rollEventDTO{
			SubmissionID: e.Submission.ID,
			ProblemID:    e.Submission.ProblemID,
			TeamID:       e.TeamID,
			TeamName:     e.TeamName,
			TeamAvatar:   avatars[e.TeamID],
			RankBefore:   e.RankBefore,
			RankAfter:    e.RankAfter,
			Standings:    sd,
		})
	}
	initial := acmStandingsDTO(base, problems, avatars)
	markFirstBlood(initial)
	writeJSON(w, http.StatusOK, map[string]any{
		"contest": c, "problems": problems,
		"freeze_at": freezeAt(c), "events": dtos,
		"initial_standings": initial,
	})
}

// ---------- DTO 转换 ----------

type acmProblemDTO struct {
	Solved         bool   `json:"solved"`
	FailedAttempts int    `json:"failed_attempts"`
	SolvedAt       string `json:"solved_at,omitempty"`
	// FirstBlood 该题一血（全场最早通过）
	FirstBlood bool `json:"first_blood"`
}

// markFirstBlood 标记每道题的一血：比较各队 solved_at 取最早者。
// 字符串比较不可靠（时区/格式差异），统一解析为时间后比较。
func markFirstBlood(dtos []acmStandingDTO) {
	first := map[string]time.Time{} // displayID -> 最早通过时间
	for _, s := range dtos {
		for pid, ps := range s.Problems {
			if !ps.Solved || ps.SolvedAt == "" {
				continue
			}
			t, err := time.Parse(time.RFC3339, ps.SolvedAt)
			if err != nil {
				continue
			}
			if cur, ok := first[pid]; !ok || t.Before(cur) {
				first[pid] = t
			}
		}
	}
	for i := range dtos {
		for pid, ps := range dtos[i].Problems {
			if !ps.Solved || ps.SolvedAt == "" {
				continue
			}
			t, err := time.Parse(time.RFC3339, ps.SolvedAt)
			if err != nil {
				continue
			}
			if ft, ok := first[pid]; ok && t.Equal(ft) {
				ps.FirstBlood = true
				dtos[i].Problems[pid] = ps
			}
		}
	}
}

type acmStandingDTO struct {
	Rank     int                      `json:"rank"`
	TeamID   int64                    `json:"team_id"`
	TeamName string                   `json:"team_name"`
	Avatar   string                   `json:"avatar"`
	Solved   int                      `json:"solved"`
	Penalty  int                      `json:"penalty"`
	LastAC   string                   `json:"last_ac,omitempty"`
	Problems map[string]acmProblemDTO `json:"problems"`
}

func acmStandingsDTO(standings []contest.ACMStanding, problems []contestProblemDTO, avatars map[int64]string) []acmStandingDTO {
	display := make(map[int64]string, len(problems))
	for _, p := range problems {
		display[p.ProblemID] = p.DisplayID
	}
	dtos := make([]acmStandingDTO, 0, len(standings))
	for _, s := range standings {
		dto := acmStandingDTO{
			Rank: s.Rank, TeamID: s.TeamID, TeamName: s.TeamName, Avatar: avatars[s.TeamID],
			Solved: s.Solved, Penalty: s.Penalty, Problems: map[string]acmProblemDTO{},
		}
		if !s.LastAC.IsZero() {
			dto.LastAC = s.LastAC.Format(time.RFC3339)
		}
		for pid, ps := range s.Problems {
			key := display[pid]
			if key == "" {
				key = strconv.FormatInt(pid, 10)
			}
			item := acmProblemDTO{Solved: ps.Solved, FailedAttempts: ps.FailedAttempts}
			if !ps.SolvedAt.IsZero() {
				item.SolvedAt = ps.SolvedAt.Format(time.RFC3339)
			}
			dto.Problems[key] = item
		}
		dtos = append(dtos, dto)
	}
	return dtos
}

type oiStandingDTO struct {
	Rank               int            `json:"rank"`
	TeamID             int64          `json:"team_id"`
	TeamName           string         `json:"team_name"`
	Avatar             string         `json:"avatar"`
	TotalScore         int            `json:"total_score"`
	ProblemScores      map[string]int `json:"problem_scores"`
	ProblemSubmissions map[string]int `json:"problem_submissions"`
}

func oiStandingsDTO(standings []contest.OIStanding, problems []contestProblemDTO, avatars map[int64]string) []oiStandingDTO {
	display := make(map[int64]string, len(problems))
	for _, p := range problems {
		display[p.ProblemID] = p.DisplayID
	}
	dtos := make([]oiStandingDTO, 0, len(standings))
	for _, s := range standings {
		dto := oiStandingDTO{
			Rank: s.Rank, TeamID: s.TeamID, TeamName: s.TeamName, Avatar: avatars[s.TeamID],
			TotalScore:         s.TotalScore,
			ProblemScores:      map[string]int{},
			ProblemSubmissions: map[string]int{},
		}
		for pid, score := range s.ProblemScores {
			key := display[pid]
			if key == "" {
				key = strconv.FormatInt(pid, 10)
			}
			dto.ProblemScores[key] = score
		}
		for pid, n := range s.ProblemSubmissions {
			key := display[pid]
			if key == "" {
				key = strconv.FormatInt(pid, 10)
			}
			dto.ProblemSubmissions[key] = n
		}
		dtos = append(dtos, dto)
	}
	return dtos
}
