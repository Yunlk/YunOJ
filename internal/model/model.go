// Package model 定义核心数据模型与判题状态常量。
package model

import "time"

// 判题状态。全部状态字符串集中定义于此，避免散落魔法字符串。
const (
	StatusPending             = "pending"               // 排队中
	StatusRunning             = "running"               // 评测中
	StatusAccepted            = "accepted"              // 通过
	StatusWrongAnswer         = "wrong_answer"          // 答案错误
	StatusPresentationError   = "presentation_error"    // 输出格式错误
	StatusTimeLimitExceeded   = "time_limit_exceeded"   // 超时
	StatusMemoryLimitExceeded = "memory_limit_exceeded" // 内存超限
	StatusOutputLimitExceeded = "output_limit_exceeded" // 输出超限
	StatusRuntimeError        = "runtime_error"         // 运行时错误
	StatusCompileError        = "compile_error"         // 编译错误
	StatusSystemError         = "system_error"          // 系统错误（沙箱/评测器故障）
	StatusNotRun              = "not_run"               // 系统错误导致后续测试点未运行
)

// 用户角色。
const (
	// RoleStudent 是普通学习者角色。RoleUser 保留为源码兼容别名，
	// 旧数据库会在迁移时统一改为 student。
	RoleStudent = "student"
	RoleUser    = RoleStudent
	RoleTeacher = "teacher"
	RoleAdmin   = "admin"
)

// User 用户。
type User struct {
	ID        int64     `json:"id"`
	Username  string    `json:"username"`
	Email     string    `json:"email"`
	Role      string    `json:"role"`
	Disabled  bool      `json:"disabled"`
	Avatar    string    `json:"avatar"`
	Rating    int       `json:"rating"`
	Rank      int       `json:"rank"`
	CreatedAt time.Time `json:"created_at"`
}

// IsStaff 判断用户是否具备教学/管理能力。
func IsStaff(role string) bool { return role == RoleTeacher || role == RoleAdmin }

// IsStudent 判断用户是否为普通学习者，兼容迁移前的 user 角色。
func IsStudent(role string) bool { return role == RoleStudent || role == "user" }

// Group 班级或团体。
type Group struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Description string    `json:"description"`
	OwnerID     int64     `json:"owner_id"`
	OwnerName   string    `json:"owner_name"`
	MemberCount int64     `json:"member_count"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
}

// GroupMember 班级成员。
type GroupMember struct {
	UserID   int64     `json:"user_id"`
	Username string    `json:"username"`
	Email    string    `json:"email"`
	Role     string    `json:"role"`
	JoinedAt time.Time `json:"joined_at"`
}

// Assignment 作业或测试。
type Assignment struct {
	ID           int64      `json:"id"`
	GroupID      int64      `json:"group_id"`
	Title        string     `json:"title"`
	Description  string     `json:"description"`
	Kind         string     `json:"kind"` // assignment | test
	CreatorID    int64      `json:"creator_id"`
	CreatorName  string     `json:"creator_name"`
	StartAt      time.Time  `json:"start_at"`
	DueAt        *time.Time `json:"due_at,omitempty"`
	Published    bool       `json:"published"`
	ProblemCount int64      `json:"problem_count"`
	CreatedAt    time.Time  `json:"created_at"`
	UpdatedAt    time.Time  `json:"updated_at"`
}

// AssignmentProblem 作业内的题目。
type AssignmentProblem struct {
	AssignmentID int64  `json:"assignment_id"`
	ProblemID    int64  `json:"problem_id"`
	Title        string `json:"title"`
	SortOrder    int    `json:"sort_order"`
	MaxScore     int    `json:"max_score"`
}

// AssignmentProgress 作业完成情况，按用户取最高分/是否通过。
type AssignmentProgress struct {
	UserID       int64  `json:"user_id"`
	Username     string `json:"username"`
	Solved       int64  `json:"solved"`
	ProblemCount int64  `json:"problem_count"`
	BestScore    int64  `json:"best_score"`
	TotalScore   int64  `json:"total_score"`
}

// HomeSummary 首页公开概览数据。
type HomeSummary struct {
	UserCount        int64         `json:"user_count"`
	ProblemCount     int64         `json:"problem_count"`
	ContestCount     int64         `json:"contest_count"`
	SubmissionCount  int64         `json:"submission_count"`
	GroupCount       int64         `json:"group_count"`
	AssignmentCount  int64         `json:"assignment_count"`
	ActiveContests   []Contest     `json:"active_contests"`
	UpcomingContests []Contest     `json:"upcoming_contests"`
	RecentProblems   []HomeProblem `json:"recent_problems"`
}

// HomeProblem 是首页公开题目摘要，避免把题面正文和评测器源码带到公开接口。
type HomeProblem struct {
	ID              int64     `json:"id"`
	Title           string    `json:"title"`
	Difficulty      int       `json:"difficulty"`
	Tags            []string  `json:"tags"`
	AcceptedCount   int64     `json:"accepted_count"`
	SubmissionCount int64     `json:"submission_count"`
	CreatedAt       time.Time `json:"created_at"`
	UpdatedAt       time.Time `json:"updated_at"`
}

// ProblemDiscussion 题目讨论。
type ProblemDiscussion struct {
	ID        int64     `json:"id"`
	ProblemID int64     `json:"problem_id"`
	UserID    int64     `json:"user_id"`
	Username  string    `json:"username"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// ProblemEditorial 官方题解。
