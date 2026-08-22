package api

import (
	"errors"
	"fmt"
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
	// 以下字段仅管理员可见（管理后台列表），指针保证 0 值也输出
	Type          *string `json:"type,omitempty"`
	Status        *string `json:"status,omitempty"`
	TestcaseCount *int64  `json:"testcase_count,omitempty"`
}

// handleListProblems 题目列表。
// 公共：仅 published，关键词搜索；管理员：额外支持难度/标签/题型/状态过滤，返回全部状态。
func (a *API) handleListProblems(w http.ResponseWriter, r *http.Request) {
	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)
	keyword := strings.TrimSpace(r.URL.Query().Get("keyword"))
	if len(keyword) > 64 {
		keyword = keyword[:64]
	}
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin

	f := store.ProblemFilter{
		Keyword: keyword,
		Page:    page,
		Size:    size,
		// 公共列表只返回已发布题目；管理员可查看全部状态
		IncludeUnpublished: isAdmin,
	}
	if isAdmin {
		if v := queryInt(r, "difficulty", 0); v >= model.MinDifficulty && v <= model.MaxDifficulty {
			f.Difficulty = &v
		}
		f.Tag = strings.TrimSpace(r.URL.Query().Get("tag"))
		f.Type = strings.TrimSpace(r.URL.Query().Get("type"))
		f.Status = strings.TrimSpace(r.URL.Query().Get("status"))
	}

	items, total, err := a.store.ListProblems(r.Context(), f)
	if err != nil {
		slogError(r, "题目列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	list := make([]problemListItem, 0, len(items))
	for _, p := range items {
		item := problemListItem{
			ID: p.ID, Title: p.Title, Difficulty: p.Difficulty, Tags: p.Tags,
			AcceptedCount: p.AcceptedCount, SubmissionCount: p.SubmissionCount,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		}
		if isAdmin {
			item.Type = &p.Type
			item.Status = &p.Status
			item.TestcaseCount = &p.TestcaseCount
		}
		list = append(list, item)
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": list, "total": total})
}

// problemDetailDTO 题目详情响应：评测器源码仅管理员可见。
type problemDetailDTO struct {
	ID              int64          `json:"id"`
	Title           string         `json:"title"`
	Statement       string         `json:"statement"`
	InputFormat     string         `json:"input_format"`
	OutputFormat    string         `json:"output_format"`
	Hint            string         `json:"hint"`
	Samples         []model.Sample `json:"samples"`
	TimeLimitMs     int            `json:"time_limit_ms"`
	MemoryLimitKb   int            `json:"memory_limit_kb"`
	Difficulty      int            `json:"difficulty"`
	Tags            []string       `json:"tags"`
	AcceptedCount   int64          `json:"accepted_count"`
	SubmissionCount int64          `json:"submission_count"`
	Type            string         `json:"type"`
	TestcaseScores  []int          `json:"testcase_scores"`
	SubmissionLimit int            `json:"submission_limit"`
	Status          string         `json:"status"`
	CreatedAt       time.Time      `json:"created_at"`
	UpdatedAt       time.Time      `json:"updated_at"`
	// 管理员专属：评测器源码与测试点数量
	SPJSource        string `json:"spj_source,omitempty"`
	InteractorSource string `json:"interactor_source,omitempty"`
	TestcaseCount    int64  `json:"testcase_count,omitempty"`
	IsFavorite       bool   `json:"is_favorite,omitempty"`
}

// handleGetProblem 题目详情。
// 非管理员仅能访问已发布题目，且不返回评测器源码；
// 管理员可访问任意状态并看到全部字段。
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
	u, loggedIn := userFromCtx(r.Context())
	isAdmin := loggedIn && u.Role == model.RoleAdmin
	if !isAdmin && p.Status != model.ProblemStatusPublished {
		// 未发布题目对公共接口不可见（与不存在同响应，避免泄露存在性）
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
	if loggedIn {
		if favorite, favoriteErr := a.store.IsProblemFavorite(r.Context(), u.ID, p.ID); favoriteErr == nil {
			dto.IsFavorite = favorite
		}
	}
	if isAdmin {
		dto.SPJSource = p.SPJSource
		dto.InteractorSource = p.InteractorSource
		dto.TestcaseCount = p.TestcaseCount
	}
	writeJSON(w, http.StatusOK, dto)
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
	// Status 题目状态：draft | published | disabled（空 = published）
	Status string `json:"status"`
}

// problemPublicSubmitAllowed 题目是否允许公开提交（published 或管理员）。
func problemPublicSubmitAllowed(p model.Problem, isAdmin bool) bool {
	return p.Status == model.ProblemStatusPublished || isAdmin
}

// problemContestSubmitAllowed 比赛内提交：published 与 draft 均可（比赛专用题可为草稿），停用不可。
func problemContestSubmitAllowed(p model.Problem) bool {
	return p.Status == model.ProblemStatusPublished || p.Status == model.ProblemStatusDraft
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
// 被比赛引用的题目拒绝删除（409），避免静默破坏比赛配置。
func (a *API) handleDeleteProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	refs, _, err := a.store.ProblemUsage(r.Context(), id)
	if err != nil {
		slogError(r, "删除题目引用检查", err)
		writeError(w, http.StatusInternalServerError, "查询引用失败")
		return
	}
	if len(refs) > 0 {
		names := make([]string, 0, len(refs))
		for _, ref := range refs {
			names = append(names, fmt.Sprintf("#%d %s", ref.ContestID, ref.Title))
		}
		writeError(w, http.StatusConflict,
			fmt.Sprintf("该题目被 %d 场比赛引用，不能删除：%s", len(refs), strings.Join(names, "、")))
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
	if p.Difficulty < model.MinDifficulty || p.Difficulty > model.MaxDifficulty {
		return "请选择有效的题目难度"
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
	status := p.Status
	if status == "" {
		status = model.ProblemStatusPublished
	}
	switch status {
	case model.ProblemStatusDraft, model.ProblemStatusPublished, model.ProblemStatusDisabled:
	default:
		return "无效的题目状态（draft/published/disabled）"
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
	status := payload.Status
	if status == "" {
		status = model.ProblemStatusPublished
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
		Status:           status,
	}
}

// slogError 统一的内部错误日志。
func slogError(r *http.Request, action string, err error) {
	slog.Error(action, "path", r.URL.Path, "err", err)
}
