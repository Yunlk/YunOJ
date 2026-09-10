package api

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// ---------- Open Hacking（Codeforces 风格选手间 Hack） ----------
//
// 规则：
//   - 比赛开启 hacking_enabled 且处于比赛时间窗内；
//   - 队伍必须在某题上通过（AC）后才能「锁定」该题；
//   - 锁定后不能再向该题提交，但可以查看其他队伍该题的提交并发起 Hack；
//   - Hack 成功 +100 分，失败 -50 分；被 Hack 的提交判定降级、分数作废。

// hackWindowOpen 判断当前是否处于可 Hack 窗口（比赛进行中）。
func hackWindowOpen(c model.Contest, now time.Time) bool {
	return !now.Before(c.StartTime) && now.Before(c.EndTime)
}

// requireHackingContest 校验比赛存在且开放 Hack，返回比赛。
func (a *API) requireHackingContest(w http.ResponseWriter, r *http.Request, cid int64) (model.Contest, bool) {
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return model.Contest{}, false
	}
	if err != nil {
		slogError(r, "Hack 比赛查询", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return model.Contest{}, false
	}
	if !c.HackingEnabled {
		writeError(w, http.StatusBadRequest, "本场比赛未开放 Hack")
		return model.Contest{}, false
	}
	return c, true
}

// requireContestTeam 要求当前用户已报名（管理员豁免），返回用户。
func (a *API) requireContestTeam(w http.ResponseWriter, r *http.Request, cid int64) (model.User, bool) {
	u, loggedIn := userFromCtx(r.Context())
	if !loggedIn {
		writeError(w, http.StatusUnauthorized, "未登录")
		return model.User{}, false
	}
	if u.Role == model.RoleAdmin {
		return u, true
	}
	registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
	if err != nil || !registered {
		writeError(w, http.StatusForbidden, "请先报名参加该比赛")
		return model.User{}, false
	}
	return u, true
}

// teamSolvedProblem 判断队伍在该题上是否已有通过的提交。
func (a *API) teamSolvedProblem(r *http.Request, contestID, teamID, problemID int64) bool {
	f := store.SubmissionFilter{
		Page: 1, Size: 1, ContestID: &contestID, UserID: &teamID,
		ProblemID: &problemID, Status: model.StatusAccepted,
	}
	items, total, err := a.store.ListSubmissions(r.Context(), f)
	return err == nil && total > 0 && len(items) > 0
}

