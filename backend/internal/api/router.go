// Package api 实现 HTTP 路由与全部接口处理器。
package api

import (
	"net/http"
	"time"

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

// Router 组装 API 路由。前端静态资源由独立服务提供。
func (a *API) Router() http.Handler {
	r := chi.NewRouter()
	r.Use(a.recoverer, a.cors, a.requestLog)

	// 健康检查（Docker healthcheck 用；server_time 供前端校正客户端时钟偏差）
	r.Get("/api/health", func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]string{
			"status":      "ok",
			"server_time": time.Now().Format(time.RFC3339Nano),
		})
	})

	// 公开接口
	r.Post("/api/auth/register", a.handleRegister)
	r.Post("/api/auth/login", a.handleLogin)
	r.Get("/api/languages", a.handleLanguages)
	r.Get("/api/rankings", a.handleRankings)
	r.Group(func(r chi.Router) {
		r.Use(a.optionalAuth)
		r.Get("/api/home", a.handleHome)
	})

	// 匿名可访问，但携带有效令牌时可见敏感字段（管理员看到草稿/停用题目与评测器源码）
	r.Group(func(r chi.Router) {
		r.Use(a.optionalAuth)
		r.Get("/api/problems", a.handleListProblems)
		r.Get("/api/problems/{id}", a.handleGetProblem)
		r.Get("/api/problems/{id}/learning", a.handleProblemLearning)
		r.Get("/api/submissions/{id}", a.handleGetSubmission)
		r.Get("/api/users/{id}/avatar", a.handleServeUserAvatar)
	})

	// 比赛接口：匿名可访问，携带有效令牌时返回报名状态/管理员标记
	r.Group(func(r chi.Router) {
		r.Use(a.optionalAuth)
		r.Get("/api/contests", a.handleListContests)
		r.Get("/api/contests/{id}", a.handleGetContest)
		r.Get("/api/contests/{id}/standings", a.handleContestStandings)
		r.Get("/api/contests/{id}/teams/{team_id}/avatar", a.handleServeContestAvatar)
		r.Get("/api/contests/{id}/cover", a.handleServeContestCover)
	})

	// 登录用户接口
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth)
		r.Get("/api/auth/me", a.handleMe)
		r.Post("/api/profile/password", a.handleChangePassword)
		r.Get("/api/notifications", a.handleListNotifications)
		r.Post("/api/notifications/{id}/read", a.handleReadNotification)
		r.Get("/api/profile", a.handleProfile)
		r.Post("/api/profile/avatar", a.handleUploadUserAvatar)
		r.Get("/api/profile/favorites", a.handleListFavorites)
		// 普通用户只能看到自己的提交，管理员可查看全量提交。
		r.Get("/api/submissions", a.handleListSubmissions)
		r.Post("/api/problems/{id}/favorite", a.handleToggleProblemFavorite)
		r.Post("/api/problems/{id}/discussions", a.handleCreateProblemDiscussion)
		r.Delete("/api/discussions/{id}", a.handleDeleteProblemDiscussion)
		r.Post("/api/submissions", a.handleSubmit)
		r.Get("/api/groups", a.handleListGroups)
		r.Get("/api/groups/{id}", a.handleGetGroup)
		r.Get("/api/assignments/{id}", a.handleGetAssignment)
		r.Get("/api/assignments/{id}/progress", a.handleAssignmentProgress)
		r.Post("/api/problems/{id}/test", a.handleRunTest)
		r.Post("/api/problems/{id}/test-samples", a.handleRunSamples)
		r.Post("/api/contests/{id}/problems/{problem_id}/test", a.handleContestRunTest)
		r.Post("/api/contests/{id}/register", a.handleRegisterContest)
		r.Get("/api/contests/{id}/registration", a.handleGetContestRegistration)
		r.Post("/api/contests/{id}/teams/{team_id}/members", a.handleAddContestMember)
		r.Delete("/api/contests/{id}/teams/{team_id}/members/{user_id}", a.handleRemoveContestMember)
		r.Post("/api/contests/{id}/avatar", a.handleUploadContestAvatar)
		r.Post("/api/contests/{id}/submit", a.handleContestSubmit)
		r.Get("/api/contests/{id}/overview", a.handleContestOverview)
		r.Get("/api/contests/{id}/communications", a.handleContestCommunications)
		r.Get("/api/contests/{id}/problems/{problem_id}", a.handleContestProblem)
		r.Get("/api/contests/{id}/submissions", a.handleContestMySubmissions)
		r.Post("/api/contests/{id}/questions", a.handleCreateContestQuestion)
	})

	// 教师/管理员接口：班级、作业和作业内题目管理。
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth, a.requireStaff)
		r.Post("/api/groups", a.handleCreateGroup)
		r.Put("/api/groups/{id}", a.handleUpdateGroup)
		r.Post("/api/groups/{id}/members", a.handleAddGroupMember)
		r.Delete("/api/groups/{id}/members/{user_id}", a.handleRemoveGroupMember)
		r.Post("/api/groups/{id}/assignments", a.handleCreateAssignment)
		r.Put("/api/assignments/{id}", a.handleUpdateAssignment)
		r.Post("/api/assignments/{id}/problems", a.handleAddAssignmentProblem)
		r.Delete("/api/assignments/{id}/problems/{problem_id}", a.handleRemoveAssignmentProblem)
	})

	// 管理员接口
	r.Group(func(r chi.Router) {
		r.Use(a.requireAuth, a.requireAdmin)
		r.Get("/api/admin/users", a.handleAdminListUsers)
		r.Patch("/api/admin/users/{id}", a.handleAdminUpdateUser)
		r.Put("/api/problems/{id}/editorial", a.handleUpsertProblemEditorial)
		r.Get("/api/admin/judge/health", a.handleJudgeHealth)
		r.Get("/api/admin/judge/cluster", a.handleJudgeCluster)
		r.Patch("/api/admin/judge/nodes/{node_id}", a.handleUpdateJudgeNode)
		r.Patch("/api/admin/judge/languages/{key}", a.handleUpdateJudgeLanguage)
		r.Post("/api/admin/judge/recover-stale", a.handleResetStaleJudgeTasks)
		r.Post("/api/notifications", a.handleCreateNotification)
		r.Delete("/api/notifications/{id}", a.handleDeleteNotification)
		r.Get("/api/contests/{id}/participants", a.handleContestParticipants)
		r.Delete("/api/contests/{id}/participants/{team_id}", a.handleRemoveContestParticipant)
		r.Get("/api/contests/{id}/participants/export", a.handleExportContestParticipants)
		r.Get("/api/contests/{id}/standings/export", a.handleExportContestStandings)
		r.Get("/api/contests/{id}/data-package", a.handleExportContestDataPackage)
		r.Post("/api/contests/{id}/cover", a.handleUploadContestCover)
		r.Post("/api/problems", a.handleCreateProblem)
		r.Put("/api/problems/{id}", a.handleUpdateProblem)
		r.Delete("/api/problems/{id}", a.handleDeleteProblem)
		r.Post("/api/problems/{id}/tests", a.handleUploadTests)
		r.Post("/api/problems/{id}/copy", a.handleCopyProblem)
		r.Patch("/api/problems/{id}/status", a.handleUpdateProblemStatus)
		r.Get("/api/problems/{id}/usage", a.handleProblemUsage)
		r.Post("/api/problems/batch", a.handleProblemBatch)
		// 测试点管理
		r.Get("/api/problems/{id}/testcases", a.handleListTestcases)
		r.Post("/api/problems/{id}/testcases/preview", a.handlePreviewTestsZIP)
		r.Post("/api/problems/{id}/testcases/import", a.handleImportTestsZIP)
		r.Post("/api/problems/{id}/testcases", a.handleAddTestcase)
		r.Put("/api/problems/{id}/testcases/{ordinal}", a.handleUpdateTestcase)
		r.Delete("/api/problems/{id}/testcases/{ordinal}", a.handleDeleteTestcase)
		r.Put("/api/problems/{id}/testcases/order", a.handleReorderTestcases)
		r.Post("/api/submissions/{id}/rejudge", a.handleRejudge)
		r.Post("/api/contests", a.handleCreateContest)
		r.Put("/api/contests/{id}", a.handleUpdateContest)
		r.Delete("/api/contests/{id}", a.handleDeleteContest)
		r.Post("/api/contests/{id}/problems", a.handleAddContestProblem)
		r.Put("/api/contests/{id}/problems/{problem_id}", a.handleUpdateContestProblem)
		r.Put("/api/contests/{id}/problems/order", a.handleReorderContestProblems)
		r.Delete("/api/contests/{id}/problems/{problem_id}", a.handleRemoveContestProblem)
		r.Post("/api/contests/{id}/announcements", a.handleCreateContestAnnouncement)
		r.Delete("/api/contests/{id}/announcements/{announcement_id}", a.handleDeleteContestAnnouncement)
		r.Put("/api/contests/{id}/questions/{question_id}", a.handleAnswerContestQuestion)
	})

	// 未匹配路径统一返回 JSON，SPA 路由回退由前端服务负责。
	r.NotFound(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		writeError(w, http.StatusNotFound, "接口不存在")
	}))

	return r
}
