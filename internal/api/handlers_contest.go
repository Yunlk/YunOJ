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
	"sort"
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
	CoverImage            string     `json:"cover_image"`
	Visibility            string     `json:"visibility"`
	RegStartTime          *time.Time `json:"reg_start_time"`
	RegEndTime            *time.Time `json:"reg_end_time"`
	SubmissionLimit       int        `json:"submission_limit"`
	RegistrationMode      string     `json:"registration_mode"`
	MaxTeamSize           int        `json:"max_team_size"`
	AllowTeamEdit         bool       `json:"allow_team_edit"`
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
	if p.RegistrationMode == "" {
		p.RegistrationMode = model.ContestRegistrationBoth
	}
	switch p.RegistrationMode {
	case model.ContestRegistrationIndividual, model.ContestRegistrationTeam, model.ContestRegistrationBoth:
	default:
		return "无效的报名方式（individual/team/both）"
	}
	if p.MaxTeamSize == 0 {
		p.MaxTeamSize = 1
	}
	if p.RegistrationMode == model.ContestRegistrationIndividual {
		p.MaxTeamSize = 1
	}
	if p.MaxTeamSize < 1 || p.MaxTeamSize > 20 {
		return "队伍人数上限需在 1-20 之间"
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
		CoverImage:            p.CoverImage,
		Visibility:            vis,
		RegStartTime:          p.RegStartTime,
		RegEndTime:            p.RegEndTime,
		SubmissionLimit:       p.SubmissionLimit,
		RegistrationMode:      p.RegistrationMode,
		MaxTeamSize:           p.MaxTeamSize,
		AllowTeamEdit:         p.AllowTeamEdit,
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
	// TotalScore 题目 manifest 的有效总分（用于 ACM 榜单显示，不改变 Score 覆盖语义）。
	TotalScore int `json:"total_score"`
	// SubmissionLimit 单题提交上限覆盖（NULL = 继承比赛默认，0 = 不限）
	SubmissionLimit *int   `json:"submission_limit"`
	ThemeColor      string `json:"theme_color"`
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
			ThemeColor: contestProblemThemeColor(cp.ThemeColor, cp.SortOrder),
		}
		if p, err := a.store.GetProblem(ctx, cp.ProblemID); err == nil {
			dto.Title = p.Title
		}
		if tcs, err := a.store.ListTestcases(ctx, cp.ProblemID); err == nil {
			for _, tc := range tcs {
				dto.TotalScore += tc.Score
			}
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
				members, _ := a.store.ListContestTeamMembers(r.Context(), id, t.TeamID)
				isCaptain := t.TeamID == u.ID
				for _, member := range members {
					if member.UserID == u.ID {
						isCaptain = member.IsCaptain
						break
					}
				}
				resp["my_team"] = map[string]any{
					"team_id": t.TeamID, "team_name": t.TeamName, "avatar": t.Avatar,
					"members": members, "is_captain": isCaptain,
				}
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
	SubmissionLimit *int   `json:"submission_limit"`
	ThemeColor      string `json:"theme_color"`
}

// validateContestProblemPayload 校验比赛题目字段。
func validateContestProblemPayload(p *contestProblemPayload) string {
	if strings.TrimSpace(p.DisplayID) == "" {
		return "请填写题号（如 A、B、P1）"
	}
	if len([]rune(p.DisplayID)) > 32 {
		return "题号最长 32 字符"
	}
	if p.Score != nil && *p.Score < 0 {
		return "单题分值不能为负数"
	}
	if p.SubmissionLimit != nil && (*p.SubmissionLimit < 0 || *p.SubmissionLimit > 1000) {
		return "单题提交上限需在 0-1000 之间（0 = 不限）"
	}
	if p.ThemeColor != "" {
		valid := false
		for _, color := range model.ContestThemeColors {
			if p.ThemeColor == color {
				valid = true
				break
			}
		}
		if !valid {
			return "无效的题目主题色"
		}
	}
	return ""
}

