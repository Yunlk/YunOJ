package api

import (
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	maxCodeBytes        = 64 << 10 // 代码上限 64KB
	submitRateLimitSecs = 10       // 每用户提交间隔下限（秒）
)

// knownStatuses 全部合法判题状态（过滤器校验用）。
var knownStatuses = map[string]bool{
	model.StatusPending:             true,
	model.StatusRunning:             true,
	model.StatusAccepted:            true,
	model.StatusWrongAnswer:         true,
	model.StatusTimeLimitExceeded:   true,
	model.StatusMemoryLimitExceeded: true,
	model.StatusOutputLimitExceeded: true,
	model.StatusRuntimeError:        true,
	model.StatusCompileError:        true,
	model.StatusSystemError:         true,
}

type submitRequest struct {
	ProblemID int64  `json:"problem_id"`
	Language  string `json:"language"`
	Code      string `json:"code"`
	// Optimize 可选；缺省视为 true（默认开启 O2）
	Optimize *bool `json:"optimize"`
}

// submissionListItem 提交列表项（不含代码等敏感/大字段）。
type submissionListItem struct {
	ID           int64     `json:"id"`
	ProblemID    int64     `json:"problem_id"`
	ProblemTitle string    `json:"problem_title"`
	UserID       int64     `json:"user_id"`
	Username     string    `json:"username"`
	Language     string    `json:"language"`
	Status       string    `json:"status"`
	TimeMs       int       `json:"time_ms"`
	MemoryKb     int       `json:"memory_kb"`
	Score        int       `json:"score"`
	CreatedAt    time.Time `json:"created_at"`
}

// submissionDetail 提交详情。代码/编译错误/逐点结果仅本人与管理员
// 可见，其余用户这三个字段为 null。
type submissionDetail struct {
	ID           int64               `json:"id"`
	ProblemID    int64               `json:"problem_id"`
	ProblemTitle string              `json:"problem_title"`
	UserID       int64               `json:"user_id"`
	Username     string              `json:"username"`
	Language     string              `json:"language"`
	Status       string              `json:"status"`
	TimeMs       int                 `json:"time_ms"`
	MemoryKb     int                 `json:"memory_kb"`
	Score        int                 `json:"score"`
	CreatedAt    time.Time           `json:"created_at"`
	Code         *string             `json:"code"`
	CompileError *string             `json:"compile_error"`
	CaseResults  *[]model.CaseResult `json:"case_results"`
	CaseScores   *[]int              `json:"case_scores"`
}

// handleSubmit 创建提交并入队评测。做三层防护：
// 题目存在性与状态（未发布不可提交）、语言合法性、每用户提交限流。
func (a *API) handleSubmit(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())

	var req submitRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ProblemID <= 0 {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), req.ProblemID)
	if err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "题目不存在")
			return
		}
		slogError(r, "提交", err)
		writeError(w, http.StatusInternalServerError, "提交失败")
		return
	}
	if !problemPublicSubmitAllowed(p, u.Role == model.RoleAdmin) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if msg, status := a.validateSubmitBasics(r, req.Language, req.Code, u.ID); msg != "" {
		writeError(w, status, msg)
		return
	}

	optimize := true
	if req.Optimize != nil {
		optimize = *req.Optimize
	}
	id, err := a.store.CreateSubmission(r.Context(), req.ProblemID, u.ID, req.Language, req.Code, optimize)
	if err != nil {
		slogError(r, "创建提交", err)
		writeError(w, http.StatusInternalServerError, "提交失败")
		return
	}
	if err := a.queue.Push(r.Context(), id); err != nil {
		// 入队失败：提交保留为 pending，Redis 恢复后需重测。
		// 日志记录供运维发现。
		slogError(r, "入队", err)
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": id})
}

