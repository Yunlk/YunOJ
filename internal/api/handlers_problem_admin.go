package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// ---------- 题目管理后台（管理员） ----------

// handleCopyProblem 复制题目：题面/限制/类型/评测器源码/测试数据/测试点 manifest
// 全部复制，新题目为草稿状态。
func (a *API) handleCopyProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	src, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err != nil {
		slogError(r, "复制题目", err)
		writeError(w, http.StatusInternalServerError, "复制失败")
		return
	}

	dst := model.Problem{
		Title:            src.Title + "（副本）",
		Statement:        src.Statement,
		InputFormat:      src.InputFormat,
		OutputFormat:     src.OutputFormat,
		Hint:             src.Hint,
		Samples:          src.Samples,
		TimeLimitMs:      src.TimeLimitMs,
		MemoryLimitKb:    src.MemoryLimitKb,
		Difficulty:       src.Difficulty,
		Tags:             src.Tags,
		Type:             src.Type,
		SPJSource:        src.SPJSource,
		InteractorSource: src.InteractorSource,
		TestcaseScores:   src.TestcaseScores,
		SubmissionLimit:  src.SubmissionLimit,
		Status:           model.ProblemStatusDraft,
	}
	if err := a.store.CreateProblem(r.Context(), &dst); err != nil {
		slogError(r, "复制题目", err)
		writeError(w, http.StatusInternalServerError, "复制失败")
		return
	}
	// 测试数据文件 + manifest
	if err := data.CopyTests(a.cfg.DataDir, src.ID, dst.ID); err != nil {
		slogError(r, "复制测试数据", err)
	}
	if tcs, err := a.store.ListTestcases(r.Context(), src.ID); err == nil && len(tcs) > 0 {
		for i := range tcs {
			tcs[i].ProblemID = dst.ID
		}
		if err := a.store.ReplaceAllTestcases(r.Context(), dst.ID, tcs); err != nil {
			slogError(r, "复制测试点 manifest", err)
		}
	}
	writeJSON(w, http.StatusCreated, dst)
}

// handleUpdateProblemStatus 修改题目状态（草稿/发布/停用）。
// 发布 standard/spj/interactive 题目前校验测试点完整性（≥1 个且总分 100）。
func (a *API) handleUpdateProblemStatus(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	var req struct {
		Status string `json:"status"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	switch req.Status {
	case model.ProblemStatusDraft, model.ProblemStatusPublished, model.ProblemStatusDisabled:
	default:
		writeError(w, http.StatusBadRequest, "无效的题目状态（draft/published/disabled）")
		return
	}
	if req.Status == model.ProblemStatusPublished {
		if err := a.validatePublishProblem(r, id); err != nil {
			var msgErr *publishError
			if errors.As(err, &msgErr) {
				writeError(w, msgErr.status, msgErr.message)
				return
			}
			slogError(r, "发布题目", err)
			writeError(w, http.StatusInternalServerError, "更新失败")
			return
		}
	}
	if err := a.store.UpdateProblemStatus(r.Context(), id, req.Status); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "题目不存在")
			return
		}
		slogError(r, "更新题目状态", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id, "status": req.Status})
}

// publishError 发布校验的业务错误（含 HTTP 状态码）。
type publishError struct {
	status  int
	message string
}

func (e *publishError) Error() string { return e.message }

// validatePublishProblem 发布前校验：standard/spj/interactive 需 ≥1 个测试点且总分 100。
func (a *API) validatePublishProblem(r *http.Request, id int64) error {
	p, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		return &publishError{status: http.StatusNotFound, message: "题目不存在"}
	}
	if err != nil {
		return err
	}
	if p.Type == model.ProblemTypeOutputOnly {
		return nil
	}
	tcs, err := a.store.ListTestcases(r.Context(), id)
	if err != nil {
		return err
	}
	if len(tcs) == 0 {
		return &publishError{status: http.StatusBadRequest,
			message: "发布前请先上传测试点（至少 1 个且总分 100）"}
	}
	if msg := validateTotalScore(tcs, p.Type); msg != "" {
		return &publishError{status: http.StatusBadRequest, message: "发布前：" + msg}
	}
	return nil
}

// handleProblemBatch 批量操作：publish / disable / delete。
// 每项独立执行并返回结果；被比赛引用的题目删除会被拒绝（单项失败不影响其余项）。
func (a *API) handleProblemBatch(w http.ResponseWriter, r *http.Request) {
	var req struct {
		IDs    []int64 `json:"ids"`
		Action string  `json:"action"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if len(req.IDs) == 0 || len(req.IDs) > 100 {
		writeError(w, http.StatusBadRequest, "请选择 1-100 道题目")
		return
	}
	switch req.Action {
	case "publish", "disable", "delete":
	default:
		writeError(w, http.StatusBadRequest, "无效的操作（publish/disable/delete）")
		return
	}

	type result struct {
		ID    int64  `json:"id"`
		OK    bool   `json:"ok"`
		Error string `json:"error,omitempty"`
	}
	results := make([]result, 0, len(req.IDs))
	for _, id := range req.IDs {
		res := result{ID: id}
		switch req.Action {
		case "publish":
			if err := a.validatePublishProblem(r, id); err != nil {
				res.Error = err.Error()
			} else if a.store.UpdateProblemStatus(r.Context(), id, model.ProblemStatusPublished) == nil {
				res.OK = true
			} else {
				res.Error = "操作失败"
			}
		case "disable":
			res.OK = a.store.UpdateProblemStatus(r.Context(), id, model.ProblemStatusDisabled) == nil
		case "delete":
			if err := a.deleteProblemSafe(r, id); err != nil {
				res.Error = err.Error()
			} else {
				res.OK = true
			}
		}
		if !res.OK && res.Error == "" {
			res.Error = "操作失败"
		}
		results = append(results, res)
	}
	writeJSON(w, http.StatusOK, map[string]any{"results": results})
}

// deleteProblemSafe 删除题目（含引用校验与文件清理），返回失败原因。
func (a *API) deleteProblemSafe(r *http.Request, id int64) error {
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		return errors.New("题目不存在")
	}
	refs, _, err := a.store.ProblemUsage(r.Context(), id)
	if err != nil {
		return err
	}
	if len(refs) > 0 {
		names := make([]string, 0, len(refs))
		for _, ref := range refs {
			names = append(names, fmt.Sprintf("#%d %s", ref.ContestID, ref.Title))
		}
		return fmt.Errorf("被 %d 场比赛引用：%s", len(refs), strings.Join(names, "、"))
	}
	if err := a.store.DeleteProblem(r.Context(), id); err != nil {
		return err
	}
	return data.RemoveTests(a.cfg.DataDir, id)
}

// handleProblemUsage 题目的引用影响范围（删除前确认）。
func (a *API) handleProblemUsage(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	refs, subs, err := a.store.ProblemUsage(r.Context(), id)
	if err != nil {
		slogError(r, "题目引用统计", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	type contestRefDTO struct {
		ID    int64  `json:"id"`
		Title string `json:"title"`
	}
	dtos := make([]contestRefDTO, 0, len(refs))
	for _, ref := range refs {
		dtos = append(dtos, contestRefDTO{ID: ref.ContestID, Title: ref.Title})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"contests": dtos, "submissions": subs,
	})
}