func contestProblemThemeColor(color string, sortOrder int) string {
	if color != "" {
		return color
	}
	if sortOrder < 1 {
		sortOrder = 1
	}
	return model.ContestThemeColors[(sortOrder-1)%len(model.ContestThemeColors)]
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
		ThemeColor: contestProblemThemeColor(req.ThemeColor, req.SortOrder),
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
		ThemeColor: contestProblemThemeColor(req.ThemeColor, req.SortOrder),
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
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "查询比赛报名", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	var req struct {
		TeamName string `json:"team_name"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.TeamName) == "" {
		req.TeamName = u.Username
	}
	if len(req.TeamName) > 64 {
		writeError(w, http.StatusBadRequest, "名称长度不能超过 64 字符")
		return
	}
	// 报名时间窗校验（默认随比赛时间窗）
	if msg := contestRegWindowError(c, time.Now()); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
	if err != nil {
		slogError(r, "检查比赛报名", err)
		writeError(w, http.StatusInternalServerError, "报名失败")
		return
	}
	if registered {
		writeError(w, http.StatusConflict, "你已经报名本场比赛")
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
const maxContestCoverBytes = 8 << 20

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
	team, err := a.store.GetContestTeam(r.Context(), cid, u.ID)
	if err != nil {
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
	filename := fmt.Sprintf("avatars/c%d_t%d_%d.%s", cid, team.TeamID, time.Now().Unix(), ext)
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
	if old, err := a.store.GetContestTeam(r.Context(), cid, team.TeamID); err == nil && old.Avatar != "" && old.Avatar != filename {
		_ = os.Remove(filepath.Join(a.cfg.DataDir, old.Avatar))
	}
	if err := a.store.UpdateContestTeamAvatar(r.Context(), cid, team.TeamID, filename); err != nil {
		slogError(r, "更新头像记录", err)
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"avatar": filename})
}

// handleServeContestAvatar 对外提供头像文件（动态排行榜展示用，公开访问）。
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

// handleUploadContestCover 上传比赛封面。封面只保存图片文件，不接受 SVG。
func (a *API) handleUploadContestCover(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	if _, err := a.store.GetContest(r.Context(), cid); err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, maxContestCoverBytes+1<<20)
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "解析上传内容失败")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少文件字段 file")
		return
	}
	defer file.Close()
	b, err := io.ReadAll(io.LimitReader(file, maxContestCoverBytes+1))
	if err != nil || len(b) > maxContestCoverBytes {
		writeError(w, http.StatusBadRequest, "封面不能超过 8MB")
		return
	}
	ext, ok := avatarExtByType[http.DetectContentType(b)]
	if !ok {
		writeError(w, http.StatusBadRequest, "封面仅支持 JPG/PNG/GIF/WebP 图片")
		return
	}
	filename := fmt.Sprintf("contest-covers/c%d_%d.%s", cid, time.Now().UnixNano(), ext)
	if err := os.MkdirAll(filepath.Join(a.cfg.DataDir, "contest-covers"), 0o755); err != nil {
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	if err := os.WriteFile(filepath.Join(a.cfg.DataDir, filename), b, 0o644); err != nil {
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	if old, err := a.store.GetContest(r.Context(), cid); err == nil && old.CoverImage != "" {
		_ = os.Remove(filepath.Join(a.cfg.DataDir, old.CoverImage))
	}
	if err := a.store.UpdateContestCoverImage(r.Context(), cid, filename); err != nil {
		_ = os.Remove(filepath.Join(a.cfg.DataDir, filename))
		writeError(w, http.StatusInternalServerError, "保存失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"cover_image": filename})
}

func (a *API) handleServeContestCover(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if err != nil || c.CoverImage == "" {
		writeError(w, http.StatusNotFound, "封面不存在")
		return
	}
	dir, base := path.Split(c.CoverImage)
	if dir != "contest-covers/" || base == "" || base == "." || base == ".." {
		writeError(w, http.StatusNotFound, "封面不存在")
		return
	}
	b, err := os.ReadFile(filepath.Join(a.cfg.DataDir, c.CoverImage))
	if err != nil {
		writeError(w, http.StatusNotFound, "封面不存在")
		return
	}
	w.Header().Set("Content-Type", http.DetectContentType(b))
	w.Header().Set("Cache-Control", "public, max-age=3600")
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
	// 数据库中的演示数据可能预先写入未来时间的提交。排行榜只应使用
	// 当前时刻已经发生的提交，避免阶段控制脚本把未来事件提前暴露。
	visibleSubs := subs[:0]
	now := time.Now()
	for _, sub := range subs {
		if sub.CreatedAt.After(now) {
			continue
		}
		visibleSubs = append(visibleSubs, sub)
	}
	subs = visibleSubs

	resp := map[string]any{
		"contest":  c,
		"problems": problems,
		"mode":     c.Mode,
	}
	// 趣味统计只在比赛结束后向参赛者公开；管理员可在比赛进行中预览。
	// 统计使用全部提交，因此包含封榜期间的提交。
	if c.Mode == model.ContestModeACM && (isAdmin || !time.Now().Before(c.EndTime)) {
		resp["fun_stats"] = buildContestFunStats(subs, problems, cctx.Teams, c.StartTime)
	}

	switch c.Mode {
	case model.ContestModeACM:
		fa := freezeAt(c)
		// 用 >= 处理精确封榜时刻：到达 freeze_at 的这一秒就进入封榜。
		frozenActive := !fa.IsZero() && !now.Before(fa)
		fb := time.Time{}
		if frozenActive {
			fb = fa
		}
		standings, frozenSubs := contest.BuildACMStandings(cctx, subs, fb)
		dtos := acmStandingsDTO(standings, problems, avatars)
		markFirstBlood(dtos)
		resp["standings"] = dtos
		// 封榜前公开最近提交的生命周期，供统一榜单聚焦 pending/running/终态。
		// 进入封榜后立即停止返回，避免泄露冻结提交与判定。
		if !frozenActive && !now.Before(c.StartTime) {
			snapshots := contest.ReplayACMSubmissionSnapshots(cctx, subs)
			live := liveSubmissionDTOs(subs, problems, cctx.Teams, avatars, snapshots)
			resp["live_submissions"] = live
			if len(live) > 0 {
				resp["latest_submission"] = live[len(live)-1]
			}
		}
		if frozenActive {
			resp["freeze_at"] = fa
			resp["frozen_submissions"] = len(frozenSubs)
			// 比赛结束后把封榜提交作为同一榜单页面上的揭晓事件返回。
			// 比赛进行中不返回事件，避免提前泄露冻结结果。
			allJudged := true
			for _, sub := range frozenSubs {
				if !model.IsFinal(sub.Status) {
					allJudged = false
					break
				}
			}
			if now.After(c.EndTime) && len(frozenSubs) > 0 && allJudged {
				events := contest.RollBoard(cctx, standings, frozenSubs)
				resp["roll_events"] = rollEventDTOs(events, problems, avatars)
				resp["roll_initial_standings"] = dtos
				resp["roll_available"] = true
			}
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

type liveSubmissionDTO struct {
	SubmissionID int64            `json:"submission_id"`
	ProblemID    int64            `json:"problem_id"`
	DisplayID    string           `json:"display_id"`
	TeamID       int64            `json:"team_id"`
	TeamName     string           `json:"team_name"`
	TeamAvatar   string           `json:"team_avatar"`
	Status       string           `json:"status"`
	CreatedAt    time.Time        `json:"created_at"`
	Standings    []acmStandingDTO `json:"standings_after,omitempty"`
}

func liveSubmissionDTOs(subs []model.Submission, problems []contestProblemDTO,
	teams map[int64]string, avatars map[int64]string, snapshots map[int64][]contest.ACMStanding) []liveSubmissionDTO {
	displayIDs := make(map[int64]string, len(problems))
	for _, p := range problems {
		displayIDs[p.ProblemID] = p.DisplayID
	}
	dtos := make([]liveSubmissionDTO, 0, len(subs))
	for _, sub := range subs {
		teamName, ok := teams[sub.UserID]
		if !ok {
			continue
		}
		dto := liveSubmissionDTO{
			SubmissionID: sub.ID,
			ProblemID:    sub.ProblemID,
			DisplayID:    displayIDs[sub.ProblemID],
			TeamID:       sub.UserID,
			TeamName:     teamName,
			TeamAvatar:   avatars[sub.UserID],
			Status:       sub.Status,
			CreatedAt:    sub.CreatedAt,
		}
		if snapshot, ok := snapshots[sub.ID]; ok {
			dto.Standings = acmStandingsDTO(snapshot, problems, avatars)
			markFirstBlood(dto.Standings)
		}
		dtos = append(dtos, dto)
	}
	return dtos
}

type rollEventDTO struct {
	SubmissionID int64            `json:"submission_id"`
	ProblemID    int64            `json:"problem_id"`
	Status       string           `json:"status"`
	TeamID       int64            `json:"team_id"`
	TeamName     string           `json:"team_name"`
	TeamAvatar   string           `json:"team_avatar"`
	Standings    []acmStandingDTO `json:"standings"`
}

// contestFunEntryDTO 是动态揭晓结束后展示的一条趣味排名记录。
// DisplayIDs 用于表达同一队伍在并列或多次一血时涉及的题目。
type contestFunEntryDTO struct {
	TeamID         int64     `json:"team_id"`
	TeamName       string    `json:"team_name"`
	Count          int       `json:"count,omitempty"`
	DisplayIDs     []string  `json:"display_ids,omitempty"`
	CreatedAt      time.Time `json:"created_at,omitempty"`
	ElapsedSeconds int       `json:"elapsed_seconds,omitempty"`
}

type contestFunStatsDTO struct {
	FastestFirstBlood []contestFunEntryDTO `json:"fastest_first_blood"`
	MostFirstBlood    []contestFunEntryDTO `json:"most_first_blood"`
	MostWrongAnswers  []contestFunEntryDTO `json:"most_wrong_answers"`
	LastAccepted      []contestFunEntryDTO `json:"last_accepted"`
}

type firstBloodRecord struct {
	At      time.Time
	TeamIDs map[int64]struct{}
}

// buildContestFunStats 计算动态揭晓页使用的趣味排名。
// 提交列表已经按 ID/创建顺序返回；这里仍以 created_at 比较时间，保证重放数据
// 或导入数据的顺序变化不会影响一血和最后一发的定义。
func buildContestFunStats(subs []model.Submission, problems []contestProblemDTO, teams map[int64]string, start time.Time) contestFunStatsDTO {
	displayIDs := make(map[int64]string, len(problems))
	problemOrder := make(map[string]int, len(problems))
	for i, p := range problems {
		displayIDs[p.ProblemID] = p.DisplayID
		problemOrder[p.DisplayID] = i
	}

	firstByProblem := make(map[int64]firstBloodRecord)
	waCounts := make(map[int64]int)
	var lastAcceptedAt time.Time

	for _, sub := range subs {
		if _, ok := teams[sub.UserID]; !ok {
			continue
		}
		switch sub.Status {
		case model.StatusWrongAnswer:
			waCounts[sub.UserID]++
		case model.StatusAccepted:
			record, ok := firstByProblem[sub.ProblemID]
			if !ok || sub.CreatedAt.Before(record.At) {
				firstByProblem[sub.ProblemID] = firstBloodRecord{
					At:      sub.CreatedAt,
					TeamIDs: map[int64]struct{}{sub.UserID: {}},
				}
			} else if sub.CreatedAt.Equal(record.At) {
				record.TeamIDs[sub.UserID] = struct{}{}
				firstByProblem[sub.ProblemID] = record
			}
			if sub.CreatedAt.After(lastAcceptedAt) {
				lastAcceptedAt = sub.CreatedAt
			}
		}
	}

	firstBloodCounts := make(map[int64]int)
	firstBloodProblems := make(map[int64][]string)
	fastestAt := time.Time{}
	fastest := make(map[int64][]string)
	for problemID, record := range firstByProblem {
		if record.At.IsZero() {
			continue
		}
		displayID := displayIDs[problemID]
		for teamID := range record.TeamIDs {
			firstBloodCounts[teamID]++
			firstBloodProblems[teamID] = append(firstBloodProblems[teamID], displayID)
		}
		if fastestAt.IsZero() || record.At.Before(fastestAt) {
			fastestAt = record.At
			fastest = make(map[int64][]string)
		}
		if record.At.Equal(fastestAt) {
			for teamID := range record.TeamIDs {
				fastest[teamID] = append(fastest[teamID], displayID)
			}
		}
	}

	stats := contestFunStatsDTO{
		FastestFirstBlood: make([]contestFunEntryDTO, 0, len(fastest)),
		MostFirstBlood:    make([]contestFunEntryDTO, 0),
		MostWrongAnswers:  make([]contestFunEntryDTO, 0),
		LastAccepted:      make([]contestFunEntryDTO, 0),
	}
	for teamID, ids := range fastest {
		stats.FastestFirstBlood = append(stats.FastestFirstBlood, contestFunEntryDTO{
			TeamID: teamID, TeamName: teams[teamID], DisplayIDs: sortDisplayIDs(ids, problemOrder),
			CreatedAt: fastestAt, ElapsedSeconds: elapsedSeconds(fastestAt, start),
		})
	}

	maxFirstBlood := 0
	for _, count := range firstBloodCounts {
		if count > maxFirstBlood {
			maxFirstBlood = count
		}
	}
	for teamID, count := range firstBloodCounts {
		if count == maxFirstBlood && count > 0 {
			stats.MostFirstBlood = append(stats.MostFirstBlood, contestFunEntryDTO{
				TeamID: teamID, TeamName: teams[teamID], Count: count,
				DisplayIDs: sortDisplayIDs(firstBloodProblems[teamID], problemOrder),
			})
		}
	}

	maxWA := 0
	for _, count := range waCounts {
		if count > maxWA {
			maxWA = count
		}
	}
	for teamID, count := range waCounts {
		if count == maxWA && count > 0 {
			stats.MostWrongAnswers = append(stats.MostWrongAnswers, contestFunEntryDTO{
				TeamID: teamID, TeamName: teams[teamID], Count: count,
			})
		}
	}

	if !lastAcceptedAt.IsZero() {
		lastAccepted := make(map[int64][]string)
		for _, sub := range subs {
			if sub.Status == model.StatusAccepted && sub.CreatedAt.Equal(lastAcceptedAt) {
				if _, ok := teams[sub.UserID]; ok {
					lastAccepted[sub.UserID] = append(lastAccepted[sub.UserID], displayIDs[sub.ProblemID])
				}
			}
		}
		for teamID, ids := range lastAccepted {
			stats.LastAccepted = append(stats.LastAccepted, contestFunEntryDTO{
				TeamID: teamID, TeamName: teams[teamID], DisplayIDs: sortDisplayIDs(ids, problemOrder),
				CreatedAt: lastAcceptedAt, ElapsedSeconds: elapsedSeconds(lastAcceptedAt, start),
			})
		}
	}

	sortFunEntries(stats.FastestFirstBlood)
	sortFunEntries(stats.MostFirstBlood)
	sortFunEntries(stats.MostWrongAnswers)
	sortFunEntries(stats.LastAccepted)
	return stats
}

func elapsedSeconds(at, start time.Time) int {
	if at.IsZero() || start.IsZero() {
		return 0
	}
	seconds := int(at.Sub(start).Seconds())
	if seconds < 0 {
		return 0
	}
	return seconds
}

func sortDisplayIDs(ids []string, order map[string]int) []string {
	result := append([]string(nil), ids...)
	sort.SliceStable(result, func(i, j int) bool {
		left, lok := order[result[i]]
		right, rok := order[result[j]]
		if lok && rok && left != right {
			return left < right
		}
		return result[i] < result[j]
	})
	return result
}

func sortFunEntries(entries []contestFunEntryDTO) {
	sort.SliceStable(entries, func(i, j int) bool {
		if entries[i].TeamID != entries[j].TeamID {
			return entries[i].TeamID < entries[j].TeamID
		}
		return entries[i].TeamName < entries[j].TeamName
	})
}

// rollEventDTOs 将榜单引擎事件转换为统一榜单页面使用的轻量 DTO。
func rollEventDTOs(events []contest.RollEvent, problems []contestProblemDTO, avatars map[int64]string) []rollEventDTO {
	dtos := make([]rollEventDTO, 0, len(events))
	for _, e := range events {
		sd := acmStandingsDTO(e.Standings, problems, avatars)
		markFirstBlood(sd)
		dtos = append(dtos, rollEventDTO{
			SubmissionID: e.Submission.ID,
			ProblemID:    e.Submission.ProblemID,
			Status:       e.Submission.Status,
			TeamID:       e.TeamID,
			TeamName:     e.TeamName,
			TeamAvatar:   avatars[e.TeamID],
			Standings:    sd,
		})
	}
	return dtos
}

// ---------- DTO 转换 ----------

type acmProblemDTO struct {
	Solved         bool   `json:"solved"`
	FailedAttempts int    `json:"failed_attempts"`
	LastStatus     string `json:"last_status,omitempty"`
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
			item := acmProblemDTO{Solved: ps.Solved, FailedAttempts: ps.FailedAttempts, LastStatus: ps.LastStatus}
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
