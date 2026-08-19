package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/judge"
	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	maxTestInputBytes    = 1 << 20 // 自测输入上限 1MB
	testRateLimitSecs    = 3       // 测试运行间隔下限（秒）
	selfTestWaitTimeout  = 15 * time.Second
	sampleTestWaitTime   = 30 * time.Second
	testResultPollPeriod = 150 * time.Millisecond
)

type testRequest struct {
	Language string `json:"language"`
	Code     string `json:"code"`
	Input    string `json:"input"`
	// Optimize 可选；缺省视为 true（默认开启 O2）
	Optimize *bool `json:"optimize"`
}

// optimizeOrDefault 解析可选的 O2 开关字段，缺省为 true。
func optimizeOrDefault(v *bool) bool {
	if v == nil {
		return true
	}
	return *v
}

// singleTestResponse 自测（单个用例）响应，扁平化字段。
type singleTestResponse struct {
	Status       string `json:"status"`
	Stdout       string `json:"stdout"`
	Stderr       string `json:"stderr,omitempty"`
	TimeMs       int    `json:"time_ms"`
	MemoryKb     int    `json:"memory_kb"`
	CompileError string `json:"compile_error,omitempty"`
}

// sampleTestResponse 样例测试响应。
type sampleTestResponse struct {
	Status       string                 `json:"status"`
	CompileError string                 `json:"compile_error,omitempty"`
	Cases        []judge.TestCaseResult `json:"cases"`
}

// handleRunTest 自测：用自定义输入运行代码，不落库、不计入提交。
func (a *API) handleRunTest(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())

	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if !problemPublicSubmitAllowed(p, u.Role == model.RoleAdmin) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	a.handleSingleTest(w, r, id, u.ID)
}

// handleContestRunTest 为比赛题提供与普通题一致的自测能力。
// 比赛题不要求公开发布，但必须通过比赛可见性、报名、开赛时间和题目归属校验。
func (a *API) handleContestRunTest(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
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
		slogError(r, "比赛自测", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return
	}
	if u.Role != model.RoleAdmin {
		registered, err := a.store.IsContestTeam(r.Context(), cid, u.ID)
		if err != nil || !registered {
			writeError(w, http.StatusForbidden, "请先报名参加该比赛")
			return
		}
		if time.Now().Before(c.StartTime) {
			writeError(w, http.StatusForbidden, "比赛尚未开始，无法自测")
			return
		}
	}
	if _, err := a.store.GetContestProblem(r.Context(), cid, pid); err != nil {
		writeError(w, http.StatusNotFound, "该题目不属于本场比赛")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), pid); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	a.handleSingleTest(w, r, pid, u.ID)
}

func (a *API) handleSingleTest(w http.ResponseWriter, r *http.Request, problemID, userID int64) {
	var req testRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := a.validateTestRequest(r, &req, userID); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if len(req.Input) > maxTestInputBytes {
		writeError(w, http.StatusBadRequest, "输入过长（最大 1MB）")
		return
	}

	task := judge.TestTask{
		RunID:     randomRunID(),
		ProblemID: problemID,
		Language:  req.Language,
		Code:      req.Code,
		Optimize:  optimizeOrDefault(req.Optimize),
		Cases:     []judge.TestInput{{Input: req.Input}},
	}
	result, err := a.submitTestTask(r.Context(), task, selfTestWaitTimeout)
	if err != nil {
		writeError(w, http.StatusGatewayTimeout, "运行超时，请稍后重试")
		return
	}

	resp := singleTestResponse{
		Status:       result.Status,
		CompileError: result.CompileError,
	}
	if len(result.Cases) > 0 {
		c := result.Cases[0]
		resp.Stdout, resp.Stderr = c.Stdout, c.Stderr
		resp.TimeMs, resp.MemoryKb = c.TimeMs, c.MemoryKb
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleRunSamples 样例测试：用题面样例的输入运行代码并与期望输出比较。
func (a *API) handleRunSamples(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())

	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	problem, err := a.store.GetProblem(r.Context(), id)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "题目不存在")
			return
		}
		slogError(r, "样例测试", err)
		writeError(w, http.StatusInternalServerError, "运行失败")
		return
	}
	if !problemPublicSubmitAllowed(problem, u.Role == model.RoleAdmin) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if len(problem.Samples) == 0 {
		writeError(w, http.StatusBadRequest, "该题目没有样例")
		return
	}
	var req testRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := a.validateTestRequest(r, &req, u.ID); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}

	task := judge.TestTask{
		RunID:     randomRunID(),
		ProblemID: id,
		Language:  req.Language,
		Code:      req.Code,
		Optimize:  optimizeOrDefault(req.Optimize),
		Cases:     make([]judge.TestInput, 0, len(problem.Samples)),
	}
	for _, s := range problem.Samples {
		task.Cases = append(task.Cases, judge.TestInput{Input: s.Input, Expected: s.Output})
	}
	result, err := a.submitTestTask(r.Context(), task, sampleTestWaitTime)
	if err != nil {
		writeError(w, http.StatusGatewayTimeout, "运行超时，请稍后重试")
		return
	}
	writeJSON(w, http.StatusOK, sampleTestResponse{
		Status:       result.Status,
		CompileError: result.CompileError,
		Cases:        result.Cases,
	})
}

// validateTestRequest 公共校验：语言、代码与限流。返回错误消息（空为通过）。
func (a *API) validateTestRequest(r *http.Request, req *testRequest, userID int64) string {
	if _, ok := langs.ByKey(req.Language); !ok {
		return "不支持的语言"
	}
	if len(req.Code) == 0 || len(req.Code) > maxCodeBytes {
		return fmt.Sprintf("代码长度需在 1-%d 字节之间", maxCodeBytes)
	}
	allowed, err := a.queue.TryLock(r.Context(),
		fmt.Sprintf("oj:ratelimit:test:%d", userID), testRateLimitSecs*time.Second)
	if err != nil {
		slogError(r, "测试限流", err)
		return "运行失败，请稍后重试"
	}
	if !allowed {
		return "运行过于频繁，请稍后再试"
	}
	return ""
}

// submitTestTask 推送测试任务并阻塞等待结果。
func (a *API) submitTestTask(ctx context.Context, task judge.TestTask, timeout time.Duration) (*judge.TestResult, error) {
	payload, err := json.Marshal(task)
	if err != nil {
		return nil, err
	}
	if err := a.queue.PushTest(ctx, string(payload)); err != nil {
		return nil, err
	}
	return a.waitTestResult(ctx, task.RunID, timeout)
}

// waitTestResult 轮询 Redis 直到评测机写入结果或超时。
func (a *API) waitTestResult(ctx context.Context, runID string, timeout time.Duration) (*judge.TestResult, error) {
	deadline := time.After(timeout)
	ticker := time.NewTicker(testResultPollPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-deadline:
			return nil, errors.New("timeout")
		case <-ticker.C:
			raw, found, err := a.queue.GetTestResult(ctx, runID)
			if err != nil {
				return nil, err
			}
			if !found {
				continue
			}
			var result judge.TestResult
			if err := json.Unmarshal([]byte(raw), &result); err != nil {
				return nil, err
			}
			return &result, nil
		}
	}
}

// randomRunID 生成随机运行 ID。
func randomRunID() string {
	b := make([]byte, 16)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}
