package api

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	defaultPageSize = 20
	maxPageSize     = 100
	maxUploadBytes  = 256 << 20 // 测试数据 zip 上限 256MB
	maxUploadMemory = 32 << 20  // multipart 内存缓冲
)

// problemListItem 列表页题目（不含题面正文，减小响应体积）。
type problemListItem struct {
	ID              int64     `json:"id"`
	Title           string    `json:"title"`
	Difficulty      int       `json:"difficulty"`
	Tags            []string  `json:"tags"`
	AcceptedCount   int64     `json:"accepted_count"`
	SubmissionCount int64     `json:"submission_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// problemPayload 创建/更新题目的请求体。
type problemPayload struct {
	Title         string         `json:"title"`
	Statement     string         `json:"statement"`
	InputFormat   string         `json:"input_format"`
	OutputFormat  string         `json:"output_format"`
	Hint          string         `json:"hint"`
	Samples       []model.Sample `json:"samples"`
	TimeLimitMs   int            `json:"time_limit_ms"`
	MemoryLimitKb int            `json:"memory_limit_kb"`
	Difficulty    int            `json:"difficulty"`
	Tags          []string       `json:"tags"`
	// Type 题目类型：standard | spj | interactive | output_only（空 = standard）
	Type string `json:"type"`
	// SPJSource 特殊评测器源码（type=spj）
	SPJSource string `json:"spj_source"`
	// InteractorSource 交互器源码（type=interactive）
	InteractorSource string `json:"interactor_source"`
	// TestcaseScores 各测试点分数（空 = 均分）
	TestcaseScores []int `json:"testcase_scores"`
	// SubmissionLimit 比赛内提交次数上限（0 = 不限）
	SubmissionLimit int `json:"submission_limit"`
}

// handleListProblems 题目列表（分页 + 标题模糊搜索）。
func (a *API) handleListProblems(w http.ResponseWriter, r *http.Request) {
	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if len(keyword) > 64 {
		keyword = keyword[:64]
	}

	items, total, err := a.store.ListProblems(r.Context(), keyword, page, size)
	if err != nil {
		slogError(r, "题目列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	list := make([]problemListItem, 0, len(items))
	for _, p := range items {
		list = append(list, problemListItem{
			ID: p.ID, Title: p.Title, Difficulty: p.Difficulty, Tags: p.Tags,
			AcceptedCount: p.AcceptedCount, SubmissionCount: p.SubmissionCount,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": total})
}

// handleGetProblem 题目详情。
func (a *API) handleGetProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err != nil {
		slogError(r, "题目详情", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleCreateProblem 创建题目（管理员）。
func (a *API) handleCreateProblem(w http.ResponseWriter, r *http.Request) {
	var payload problemPayload
	if !decodeJSON(w, r, &payload) {
		return
	}
	p := payloadToProblem(payload)
	if msg := validateProblem(payload); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := a.store.CreateProblem(r.Context(), &p); err != nil {
		slogError(r, "创建题目", err)
		writeError(w, http.StatusInternalServerError, "创建失败")
		return
	}
	writeJSON(w, http.StatusCreated, p)
}

// handleUpdateProblem 更新题目（管理员）。
func (a *API) handleUpdateProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	var payload problemPayload
	if !decodeJSON(w, r, &payload) {
		return
	}
	if msg := validateProblem(payload); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	p := payloadToProblem(payload)
	p.ID = id
	if err := a.store.UpdateProblem(r.Context(), &p); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "题目不存在")
			return
		}
		slogError(r, "更新题目", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	p, err = a.store.GetProblem(r.Context(), id)
	if err != nil {
		slogError(r, "更新题目", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	writeJSON(w, http.StatusOK, p)
}

// handleDeleteProblem 删除题目（管理员），同时清理测试数据文件。
func (a *API) handleDeleteProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if err := a.store.DeleteProblem(r.Context(), id); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "题目不存在")
			return
		}
		slogError(r, "删除题目", err)
		writeError(w, http.StatusInternalServerError, "删除失败")
		return
	}
	_ = data.RemoveTests(a.cfg.DataDir, id)
	w.WriteHeader(http.StatusNoContent)
}

// handleUploadTests 上传测试数据 zip（管理员），替换全部测试点。
// 约定：zip 内放成对的 N.in / N.out 文件。
func (a *API) handleUploadTests(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1<<20)
	if err := r.ParseMultipartForm(maxUploadMemory); err != nil {
		writeError(w, http.StatusBadRequest, "上传失败：文件过大或格式错误")
		return
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少 zip 文件（multipart 字段名 file）")
		return
	}
	defer file.Close()

	zipBytes, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取上传文件失败")
		return
	}
	if len(zipBytes) > maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "zip 文件过大（最大 256MB）")
		return
	}

	count, err := data.WriteTests(a.cfg.DataDir, id, zipBytes)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	slog.Info("测试数据已更新", "problem_id", id, "cases", count)
	writeJSON(w, http.StatusOK, map[string]any{"count": count})
}

// validateProblem 校验题目字段，返回错误消息（空串表示通过）。
func validateProblem(p problemPayload) string {
	if strings.TrimSpace(p.Title) == "" || utf8.RuneCountInString(p.Title) > 128 {
		return "标题长度需在 1-128 字符之间"
	}
	if len(p.Statement) > 64<<10 {
		return "题面过长（最大 64KB）"
	}
	if len(p.InputFormat) > 16<<10 || len(p.OutputFormat) > 16<<10 || len(p.Hint) > 16<<10 {
		return "输入/输出格式与提示各最大 16KB"
	}
	if len(p.Samples) > 20 {
		return "样例最多 20 组"
	}
	for i := range p.Samples {
		if len(p.Samples[i].Input) > 16<<10 || len(p.Samples[i].Output) > 16<<10 {
			return "样例内容过大（单组最大 16KB）"
		}
		if len(p.Samples[i].Note) > 1024 {
			return "样例说明过长（最大 1KB）"
		}
	}
	if p.TimeLimitMs < 100 || p.TimeLimitMs > 30000 {
		return "时间限制需在 100-30000 ms 之间"
	}
	if p.MemoryLimitKb < 16384 || p.MemoryLimitKb > 1048576 {
		return "内存限制需在 16MB-1GB 之间"
	}
	if p.Difficulty < 1 || p.Difficulty > 10 {
		return "难度需在 1-10 之间"
	}
	if len(p.Tags) > 10 {
		return "标签最多 10 个"
	}
	for _, t := range p.Tags {
		if utf8.RuneCountInString(strings.TrimSpace(t)) > 32 {
			return "单个标签最多 32 字符"
		}
	}
	// 特殊评测相关校验
	ptype := p.Type
	if ptype == "" {
		ptype = model.ProblemTypeStandard
	}
	switch ptype {
	case model.ProblemTypeStandard, model.ProblemTypeSPJ, model.ProblemTypeInteractive, model.ProblemTypeOutputOnly:
	default:
		return "无效的题目类型"
	}
	if ptype == model.ProblemTypeSPJ && strings.TrimSpace(p.SPJSource) == "" {
		return "SPJ 题目必须提供 spj_source"
	}
	if ptype == model.ProblemTypeInteractive && strings.TrimSpace(p.InteractorSource) == "" {
		return "交互题必须提供 interactor_source"
	}
	if len(p.SPJSource) > 64<<10 || len(p.InteractorSource) > 64<<10 {
		return "评测器源码过长（最大 64KB）"
	}
	if len(p.TestcaseScores) > 100 {
		return "测试点分数配置最多 100 项"
	}
	for _, s := range p.TestcaseScores {
		if s < 0 || s > 100 {
			return "单个测试点分数需在 0-100 之间"
		}
	}
	if p.SubmissionLimit < 0 || p.SubmissionLimit > 100 {
		return "提交次数限制需在 0-100 之间"
	}
	return ""
}

// payloadToProblem 把请求体转为模型并做归一化（去空白标签等）。
func payloadToProblem(payload problemPayload) model.Problem {
	tags := make([]string, 0, len(payload.Tags))
	for _, t := range payload.Tags {
		if t = strings.TrimSpace(t); t != "" {
			tags = append(tags, t)
		}
	}
	if tags == nil {
		tags = []string{}
	}
	if payload.Samples == nil {
		payload.Samples = []model.Sample{}
	}
	ptype := payload.Type
	if ptype == "" {
		ptype = model.ProblemTypeStandard
	}
	return model.Problem{
		Title:            strings.TrimSpace(payload.Title),
		Statement:        payload.Statement,
		InputFormat:      payload.InputFormat,
		OutputFormat:     payload.OutputFormat,
		Hint:             payload.Hint,
		Samples:          payload.Samples,
		TimeLimitMs:      payload.TimeLimitMs,
		MemoryLimitKb:    payload.MemoryLimitKb,
		Difficulty:       payload.Difficulty,
		Tags:             tags,
		Type:             ptype,
		SPJSource:        payload.SPJSource,
		InteractorSource: payload.InteractorSource,
		TestcaseScores:   payload.TestcaseScores,
		SubmissionLimit:  payload.SubmissionLimit,
	}
}

// slogError 统一的内部错误日志。
func slogError(r *http.Request, action string, err error) {
	slog.Error(action, "path", r.URL.Path, "err", err)
}
