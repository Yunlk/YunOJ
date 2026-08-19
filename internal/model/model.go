// Package model 定义核心数据模型与判题状态常量。
package model

import "time"

// 判题状态。全部状态字符串集中定义于此，避免散落魔法字符串。
const (
	StatusPending             = "pending"               // 排队中
	StatusRunning             = "running"               // 评测中
	StatusAccepted            = "accepted"              // 通过
	StatusWrongAnswer         = "wrong_answer"          // 答案错误
	StatusTimeLimitExceeded   = "time_limit_exceeded"   // 超时
	StatusMemoryLimitExceeded = "memory_limit_exceeded" // 内存超限
	StatusOutputLimitExceeded = "output_limit_exceeded" // 输出超限
	StatusRuntimeError        = "runtime_error"         // 运行时错误
	StatusCompileError        = "compile_error"         // 编译错误
	StatusSystemError         = "system_error"          // 系统错误（沙箱/评测器故障）
)

// 用户角色。
const (
	RoleUser  = "user"
	RoleAdmin = "admin"
)

// User 用户。
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	CreatedAt time.Time `json:"created_at"`
}

// Sample 题面样例。
type Sample struct {
	Input  string `json:"input"`
	Output string `json:"output"`
	Note   string `json:"note"`
}

// Problem 题目。AcceptedCount/SubmissionCount 为反规范化计数，
// 由评测机在首次评测时更新，用于列表页快速展示。
type Problem struct {
	ID              int64    `json:"id"`
	Title           string   `json:"title"`
	Statement       string   `json:"statement"`
	InputFormat     string   `json:"input_format"`
	OutputFormat    string   `json:"output_format"`
	Hint            string   `json:"hint"`
	Samples         []Sample `json:"samples"`
	TimeLimitMs     int      `json:"time_limit_ms"`
	MemoryLimitKb   int      `json:"memory_limit_kb"`
	Difficulty      int      `json:"difficulty"`
	Tags            []string `json:"tags"`
	AcceptedCount   int64    `json:"accepted_count"`
	SubmissionCount int64    `json:"submission_count"`
	// Type 题目类型：standard | spj | interactive | output_only
	Type string `json:"type"`
	// SPJSource 特殊评测器源码（Type=spj 时使用，沙箱内编译运行）
	SPJSource string `json:"spj_source"`
	// InteractorSource 交互器源码（Type=interactive 时使用）
	InteractorSource string `json:"interactor_source"`
	// TestcaseScores 各测试点分数（与排序后的测试点对齐；空 = 平均分配）。
	// 自迁移 5 起弃用：权威分值存于 problem_testcases，本列仅保留用于回填。
	TestcaseScores []int `json:"testcase_scores"`
	// SubmissionLimit 比赛内该题提交次数上限（0 = 不限）。
	// 自迁移 5 起弃用：比赛提交上限迁移到 contests.submission_limit / contest_problems.submission_limit。
	SubmissionLimit int `json:"submission_limit"`
	// Status 题目状态：draft | published | disabled（未发布题目不可通过公共接口访问）
	Status    string    `json:"status"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
	// TestcaseCount 测试点数量（查询时聚合，不落库）
	TestcaseCount int64 `json:"-"`
}

// 题目类型。
const (
	ProblemTypeStandard    = "standard"
	ProblemTypeSPJ         = "spj"
	ProblemTypeInteractive = "interactive"
	ProblemTypeOutputOnly  = "output_only"
)

// 题目状态。
const (
	ProblemStatusDraft     = "draft"
	ProblemStatusPublished = "published"
	ProblemStatusDisabled  = "disabled"
)

// ProblemTestCase 测试点 manifest 行：分值/编号稳定关联的权威来源。
// 数据文件为 {DataDir}/problems/{problemID}/tests/{ordinal}.in/.out。
type ProblemTestCase struct {
	ProblemID int64     `json:"problem_id"`
	Ordinal   int       `json:"ordinal"`
	Score     int       `json:"score"`
	SizeBytes int64     `json:"size_bytes"`
	InputSHA  string    `json:"input_sha"`
	OutputSHA string    `json:"output_sha"`
	UpdatedAt time.Time `json:"updated_at"`
}

// CaseResult 单个测试点的评测结果。
type CaseResult struct {
	CaseID   int    `json:"case_id"`
	Status   string `json:"status"`
	TimeMs   int    `json:"time_ms"`
	MemoryKb int    `json:"memory_kb"`
}

// Submission 提交记录。Code/CompileError/CaseResults 仅评测机与
// 详情接口使用；列表查询不会填充它们。
type Submission struct {
	ID           int64        `json:"id"`
	ProblemID    int64        `json:"problem_id"`
	ProblemTitle string       `json:"problem_title"`
	UserID       int64        `json:"user_id"`
	Username     string       `json:"username"`
	Language     string       `json:"language"`
	Code         string       `json:"code"`
	Status       string       `json:"status"`
	CompileError string       `json:"compile_error"`
	CaseResults  []CaseResult `json:"case_results"`
	TimeMs       int          `json:"time_ms"`
	MemoryKb     int          `json:"memory_kb"`
	// Optimize 是否开启 -O2 编译优化（C/C++）
	Optimize  bool       `json:"optimize"`
	CreatedAt time.Time  `json:"created_at"`
	JudgedAt  *time.Time `json:"judged_at"`
	// 比赛相关扩展（无比赛时为 nil/零值）
	ContestID  *int64 `json:"contest_id"`
	Score      int    `json:"score"`
	CaseScores []int  `json:"case_scores"`
	IsFrozen   bool   `json:"is_frozen"`
}

// 比赛模式。
const (
	ContestModeACM = "ACM"
	ContestModeOI  = "OI"
	ContestModeIOI = "IOI"
)

// 比赛可见性。
const (
	ContestVisibilityPublic  = "public"
	ContestVisibilityPrivate = "private"
)

// 比赛反馈模式。
const (
	FeedbackRealtime = "realtime"
	FeedbackBlind    = "blind"
)

// 计分模式。
const (
	ScoreModeAllOrNothing = "all_or_nothing"
	ScoreModePartial      = "partial"
)

// Contest 比赛。
type Contest struct {
	ID                    int64     `json:"id"`
	Title                 string    `json:"title"`
	Mode                  string    `json:"mode"`
	Feedback              string    `json:"feedback"`
	ScoreMode             string    `json:"score_mode"`
	PenaltyMinutes        int       `json:"penalty_minutes"`
	FreezeDurationMinutes int       `json:"freeze_duration_minutes"`
	RankKeys              []string  `json:"rank_keys"`
	StartTime             time.Time `json:"start_time"`
	EndTime               time.Time `json:"end_time"`
	// Description 比赛说明/公告（Markdown）
	Description string `json:"description"`
	// Visibility 可见性：public | private
	Visibility string `json:"visibility"`
	// RegStartTime/RegEndTime 报名时间窗；NULL = 随比赛时间窗
	RegStartTime *time.Time `json:"reg_start_time,omitempty"`
	RegEndTime   *time.Time `json:"reg_end_time,omitempty"`
	// SubmissionLimit 比赛默认单题提交上限（0 = 不限）
	SubmissionLimit int       `json:"submission_limit"`
	CreatedAt       time.Time `json:"created_at"`
}

// ContestProblem 比赛与题目的关联（含展示编号与排序）。
type ContestProblem struct {
	ContestID int64  `json:"contest_id"`
	ProblemID int64  `json:"problem_id"`
	DisplayID string `json:"display_id"`
	SortOrder int    `json:"sort_order"`
	// Score 单题分值覆盖（NULL = 用题目 manifest 总分）
	Score *int `json:"score"`
	// SubmissionLimit 单题提交上限覆盖（NULL = 继承比赛默认，0 = 不限）
	SubmissionLimit *int `json:"submission_limit"`
}

// ContestTeam 比赛参赛队伍（映射到用户）。
type ContestTeam struct {
	ContestID int64  `json:"contest_id"`
	TeamID    int64  `json:"team_id"`
	TeamName  string `json:"team_name"`
	Avatar    string `json:"avatar"` // data 目录下的相对路径，空 = 未上传
}

// IsFinal 判断状态是否为最终判定（非 pending/running）。
func IsFinal(status string) bool {
	switch status {
	case StatusPending, StatusRunning:
		return false
	default:
		return true
	}
}