// handleLockProblem 锁定比赛中某题（需先 AC）。
func (a *API) handleLockProblem(w http.ResponseWriter, r *http.Request) {
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
	c, ok := a.requireHackingContest(w, r, cid)
	if !ok {
		return
	}
	u, ok := a.requireContestTeam(w, r, cid)
	if !ok {
		return
	}
	if !hackWindowOpen(c, time.Now()) {
		writeError(w, http.StatusBadRequest, "只能在比赛进行中锁定题目")
		return
	}
	if !a.teamSolvedProblem(r, cid, u.ID, pid) {
		writeError(w, http.StatusForbidden, "需要先通过该题才能锁定")
		return
	}
	if err := a.store.LockProblem(r.Context(), cid, u.ID, pid); err != nil {
		slogError(r, "锁定题目", err)
		writeError(w, http.StatusInternalServerError, "锁定失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "locked": true})
}

// handleListLockedProblems 返回当前队伍已锁定的题目 ID。
func (a *API) handleListLockedProblems(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	u, ok := a.requireContestTeam(w, r, cid)
	if !ok {
		return
	}
	ids, err := a.store.ListProblemLocks(r.Context(), cid, u.ID)
	if err != nil {
		slogError(r, "查询锁定状态", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"problem_ids": ids})
}

// hackTargetDTO 可被 Hack 的提交（含代码，仅锁题者可见）。
type hackTargetDTO struct {
	SubmissionID int64  `json:"submission_id"`
	TeamID       int64  `json:"team_id"`
	TeamName     string `json:"team_name"`
	Language     string `json:"language"`
	Code         string `json:"code"`
	SubmittedAt  string `json:"submitted_at"`
	// Hacked 该提交是否已被 Hack 成功
	Hacked bool `json:"hacked"`
}

// handleListHackTargets 列出某题其他队伍的通过提交（供选择攻击目标）。
// 需要已锁定该题，或比赛已结束（开放 Hack 阶段）。
func (a *API) handleListHackTargets(w http.ResponseWriter, r *http.Request) {
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
	if _, ok := a.requireHackingContest(w, r, cid); !ok {
		return
	}
	u, ok := a.requireContestTeam(w, r, cid)
	if !ok {
		return
	}
	locked, err := a.store.IsProblemLocked(r.Context(), cid, u.ID, pid)
	if err != nil {
		slogError(r, "查询锁定状态", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if !locked && u.Role != model.RoleAdmin {
		writeError(w, http.StatusForbidden, "请先锁定该题（通过该题后即可锁定）")
		return
	}

	// 只列出其他队伍的通过提交（不泄露未通过的代码）
	f := store.SubmissionFilter{Page: 1, Size: 100, ContestID: &cid, ProblemID: &pid, Status: model.StatusAccepted}
	items, _, err := a.store.ListSubmissions(r.Context(), f)
	if err != nil {
		slogError(r, "查询 Hack 目标", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	teams, _ := a.store.ListContestTeams(r.Context(), cid)
	names := map[int64]string{}
	for _, t := range teams {
		names[t.TeamID] = t.TeamName
	}
	dtos := make([]hackTargetDTO, 0, len(items))
	for _, item := range items {
		if item.UserID == u.ID {
			continue // 不能 Hack 自己
		}
		full, err := a.store.GetSubmission(r.Context(), item.ID)
		if err != nil {
			continue
		}
		dto := hackTargetDTO{
			SubmissionID: full.ID, TeamID: full.UserID, TeamName: names[full.UserID],
			Language: full.Language, Code: full.Code,
			SubmittedAt: full.CreatedAt.Format(time.RFC3339), Hacked: full.IsHacked,
		}
		dtos = append(dtos, dto)
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":  dtos,
		"locked": locked,
		// 无参考解时前端需要提示「必须同时填写期望输出」
		"requires_expected_output": a.problemLacksReference(r, pid),
	})
}

func (a *API) problemLacksReference(r *http.Request, problemID int64) bool {
	p, err := a.store.GetProblem(r.Context(), problemID)
	return err != nil || strings.TrimSpace(p.HackReferenceSource) == ""
}

// handleCreateHack 发起一次 Hack（异步入队评测）。
func (a *API) handleCreateHack(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, ok := a.requireHackingContest(w, r, cid)
	if !ok {
		return
	}
	u, ok := a.requireContestTeam(w, r, cid)
	if !ok {
		return
	}
	if !hackWindowOpen(c, time.Now()) && u.Role != model.RoleAdmin {
		writeError(w, http.StatusBadRequest, "比赛已结束，Hack 阶段关闭")
		return
	}
	var req struct {
		TargetSubmissionID int64  `json:"target_submission_id"`
		Input              string `json:"input"`
		ExpectedOutput     string `json:"expected_output"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Input) == "" {
		writeError(w, http.StatusBadRequest, "请填写 Hack 输入数据")
		return
	}
	if len(req.Input) > 1<<20 || len(req.ExpectedOutput) > 1<<20 {
		writeError(w, http.StatusBadRequest, "Hack 数据过大（最大 1MB）")
		return
	}

	target, err := a.store.GetSubmission(r.Context(), req.TargetSubmissionID)
	if err != nil {
		writeError(w, http.StatusNotFound, "目标提交不存在")
		return
	}
	if target.ContestID == nil || *target.ContestID != cid {
		writeError(w, http.StatusBadRequest, "目标提交不属于本场比赛")
		return
	}
	if target.UserID == u.ID {
		writeError(w, http.StatusBadRequest, "不能 Hack 自己的提交")
		return
	}
	if target.Status != model.StatusAccepted {
		writeError(w, http.StatusBadRequest, "只能 Hack 已通过（AC）的提交")
		return
	}
	locked, err := a.store.IsProblemLocked(r.Context(), cid, u.ID, target.ProblemID)
	if err != nil || (!locked && u.Role != model.RoleAdmin) {
		writeError(w, http.StatusForbidden, "请先锁定该题再发起 Hack")
		return
	}
	if a.problemLacksReference(r, target.ProblemID) && strings.TrimSpace(req.ExpectedOutput) == "" {
		writeError(w, http.StatusBadRequest, "该题目未配置参考解，请同时填写期望输出后再提交 Hack")
		return
	}

	hack := model.ContestHack{
		ContestID: cid, ProblemID: target.ProblemID, HackerID: u.ID,
		TargetSubmissionID: target.ID, TargetTeamID: target.UserID,
		Input: req.Input, ExpectedOutput: req.ExpectedOutput,
	}
	if err := a.store.CreateHack(r.Context(), &hack); err != nil {
		slogError(r, "创建 Hack", err)
		writeError(w, http.StatusInternalServerError, "提交 Hack 失败")
		return
	}
	if err := a.queue.PushHack(r.Context(), hack.ID); err != nil {
		slogError(r, "Hack 入队", err)
		writeError(w, http.StatusInternalServerError, "Hack 入队失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": hack.ID})
}

// handleListHacks 列出 Hack 记录：比赛结束前只能看到自己的，结束后公开全部。
func (a *API) handleListHacks(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, ok := a.requireHackingContest(w, r, cid)
	if !ok {
		return
	}
	u, ok := a.requireContestTeam(w, r, cid)
	if !ok {
		return
	}
	// 比赛结束后 Hack 记录公开（CF 会展示每题的 Hack 情况）
	hackerFilter := u.ID
	if time.Now().After(c.EndTime) || u.Role == model.RoleAdmin {
		hackerFilter = 0
	}
	items, err := a.store.ListContestHacks(r.Context(), cid, hackerFilter, 200)
	if err != nil {
		slogError(r, "查询 Hack 列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}
