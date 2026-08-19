package api

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// ---------- 比赛总览 / 题目上下文 / 我的提交 ----------

// overviewProblemDTO 总览中的单题视图。
type overviewProblemDTO struct {
	ProblemID       int64  `json:"problem_id"`
	DisplayID       string `json:"display_id"`
	SortOrder       int    `json:"sort_order"`
	Title           string `json:"title"`
	Score           int    `json:"score"`            // 有效满分（覆盖 ?? manifest 总分 ?? 100）
	SubmissionLimit int    `json:"submission_limit"` // 有效上限（0 = 不限）
	// 比赛内统计（限定当前比赛，与全局 problems 计数无关）
	SubmissionCount int64 `json:"submission_count"`
	AttemptedUsers  int64 `json:"attempted_users"`
	AcceptedUsers   int64 `json:"accepted_users"`
	// 当前用户视角
	MySubmissions int    `json:"my_submissions"`
	MyRemaining   *int   `json:"my_remaining"` // null = 不限
	MyStatus      string `json:"my_status"`    // untried | judging | passed | failed
	MyScore       int    `json:"my_score"`
}

// handleContestOverview 比赛总览：报名者/管理员可见。
func (a *API) handleContestOverview(w http.ResponseWriter, r *http.Request) {
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
		slogError(r, "比赛总览", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return
	}
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	if !isAdmin {
		if !loggedIn {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
		if err != nil || !registered {
			writeError(w, http.StatusForbidden, "请先报名参加该比赛")
			return
		}
	}

	ctx := r.Context()
	problems, err := a.contestProblemsDTO(ctx, cid)
	if err != nil {
		slogError(r, "总览题目", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	stats, err := a.store.ContestProblemStats(ctx, cid)
	if err != nil {
		slogError(r, "总览统计", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	var myStats map[int64]store.UserProblemStat
	if loggedIn && !isAdmin {
		myStats, err = a.store.UserContestProblemStats(ctx, cid, u.ID)
		if err != nil {
			slogError(r, "总览我的统计", err)
			writeError(w, http.StatusInternalServerError, "查询失败")
			return
		}
	}

	now := time.Now()
	blindActive := c.Feedback == model.FeedbackBlind && now.Before(c.EndTime)

	items := make([]overviewProblemDTO, 0, len(problems))
	for _, p := range problems {
		item := overviewProblemDTO{
			ProblemID:       p.ProblemID,
			DisplayID:       p.DisplayID,
			SortOrder:       p.SortOrder,
			Title:           p.Title,
			Score:           a.effectiveProblemScore(ctx, p),
			SubmissionLimit: effectiveSubmissionLimit(c, p),
		}
		if st, ok := stats[p.ProblemID]; ok {
			item.SubmissionCount = st.Submissions
			item.AttemptedUsers = st.AttemptedUsers
			item.AcceptedUsers = st.AcceptedUsers
		}
		if my, ok := myStats[p.ProblemID]; ok {
			item.MySubmissions = int(my.Total)
			if lim := item.SubmissionLimit; lim > 0 {
				remaining := lim - int(my.Total)
				if remaining < 0 {
					remaining = 0
				}
				item.MyRemaining = &remaining
			}
			item.MyStatus, item.MyScore = myProblemStatus(c, my)
			// 盲评进行中：非管理员隐藏单题结果与得分
			if blindActive && !isAdmin && item.MyStatus == "passed" {
				item.MyStatus = "judging"
				item.MyScore = 0
			}
		} else {
			item.MyStatus = "untried"
		}
		items = append(items, item)
	}

	resp := map[string]any{
		"contest":     c,
		"problems":    items,
		"phase":       contestPhaseName(c, now),
		"server_time": now.Format(time.RFC3339Nano),
	}
	if loggedIn {
		if sum, ok := a.myStandingSummary(ctx, c, u.ID, isAdmin); ok {
			resp["my_summary"] = sum
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// myStandingSummary 复用排行榜引擎取当前用户的成绩摘要（ACM 含冻结榜语义）。
func (a *API) myStandingSummary(ctx context.Context, c model.Contest, userID int64, isAdmin bool) (map[string]any, bool) {
	cctx, problems, _, err := a.buildContestContext(ctx, c)
	if err != nil {
		return nil, false
	}
	subs, err := a.store.ListContestSubmissions(ctx, c.ID)
	if err != nil {
		return nil, false
	}
	blind := c.Feedback == model.FeedbackBlind && time.Now().Before(c.EndTime)
	visible := isAdmin || !blind
	switch c.Mode {
	case model.ContestModeACM:
		fb := time.Time{}
		fa := freezeAt(c)
		if !fa.IsZero() && time.Now().After(fa) {
			fb = fa
		}
		standings, _ := contest.BuildACMStandings(cctx, subs, fb)
		for _, s := range standings {
			if s.TeamID == userID {
				return map[string]any{
					"rank": s.Rank, "solved": s.Solved, "penalty": s.Penalty,
					"visible": visible,
				}, true
			}
		}
	case model.ContestModeOI, model.ContestModeIOI:
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
		standings := contest.BuildOIStandings(cctx, subs, scores, c.Mode == model.ContestModeOI)
		for _, s := range standings {
			if s.TeamID == userID {
				return map[string]any{
					"rank": s.Rank, "total_score": s.TotalScore,
					"visible": visible,
				}, true
			}
		}
	}
	return nil, false
}

// myProblemStatus 计算用户单题状态与得分。
func myProblemStatus(c model.Contest, my store.UserProblemStat) (string, int) {
	if my.Total == 0 {
		return "untried", 0
	}
	if my.Judging > 0 {
		return "judging", 0
	}
	if my.Accepted {
		if c.Mode == model.ContestModeOI {
			return "passed", my.LastScore
		}
		if c.Mode == model.ContestModeIOI {
			return "passed", my.BestScore
		}
		return "passed", 0
	}
	if c.Mode == model.ContestModeOI {
		return "failed", my.LastScore
	}
	if c.Mode == model.ContestModeIOI {
		return "failed", my.BestScore
	}
	return "failed", 0
}

// effectiveProblemScore 题目有效满分：覆盖 ?? manifest 总分 ?? 100。
func (a *API) effectiveProblemScore(ctx context.Context, cp contestProblemDTO) int {
	if cp.Score != nil && *cp.Score > 0 {
		return *cp.Score
	}
	if cp.TotalScore > 0 {
		return cp.TotalScore
	}
	tcs, err := a.store.ListTestcases(ctx, cp.ProblemID)
	if err == nil && len(tcs) > 0 {
		total := 0
		for _, t := range tcs {
			total += t.Score
		}
		if total > 0 {
			return total
		}
	}
	return 100
}

// effectiveSubmissionLimit 单题有效提交上限：覆盖 ?? 比赛默认（0 = 不限）。
func effectiveSubmissionLimit(c model.Contest, cp contestProblemDTO) int {
	if cp.SubmissionLimit != nil {
		return *cp.SubmissionLimit
	}
	return c.SubmissionLimit
}

// contestPhaseName 比赛阶段名。
func contestPhaseName(c model.Contest, now time.Time) string {
	if now.Before(c.StartTime) {
		return "upcoming"
	}
	if !now.Before(c.EndTime) {
		return "ended"
	}
	return "running"
}

// ---------- 比赛题目上下文 ----------

// handleContestProblem 比赛内题面（/contest/:id/problem/:pid）：
// 报名者/管理员可访问；比赛开始前非管理员 403（不泄露题面）。
func (a *API) handleContestProblem(w http.ResponseWriter, r *http.Request) {
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
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "比赛题目", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return
	}
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	if !isAdmin {
		if !loggedIn {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
		if err != nil || !registered {
			writeError(w, http.StatusForbidden, "请先报名参加该比赛")
			return
		}
		// 比赛未开始：题面不可见（管理员可预览）
		if time.Now().Before(c.StartTime) {
			writeError(w, http.StatusForbidden, "比赛尚未开始，题面暂不可见")
			return
		}
	}

	ctx := r.Context()
	problems, err := a.contestProblemsDTO(ctx, cid)
	if err != nil {
		slogError(r, "比赛题目列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	cpIdx := -1
	for i := range problems {
		if problems[i].ProblemID == pid {
			cpIdx = i
			break
		}
	}
	if cpIdx < 0 {
		writeError(w, http.StatusNotFound, "该题目不属于本场比赛")
		return
	}
	cp := problems[cpIdx]
	p, err := a.store.GetProblem(ctx, pid)
	if err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}

	dto := problemDetailDTO{
		ID: p.ID, Title: p.Title, Statement: p.Statement,
		InputFormat: p.InputFormat, OutputFormat: p.OutputFormat, Hint: p.Hint,
		Samples: p.Samples, TimeLimitMs: p.TimeLimitMs, MemoryLimitKb: p.MemoryLimitKb,
		Difficulty: p.Difficulty, Tags: p.Tags,
		AcceptedCount: p.AcceptedCount, SubmissionCount: p.SubmissionCount,
		Type: p.Type, TestcaseScores: p.TestcaseScores,
		SubmissionLimit: p.SubmissionLimit, Status: p.Status,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
	if isAdmin {
		dto.SPJSource = p.SPJSource
		dto.InteractorSource = p.InteractorSource
		dto.TestcaseCount = p.TestcaseCount
	}

	resp := map[string]any{
		"problem": dto,
		"contest_problem": map[string]any{
			"problem_id":       cp.ProblemID,
			"display_id":       cp.DisplayID,
			"sort_order":       cp.SortOrder,
			"score":            a.effectiveProblemScore(ctx, cp),
			"submission_limit": effectiveSubmissionLimit(c, cp),
		},
	}
	if cpIdx > 0 {
		resp["prev_problem_id"] = problems[cpIdx-1].ProblemID
	}
	if cpIdx < len(problems)-1 {
		resp["next_problem_id"] = problems[cpIdx+1].ProblemID
	}
	// 我的提交统计（含剩余次数与最近状态）
	if loggedIn {
		my, err := a.store.UserContestProblemStats(ctx, cid, u.ID)
		if err == nil {
			item := map[string]any{"status": "untried", "score": 0, "submissions": int64(0)}
			if st, ok := my[pid]; ok && st.Total > 0 {
				status, score := myProblemStatus(c, st)
				blindActive := c.Feedback == model.FeedbackBlind && time.Now().Before(c.EndTime)
				if blindActive && !isAdmin && status == "passed" {
					status, score = "judging", 0
				}
				item["submissions"] = st.Total
				item["status"] = status
				item["score"] = score
			}
			if lim := effectiveSubmissionLimit(c, cp); lim > 0 {
				used, _ := item["submissions"].(int64)
				remaining := lim - int(used)
				if remaining < 0 {
					remaining = 0
				}
				item["remaining"] = remaining
			}
			resp["my"] = item
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// ---------- 我的比赛提交 ----------

// handleContestMySubmissions 我的比赛提交列表。
// 盲评进行中：非管理员的判题状态脱敏为 hidden。
func (a *API) handleContestMySubmissions(w http.ResponseWriter, r *http.Request) {
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
		slogError(r, "我的提交", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	blindActive := blindResultsActive(c, isAdmin, time.Now())
	if !isAdmin {
		if !loggedIn {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
		if err != nil || !registered {
			writeError(w, http.StatusForbidden, "请先报名参加该比赛")
			return
		}
	}

	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)
	f := store.SubmissionFilter{Page: page, Size: size, ContestID: &cid, UserID: &u.ID}
	if v := int64(queryInt(r, "problem_id", 0)); v > 0 {
		f.ProblemID = &v
	}
	if s := r.URL.Query().Get("status"); s != "" {
		if blindActive {
			writeError(w, http.StatusBadRequest, "盲评期间不可按判题状态筛选")
			return
		}
		if !knownStatuses[s] {
			writeError(w, http.StatusBadRequest, "无效的状态过滤条件")
			return
		}
		f.Status = s
	}

	items, total, err := a.store.ListSubmissions(r.Context(), f)
	if err != nil {
		slogError(r, "我的提交列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	list := make([]submissionListItem, 0, len(items))
	for _, s := range items {
		item := submissionListItem{
			ID: s.ID, ProblemID: s.ProblemID, ProblemTitle: s.ProblemTitle,
			UserID: s.UserID, Username: s.Username, Language: s.Language,
			Status: s.Status, TimeMs: s.TimeMs, MemoryKb: s.MemoryKb,
			Score: s.Score, CreatedAt: s.CreatedAt,
		}
		if blindActive {
			redactBlindSubmissionListItem(&item)
		}
		list = append(list, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": total})
}