// validateSubmitBasics 提交公共校验：语言、代码长度、提交限流。
// 返回错误消息与 HTTP 状态码（消息为空表示通过），供普通提交与比赛提交共用。
func (a *API) validateSubmitBasics(r *http.Request, language, code string, userID int64) (string, int) {
	if _, ok := langs.ByKey(language); !ok {
		return "不支持的语言", http.StatusBadRequest
	}
	if len(code) == 0 || len(code) > maxCodeBytes {
		return fmt.Sprintf("代码长度需在 1-%d 字节之间", maxCodeBytes), http.StatusBadRequest
	}
	// 限流：同一用户每 10 秒最多提交一次
	allowed, err := a.queue.TryLock(r.Context(),
		fmt.Sprintf("oj:ratelimit:submit:%d", userID), submitRateLimitSecs*time.Second)
	if err != nil {
		slogError(r, "限流", err)
		return "提交失败，请稍后重试", http.StatusInternalServerError
	}
	if !allowed {
		return "提交过于频繁，请稍后再试", http.StatusTooManyRequests
	}
	return "", http.StatusOK
}

// handleListSubmissions 提交列表（分页 + 题目/用户/状态过滤）。
func (a *API) handleListSubmissions(w http.ResponseWriter, r *http.Request) {
	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)

	f := store.SubmissionFilter{Page: page, Size: size}
	if v := int64(queryInt(r, "problem_id", 0)); v > 0 {
		f.ProblemID = &v
	}
	if v := int64(queryInt(r, "user_id", 0)); v > 0 {
		f.UserID = &v
	}
	if s := r.URL.Query().Get("status"); s != "" {
		if !knownStatuses[s] {
			writeError(w, http.StatusBadRequest, "无效的状态过滤条件")
			return
		}
		f.Status = s
	}

	items, total, err := a.store.ListSubmissions(r.Context(), f)
	if err != nil {
		slogError(r, "提交列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	list := make([]submissionListItem, 0, len(items))
	for _, s := range items {
		list = append(list, submissionListItem{
			ID: s.ID, ProblemID: s.ProblemID, ProblemTitle: s.ProblemTitle,
			UserID: s.UserID, Username: s.Username, Language: s.Language,
			Status: s.Status, TimeMs: s.TimeMs, MemoryKb: s.MemoryKb,
			Score: s.Score, CreatedAt: s.CreatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": total})
}

// handleGetSubmission 提交详情，按权限脱敏。
func (a *API) handleGetSubmission(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的提交 ID")
		return
	}
	s, err := a.store.GetSubmission(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "提交不存在")
		return
	}
	if err != nil {
		slogError(r, "提交详情", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}

	u, loggedIn := userFromCtx(r.Context())
	detail := submissionDetail{
		ID: s.ID, ProblemID: s.ProblemID, ProblemTitle: s.ProblemTitle,
		UserID: s.UserID, Username: s.Username, Language: s.Language,
		Status: s.Status, TimeMs: s.TimeMs, MemoryKb: s.MemoryKb,
		Score: s.Score, CreatedAt: s.CreatedAt,
	}
	if loggedIn && (u.ID == s.UserID || u.Role == model.RoleAdmin) {
		code, compileError := s.Code, s.CompileError
		cases := s.CaseResults
		scores := s.CaseScores
		detail.Code = &code
		detail.CompileError = &compileError
		detail.CaseResults = &cases
		detail.CaseScores = &scores
	}
	writeJSON(w, http.StatusOK, detail)
}

// handleRejudge 重测（管理员）：重置状态并重新入队。
func (a *API) handleRejudge(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的提交 ID")
		return
	}
	if err := a.store.ResetForRejudge(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "提交不存在")
			return
		}
		slogError(r, "重测", err)
		writeError(w, http.StatusInternalServerError, "重测失败")
		return
	}
	if err := a.queue.Push(r.Context(), id); err != nil {
		slogError(r, "重测入队", err)
		writeError(w, http.StatusInternalServerError, "重测入队失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"id": id})
}

// handleLanguages 支持的语言列表。
func (a *API) handleLanguages(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{"items": langs.All()})
}
