// Package api 实现 HTTP 路由与全部接口处理器。
package api

import (
	"net/http"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/queue"
	"github.com/yunoj/yunoj/internal/store"
)

// API 聚合所有 HTTP 处理器及其依赖。
type API struct {
	cfg   config.Config
	store *store.Store
	queue *queue.Queue
}

// New 创建 API 实例。
func New(cfg config.Config, st *store.Store, q *queue.Queue) *API {
	return &API{cfg: cfg, store: st, queue: q}
}

// Router 组装路由。返回的 handler 同时提供 /api 接口与前端静态资源。
func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(a.recoverer, a.cors, a.requestLog)

	// 健康检查（Docker healthcheck 用）
	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{"status": "ok"})
	})

	// 公开接口
	r.Post("/api/auth/register", a.handleRegister)
	r.Post("/api/auth/login", a.handleLogin)
	r.Get("/api/languages", a.handleLanguages)
	r.Get("/api/problems", a.handleListProblems)
	r.Get("/api/problems/{id}", a.handleGetProblem)
	r.Get("/api/submissions", a.handleListSubmissions)

	// 匿名可访问，但携带有效令牌时可见敏感字段（代码/逐点结果）
	r.Group(func(r chi.Router) {
		r.Use(a.optionalAuth)
		r.Get("/api/submissions/{id}", a.handleGetSubmission)
	})

	// 比赛接口：匿名可访问，携带有效令牌时返回报名状态/管理员标记
	r.Group(func(r chi.Router) {
		r.Use(a.optionalAuth)
		r.Get("/api/contests", a.handleListContests)
		r.Get("/api/contests/{id}", a.handleGetContest)
		r.Get("/api/contests/{id}/standings", a.handleContestStandings)
		r.Get("/api/contests/{id}/teams/{team_id}/avatar", a.handleServeContestAvatar)
	})

	// 登录用户接口
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth)
		r.Get("/api/auth/me", a.handleMe)
		r.Post("/api/submissions", a.handleSubmit)
		r.Post("/api/problems/{id}/test", a.handleRunTest)
		r.Post("/api/problems/{id}/test-samples", a.handleRunSamples)
		r.Post("/api/contests/{id}/register", a.handleRegisterContest)
		r.Post("/api/contests/{id}/avatar", a.handleUploadContestAvatar)
		r.Post("/api/contests/{id}/submit", a.handleContestSubmit)
	})

	// 管理员接口
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth, a.requireAdmin)
		r.Post("/api/problems", a.handleCreateProblem)
		r.Put("/api/problems/{id}", a.handleUpdateProblem)
		r.Delete("/api/problems/{id}", a.handleDeleteProblem)
		r.Post("/api/problems/{id}/tests", a.handleUploadTests)
		r.Post("/api/submissions/{id}/rejudge", a.handleRejudge)
		r.Post("/api/contests", a.handleCreateContest)
		r.Put("/api/contests/{id}", a.handleUpdateContest)
		r.Delete("/api/contests/{id}", a.handleDeleteContest)
		r.Post("/api/contests/{id}/problems", a.handleAddContestProblem)
		r.Delete("/api/contests/{id}/problems/{problem_id}", a.handleRemoveContestProblem)
		r.Get("/api/contests/{id}/rollboard", a.handleContestRollBoard)
	})

	// 未匹配路径：/api 下返回 JSON 404，其余走前端静态资源
	static := staticHandler()
	r.NotFound(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		if strings.HasPrefix(req.URL.Path, "/api/") {
			writeError(w, http.StatusNotFound, "接口不存在")
			return
		}
		static.ServeHTTP(w, req)
	}))

	return r
}