type ProblemEditorial struct {
	ProblemID int64     `json:"problem_id"`
	Content   string    `json:"content"`
	UpdatedBy int64     `json:"updated_by"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Notification 全站或定向通知。
type Notification struct {
	ID          int64     `json:"id"`
	RecipientID *int64    `json:"recipient_id,omitempty"`
	AuthorID    int64     `json:"author_id"`
	AuthorName  string    `json:"author_name"`
	Kind        string    `json:"kind"`
	Title       string    `json:"title"`
	Content     string    `json:"content"`
	Read        bool      `json:"read"`
	CreatedAt   time.Time `json:"created_at"`
}

// UserContestSummary 用户参加过的比赛摘要。
type UserContestSummary struct {
	ID              int64     `json:"id"`
	Title           string    `json:"title"`
	Mode            string    `json:"mode"`
	SubmissionCount int64     `json:"submission_count"`
	LastSubmittedAt time.Time `json:"last_submitted_at"`
}

// UserActivityDay 某一天的提交活动数量。
type UserActivityDay struct {
	Date  string `json:"date"`
	Count int64  `json:"count"`
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

const (
	ContestRegistrationIndividual = "individual"
	ContestRegistrationTeam       = "team"
	ContestRegistrationBoth       = "both"
)

// ContestThemeColors 是题目气球/题目格使用的稳定主题色集合。
var ContestThemeColors = []string{"blue", "green", "orange", "purple", "cyan", "rose", "yellow", "indigo"}

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
	CoverImage  string `json:"cover_image"`
	// Visibility 可见性：public | private
	Visibility string `json:"visibility"`
	// RegStartTime/RegEndTime 报名时间窗；NULL = 随比赛时间窗
	RegStartTime *time.Time `json:"reg_start_time,omitempty"`
	RegEndTime   *time.Time `json:"reg_end_time,omitempty"`
	// SubmissionLimit 比赛默认单题提交上限（0 = 不限）
	SubmissionLimit  int       `json:"submission_limit"`
	RegistrationMode string    `json:"registration_mode"`
	MaxTeamSize      int       `json:"max_team_size"`
	AllowTeamEdit    bool      `json:"allow_team_edit"`
	CreatedAt        time.Time `json:"created_at"`
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
	SubmissionLimit *int   `json:"submission_limit"`
	ThemeColor      string `json:"theme_color"`
}

// ContestTeam 比赛参赛队伍（映射到用户）。
type ContestTeam struct {
	ContestID int64  `json:"contest_id"`
	TeamID    int64  `json:"team_id"`
	TeamName  string `json:"team_name"`
	Avatar    string `json:"avatar"` // data 目录下的相对路径，空 = 未上传
}

// ContestTeamMember 是队伍成员关系。TeamID 始终指向队长用户 ID。
type ContestTeamMember struct {
	ContestID int64     `json:"contest_id"`
	TeamID    int64     `json:"team_id"`
	UserID    int64     `json:"user_id"`
	Username  string    `json:"username"`
	IsCaptain bool      `json:"is_captain"`
	JoinedAt  time.Time `json:"joined_at"`
}

// ContestParticipant 比赛参赛者及其提交概览。
type ContestParticipant struct {
	ContestID       int64      `json:"contest_id"`
	TeamID          int64      `json:"team_id"`
	TeamName        string     `json:"team_name"`
	Username        string     `json:"username"`
	Avatar          string     `json:"avatar"`
	SubmissionCount int64      `json:"submission_count"`
	AcceptedCount   int64      `json:"accepted_count"`
	LastSubmittedAt *time.Time `json:"last_submitted_at,omitempty"`
	Members         []string   `json:"members"`
}

// ContestAnnouncement 比赛出题组广播。
type ContestAnnouncement struct {
	ID         int64     `json:"id"`
	ContestID  int64     `json:"contest_id"`
	AuthorID   int64     `json:"author_id"`
	AuthorName string    `json:"author_name"`
	Title      string    `json:"title"`
	Content    string    `json:"content"`
	Pinned     bool      `json:"pinned"`
	CreatedAt  time.Time `json:"created_at"`
	UpdatedAt  time.Time `json:"updated_at"`
}

// ContestQuestion 比赛题目答疑。未公开回答仅提问者与管理员可见。
type ContestQuestion struct {
	ID           int64      `json:"id"`
	ContestID    int64      `json:"contest_id"`
	AskerID      int64      `json:"asker_id"`
	AskerName    string     `json:"asker_name"`
	Content      string     `json:"content"`
	Answer       string     `json:"answer"`
	AnswererID   *int64     `json:"answerer_id,omitempty"`
	AnswererName string     `json:"answerer_name,omitempty"`
	Public       bool       `json:"public"`
	AskedAt      time.Time  `json:"asked_at"`
	AnsweredAt   *time.Time `json:"answered_at,omitempty"`
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
