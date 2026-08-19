package api

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// ---------- 请求/响应结构 ----------

type contestPayload struct {
	Title                 string    `json:"title"`
	Mode                  string    `json:"mode"`
	Feedback              string    `json:"feedback"`
	ScoreMode             string    `json:"score_mode"`
	PenaltyMinutes        int       `json:"penalty_minutes"`
	FreezeDurationMinutes int       `json:"freeze_duration_minutes"`
	RankKeys              []string  `json:"rank_keys"`
	StartTime             time.Time `json:"start_time"`
	EndTime               time.Time `json:"end_time"`
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
	return ""
}

func payloadToContest(p *contestPayload) model.Contest {
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
	items, total, err := a.store.ListContests(r.Context(), page, size)
	if err != nil {
		slogError(r, "比赛列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// contestProblemDTO 比赛题目视图（含标题）。
type contestProblemDTO struct {
	ProblemID int64  `json:"problem_id"`
	DisplayID string `json:"display_id"`
	SortOrder int    `json:"sort_order"`
	Title     string `json:"title"`
}

func (a *API) contestProblemsDTO(ctx context.Context, contestID int64) ([]contestProblemDTO, error) {
	cps, err := a.store.ListContestProblems(ctx, contestID)
	if err != nil {
		return nil, err
	}
	dtos := make([]contestProblemDTO, 0, len(cps))
	for _, cp := range cps {
		dto := contestProblemDTO{ProblemID: cp.ProblemID, DisplayID: cp.DisplayID, SortOrder: cp.SortOrder}
		if p, err := a.store.GetProblem(ctx, cp.ProblemID); err == nil {
			dto.Title = p.Title
		}
		dtos = append(dtos, dto)
	}
	return dtos, nil
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
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---------- 比赛题目管理（管理员） ----------

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
	var req struct {
		ProblemID int64  `json:"problem_id"`
		DisplayID string `json:"display_id"`
		SortOrder int    `json:"sort_order"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if _, err := a.store.GetProblem(r.Context(), req.ProblemID); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err := a.store.AddContestProblem(r.Context(), model.ContestProblem{
		ContestID: cid, ProblemID: req.ProblemID, DisplayID: req.DisplayID, SortOrder: req.SortOrder,
	}); err != nil {
		slogError(r, "添加比赛题目", err)
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
	if err := a.store.AddContestTeam(r.Context(), model.ContestTeam{
		ContestID: cid, TeamID: u.ID, TeamName: req.TeamName,
	}); err != nil {
		slogError(r, "比赛报名", err)
		writeError(w, http.StatusInternalServerError, "报名失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// ---------- 比赛内提交 ----------

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
	// 2. 时间窗口校验
	now := time.Now()
	if now.Before(c.StartTime) {
		writeError(w, http.StatusBadRequest, "比赛尚未开始")
		return
	}
	if now.After(c.EndTime) {
		writeError(w, http.StatusBadRequest, "比赛已结束")
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
	inContest := false
	cps, _ := a.store.ListContestProblems(r.Context(), cid)
	for _, cp := range cps {
		if cp.ProblemID == req.ProblemID {
			inContest = true
			break
		}
	}
	if !inContest {
		writeError(w, http.StatusBadRequest, "该题目不属于本场比赛")
		return
	}

	// 4. 提交次数限制
	problem, err := a.store.GetProblem(r.Context(), req.ProblemID)
	if err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if problem.SubmissionLimit > 0 {
		n, err := a.store.CountTeamProblemSubmissions(r.Context(), cid, req.ProblemID, u.ID)
		if err == nil && n >= int64(problem.SubmissionLimit) {
			writeError(w, http.StatusForbidden, fmt.Sprintf("该题提交次数已达上限（%d 次）", problem.SubmissionLimit))
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

func (a *API) buildContestContext(ctx context.Context, c model.Contest) (contest.ContestContext, []contestProblemDTO, error) {
	teams, err := a.store.ListContestTeams(ctx, c.ID)
	if err != nil {
		return contest.ContestContext{}, nil, err
	}
	teamMap := make(map[int64]string, len(teams))
	for _, t := range teams {
		teamMap[t.TeamID] = t.TeamName
	}
	problems, err := a.contestProblemsDTO(ctx, c.ID)
	if err != nil {
		return contest.ContestContext{}, nil, err
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
	}, problems, nil
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

	// 盲评：比赛进行中且非管理员不可见
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	if c.Feedback == model.FeedbackBlind && time.Now().Before(c.EndTime) && !isAdmin {
		writeError(w, http.StatusForbidden, "比赛进行中（盲评），排行榜暂不可见")
		return
	}

	ctx := r.Context()
	cctx, problems, err := a.buildContestContext(ctx, c)
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
		resp["standings"] = acmStandingsDTO(standings, problems)
		if frozenActive {
			resp["freeze_at"] = fa
			resp["frozen_submissions"] = len(frozenSubs)
		}
	case model.ContestModeOI, model.ContestModeIOI:
		// 收集各题满分（未配置时按测试点数量均分）
		scores := map[int64][]int{}
		for _, p := range problems {
			full, err := a.store.GetProblem(ctx, p.ProblemID)
			if err != nil {
				continue
			}
			cases, _ := data.ListTests(a.cfg.DataDir, p.ProblemID)
			scores[p.ProblemID] = contest.CaseFullScores(full.TestcaseScores, len(cases))
		}
		modeA := c.Mode == model.ContestModeOI
		standings := contest.BuildOIStandings(cctx, subs, scores, modeA)
		resp["standings"] = oiStandingsDTO(standings, problems)
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
	cctx, problems, err := a.buildContestContext(ctx, c)
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
		RankBefore   int              `json:"rank_before"`
		RankAfter    int              `json:"rank_after"`
		Standings    []acmStandingDTO `json:"standings"`
	}
	dtos := make([]rollEventDTO, 0, len(events))
	for _, e := range events {
		dtos = append(dtos, rollEventDTO{
			SubmissionID: e.Submission.ID,
			ProblemID:    e.Submission.ProblemID,
			TeamID:       e.TeamID,
			TeamName:     e.TeamName,
			RankBefore:   e.RankBefore,
			RankAfter:    e.RankAfter,
			Standings:    acmStandingsDTO(e.Standings, problems),
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"contest": c, "problems": problems,
		"freeze_at": freezeAt(c), "events": dtos,
		"initial_standings": acmStandingsDTO(base, problems),
	})
}

// ---------- DTO 转换 ----------

type acmProblemDTO struct {
	Solved         bool   `json:"solved"`
	FailedAttempts int    `json:"failed_attempts"`
	SolvedAt       string `json:"solved_at,omitempty"`
}

type acmStandingDTO struct {
	Rank     int                      `json:"rank"`
	TeamID   int64                    `json:"team_id"`
	TeamName string                   `json:"team_name"`
	Solved   int                      `json:"solved"`
	Penalty  int                      `json:"penalty"`
	LastAC   string                   `json:"last_ac,omitempty"`
	Problems map[string]acmProblemDTO `json:"problems"`
}

func acmStandingsDTO(standings []contest.ACMStanding, problems []contestProblemDTO) []acmStandingDTO {
	display := make(map[int64]string, len(problems))
	for _, p := range problems {
		display[p.ProblemID] = p.DisplayID
	}
	dtos := make([]acmStandingDTO, 0, len(standings))
	for _, s := range standings {
		dto := acmStandingDTO{
			Rank: s.Rank, TeamID: s.TeamID, TeamName: s.TeamName,
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
	TotalScore         int            `json:"total_score"`
	ProblemScores      map[string]int `json:"problem_scores"`
	ProblemSubmissions map[string]int `json:"problem_submissions"`
}

func oiStandingsDTO(standings []contest.OIStanding, problems []contestProblemDTO) []oiStandingDTO {
	display := make(map[int64]string, len(problems))
	for _, p := range problems {
		display[p.ProblemID] = p.DisplayID
	}
	dtos := make([]oiStandingDTO, 0, len(standings))
	for _, s := range standings {
		dto := oiStandingDTO{
			Rank: s.Rank, TeamID: s.TeamID, TeamName: s.TeamName,
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
