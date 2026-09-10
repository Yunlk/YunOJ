package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// SubmissionFilter 提交列表过滤条件，字段为 nil/空表示不过滤。
type SubmissionFilter struct {
	ProblemID      *int64
	UserID         *int64
	ContestID      *int64
	ExcludeContest bool
	Status         string
	// Language 按语言键过滤（如 cpp / python）。
	Language string
	// CreatedAfter / CreatedBefore 按提交时间过滤（闭区间下界、开区间上界）。
	CreatedAfter  *time.Time
	CreatedBefore *time.Time
	Page          int
	Size          int
}

// ListUserProblemStatuses 返回用户在指定题目上的简化状态。
// 已判定提交中只要有一次 AC 就记为 accepted，否则记为 wrong_answer；
// 没有已判定提交的题目不返回。盲评比赛在结束前不参与聚合，避免泄露结果。
func (s *Store) ListUserProblemStatuses(ctx context.Context, userID int64, problemIDs []int64) (map[int64]string, error) {
	statuses := make(map[int64]string, len(problemIDs))
	if userID <= 0 || len(problemIDs) == 0 {
		return statuses, nil
	}
	rows, err := s.pool.Query(ctx, `
		SELECT s.problem_id,
		       CASE WHEN bool_or(s.status = 'accepted') THEN 'accepted' ELSE 'wrong_answer' END AS my_status
		FROM submissions s
		LEFT JOIN contests c ON c.id = s.contest_id
		WHERE s.user_id = $1
		  AND s.problem_id = ANY($2)
		  AND s.judged_at IS NOT NULL
		  AND (s.contest_id IS NULL OR c.feedback <> 'blind' OR now() >= c.end_time)
		GROUP BY s.problem_id`, userID, problemIDs)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var problemID int64
		var status string
		if err := rows.Scan(&problemID, &status); err != nil {
			return nil, err
		}
		statuses[problemID] = status
	}
	return statuses, rows.Err()
}

const submissionListColumns = `s.id, s.problem_id, p.title, s.user_id, u.username,
	s.language, s.status, s.time_ms, s.wall_time_ms, s.memory_kb, s.score,
	s.pretest_only, s.system_tested, s.is_hacked, s.created_at`

func scanSubmissionList(row rowScanner) (model.Submission, error) {
	var sub model.Submission
	err := row.Scan(&sub.ID, &sub.ProblemID, &sub.ProblemTitle, &sub.UserID,
		&sub.Username, &sub.Language, &sub.Status, &sub.TimeMs, &sub.WallTimeMs, &sub.MemoryKb,
		&sub.Score, &sub.PretestOnly, &sub.SystemTested, &sub.IsHacked, &sub.CreatedAt)
	return sub, err
}

// CreateSubmission 创建提交记录（初始状态 pending）。
func (s *Store) CreateSubmission(ctx context.Context, problemID, userID int64, language, code string, optimize bool) (int64, error) {
	return s.CreateSubmissionFull(ctx, problemID, userID, language, code, optimize, nil)
}

// CreateSubmissionFull 创建提交记录，支持指定比赛上下文。
func (s *Store) CreateSubmissionFull(ctx context.Context, problemID, userID int64, language, code string, optimize bool, contestID *int64) (int64, error) {
	return s.CreateSubmissionContext(ctx, problemID, userID, language, code, optimize, contestID, nil)
}

// CreateSubmissionContext 创建带比赛/作业上下文的提交记录。
func (s *Store) CreateSubmissionContext(ctx context.Context, problemID, userID int64, language, code string, optimize bool, contestID, assignmentID *int64) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx,
		`INSERT INTO submissions (problem_id, user_id, language, code, optimize, contest_id, assignment_id)
		 VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
		problemID, userID, language, code, optimize, contestID, assignmentID,
	).Scan(&id)
	return id, err
}

// ListSubmissions 分页查询提交列表，附带题目标题与用户名。
func (s *Store) ListSubmissions(ctx context.Context, f SubmissionFilter) ([]model.Submission, int64, error) {
	conds := []string{}
	args := []any{}
	if f.ProblemID != nil {
		args = append(args, *f.ProblemID)
		conds = append(conds, fmt.Sprintf("s.problem_id = $%d", len(args)))
	}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		conds = append(conds, fmt.Sprintf("s.user_id = $%d", len(args)))
	}
	if f.ContestID != nil {
		args = append(args, *f.ContestID)
		conds = append(conds, fmt.Sprintf("s.contest_id = $%d", len(args)))
	}
	if f.ExcludeContest {
		conds = append(conds, "s.contest_id IS NULL")
	}
	if f.Status != "" {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("s.status = $%d", len(args)))
	}
	if f.Language != "" {
		args = append(args, f.Language)
		conds = append(conds, fmt.Sprintf("s.language = $%d", len(args)))
	}
	if f.CreatedAfter != nil {
		args = append(args, *f.CreatedAfter)
		conds = append(conds, fmt.Sprintf("s.created_at >= $%d", len(args)))
	}
	if f.CreatedBefore != nil {
		args = append(args, *f.CreatedBefore)
		conds = append(conds, fmt.Sprintf("s.created_at < $%d", len(args)))
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	var total int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM submissions s `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, f.Size, (f.Page-1)*f.Size)
	query := `SELECT ` + submissionListColumns + `
		FROM submissions s
		JOIN problems p ON p.id = s.problem_id
		JOIN users u ON u.id = s.user_id ` + where +
		fmt.Sprintf(` ORDER BY s.id DESC LIMIT $%d OFFSET $%d`, len(args)-1, len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.Submission, 0, f.Size)
	for rows.Next() {
		sub, err := scanSubmissionList(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, sub)
	}
	return items, total, rows.Err()
}

// GetSubmission 查询单条提交（含代码、编译错误、逐点结果与关联标题/用户名）。
func (s *Store) GetSubmission(ctx context.Context, id int64) (model.Submission, error) {
	var sub model.Submission
	var caseResults, caseScores []byte
	err := s.pool.QueryRow(ctx,
		`SELECT s.id, s.problem_id, p.title, s.user_id, u.username, s.language,
			s.code, s.status, s.compile_error, s.case_results,
			s.time_ms, s.wall_time_ms, s.memory_kb, s.optimize, s.contest_id, s.score,
			s.case_scores, s.is_frozen, s.pretest_only, s.system_tested, s.is_hacked,
			s.created_at, s.judged_at
		 FROM submissions s
		 JOIN problems p ON p.id = s.problem_id
		 JOIN users u ON u.id = s.user_id
		 WHERE s.id = $1`, id,
	).Scan(&sub.ID, &sub.ProblemID, &sub.ProblemTitle, &sub.UserID, &sub.Username,
		&sub.Language, &sub.Code, &sub.Status, &sub.CompileError, &caseResults,
		&sub.TimeMs, &sub.WallTimeMs, &sub.MemoryKb, &sub.Optimize, &sub.ContestID, &sub.Score,
		&caseScores, &sub.IsFrozen, &sub.PretestOnly, &sub.SystemTested, &sub.IsHacked,
		&sub.CreatedAt, &sub.JudgedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Submission{}, ErrNotFound
	}
	if err != nil {
		return model.Submission{}, err
	}
	if len(caseResults) > 0 {
		if err := json.Unmarshal(caseResults, &sub.CaseResults); err != nil {
			return model.Submission{}, err
		}
		for _, result := range sub.CaseResults {
			if result.TimeoutSource != "" {
				sub.TimeoutSource = result.TimeoutSource
				break
			}
		}
	}
	if len(caseScores) > 0 {
		if err := json.Unmarshal(caseScores, &sub.CaseScores); err != nil {
			return model.Submission{}, err
		}
	}
	return sub, nil
}

// SetRunning 将提交置为评测中。仅当提交仍处于 pending 时生效，
// 防止重复消费。
func (s *Store) SetRunning(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE submissions SET status = 'running' WHERE id = $1 AND status = 'pending'`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrConflict
	}
	return nil
}

// ClaimForJudge 原子领取待评测提交。attempt 是用于最终写回的 fencing token；
// claimed=false 表示任务已被其他节点领取，调用方应确认并丢弃重复队列消息。
func (s *Store) ClaimForJudge(ctx context.Context, id int64, nodeID, workerID string, lease time.Duration) (attempt int, claimed bool, err error) {
	seconds := int(lease.Seconds())
	if seconds < 60 {
		seconds = 60
	}
	err = s.pool.QueryRow(ctx, `
		UPDATE submissions SET
			status = 'running',
			judge_node_id = $2,
			judge_worker_id = $3,
			judge_started_at = now(),
			judge_lease_until = now() + ($4 * interval '1 second'),
			judge_attempt = judge_attempt + 1
		WHERE id = $1 AND status = 'pending'
		RETURNING judge_attempt`,
		id, nodeID, workerID, seconds).Scan(&attempt)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, false, nil
	}
	if err != nil {
		return 0, false, err
	}
	return attempt, true, nil
}

// IsFirstJudge 判断该提交此前是否已被评测过（重测不重复计数）。
func (s *Store) IsFirstJudge(ctx context.Context, id int64) (bool, error) {
	var first bool
	err := s.pool.QueryRow(ctx,
		`SELECT judged_at IS NULL FROM submissions WHERE id = $1`, id).Scan(&first)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	return first, err
}

// SetJudged 写入最终判定结果（无比赛计分）。
func (s *Store) SetJudged(ctx context.Context, id int64, status, compileError string,
	caseResults []model.CaseResult, timeMs, memoryKb int) error {
	return s.SetJudgedWithWall(ctx, id, status, compileError, caseResults, timeMs, 0, memoryKb)
}

// SetJudgedWithWall 写入最终判定结果，并保存墙钟耗时。
func (s *Store) SetJudgedWithWall(ctx context.Context, id int64, status, compileError string,
	caseResults []model.CaseResult, timeMs, wallTimeMs, memoryKb int) error {
	return s.setJudgedFull(ctx, id, status, compileError, caseResults, nil,
		timeMs, wallTimeMs, memoryKb, 0, false, "", "", 0, false)
}

// SetJudgedClaimed 仅允许当前评测租约写回结果。
func (s *Store) SetJudgedClaimed(ctx context.Context, id int64, nodeID, workerID string, attempt int,
	status, compileError string, caseResults []model.CaseResult, timeMs, memoryKb int) error {
	return s.SetJudgedClaimedWithWall(ctx, id, nodeID, workerID, attempt,
		status, compileError, caseResults, timeMs, 0, memoryKb)
}

// SetJudgedClaimedWithWall 仅允许当前评测租约写回结果，并保存墙钟耗时。
func (s *Store) SetJudgedClaimedWithWall(ctx context.Context, id int64, nodeID, workerID string, attempt int,
	status, compileError string, caseResults []model.CaseResult, timeMs, wallTimeMs, memoryKb int) error {
	return s.setJudgedFull(ctx, id, status, compileError, caseResults, nil,
		timeMs, wallTimeMs, memoryKb, 0, false, nodeID, workerID, attempt, true)
}

// SetJudgedFull 写入最终判定结果，支持比赛计分（逐点分数、总分与冻结标记）。
func (s *Store) SetJudgedFull(ctx context.Context, id int64, status, compileError string,
	caseResults []model.CaseResult, caseScores []int, timeMs, memoryKb, score int, isFrozen bool) error {
	return s.SetJudgedFullWithWall(ctx, id, status, compileError, caseResults, caseScores,
		timeMs, 0, memoryKb, score, isFrozen)
}

// SetJudgedFullWithWall 写入最终判定结果、比赛计分与墙钟耗时。
func (s *Store) SetJudgedFullWithWall(ctx context.Context, id int64, status, compileError string,
	caseResults []model.CaseResult, caseScores []int, timeMs, wallTimeMs, memoryKb, score int, isFrozen bool) error {
	return s.setJudgedFull(ctx, id, status, compileError, caseResults, caseScores,
		timeMs, wallTimeMs, memoryKb, score, isFrozen, "", "", 0, false)
}

// SetJudgedFullClaimed 是比赛提交的带租约最终写回。
func (s *Store) SetJudgedFullClaimed(ctx context.Context, id int64, nodeID, workerID string, attempt int,
	status, compileError string, caseResults []model.CaseResult, caseScores []int,
	timeMs, memoryKb, score int, isFrozen bool) error {
	return s.SetJudgedFullClaimedWithWall(ctx, id, nodeID, workerID, attempt,
		status, compileError, caseResults, caseScores, timeMs, 0, memoryKb, score, isFrozen)
}

// SetJudgedFullClaimedWithWall 是比赛提交的带租约最终写回，并保存墙钟耗时。
func (s *Store) SetJudgedFullClaimedWithWall(ctx context.Context, id int64, nodeID, workerID string, attempt int,
	status, compileError string, caseResults []model.CaseResult, caseScores []int,
	timeMs, wallTimeMs, memoryKb, score int, isFrozen bool) error {
	return s.setJudgedFull(ctx, id, status, compileError, caseResults, caseScores,
		timeMs, wallTimeMs, memoryKb, score, isFrozen, nodeID, workerID, attempt, true)
}

func (s *Store) setJudgedFull(ctx context.Context, id int64, status, compileError string,
	caseResults []model.CaseResult, caseScores []int, timeMs, wallTimeMs, memoryKb, score int, isFrozen bool,
	nodeID, workerID string, attempt int, requireLease bool) error {
	cr, err := json.Marshal(caseResults)
	if err != nil {
		return err
	}
	if caseScores == nil {
		caseScores = []int{}
	}
	cs, err := json.Marshal(caseScores)
	if err != nil {
		return err
	}
	query := `UPDATE submissions SET
			status = $2, compile_error = $3, case_results = $4::jsonb,
			time_ms = $5, wall_time_ms = $6, memory_kb = $7, score = $8, case_scores = $9::jsonb,
			is_frozen = $10, judged_at = now(), judge_lease_until = NULL
		 WHERE id = $1`
	args := []any{id, status, compileError, string(cr), timeMs, wallTimeMs, memoryKb, score, string(cs), isFrozen}
	if requireLease {
		query += ` AND status = 'running' AND judge_node_id = $11
			AND judge_worker_id = $12 AND judge_attempt = $13`
		args = append(args, nodeID, workerID, attempt)
	}
	ct, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		return err
	}
	if requireLease && ct.RowsAffected() == 0 {
		return ErrLeaseLost
	}
	return nil
}

// ResetForRejudge 将提交重置为待评测状态。
func (s *Store) ResetForRejudge(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE submissions SET
			status = 'pending', compile_error = '', case_results = '[]',
			time_ms = 0, wall_time_ms = 0, memory_kb = 0, judged_at = NULL,
			judge_node_id = NULL, judge_worker_id = NULL,
			judge_started_at = NULL, judge_lease_until = NULL
		 WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ResetRunningByIDs 将一批提交重置为待评测（评测机启动恢复时使用）。
func (s *Store) ResetRunningByIDs(ctx context.Context, ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	_, err := s.pool.Exec(ctx,
		`UPDATE submissions SET status = 'pending',
			judge_node_id = NULL, judge_worker_id = NULL,
			judge_started_at = NULL, judge_lease_until = NULL
		 WHERE id = ANY($1) AND status = 'running'`, ids)
	return err
}

// ---------- 预测试 / 系统测试 ----------

// SetSubmissionJudgePhase 记录本次判定所用阶段：是否只跑预测试、是否已完成系统测试。
func (s *Store) SetSubmissionJudgePhase(ctx context.Context, id int64, pretestOnly, systemTested bool) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE submissions SET pretest_only = $2, system_tested = $3, system_test_pending = false
		 WHERE id = $1`, id, pretestOnly, systemTested)
	return err
}

// ListSubmissionsNeedingSystemTest 找出需要赛后系统测试的提交：
// 比赛开启了 pretest_only、比赛已结束、提交此前只跑过预测试且尚未系统测试。
// 被 Hack 成功的提交判定已作废，不再重判（否则会把 Hack 结果「洗白」）。
func (s *Store) ListSubmissionsNeedingSystemTest(ctx context.Context, limit int) ([]int64, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := s.pool.Query(ctx, `
		SELECT s.id FROM submissions s
		JOIN contests c ON c.id = s.contest_id
		WHERE c.pretest_only
		  AND s.pretest_only
		  AND NOT s.system_tested
		  AND NOT s.is_hacked
		  AND s.judged_at IS NOT NULL
		  AND c.end_time < now()
		ORDER BY s.id
		LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

// PrepareSystemTest 把提交重置为待评测并标记为系统测试排队（用完整测试数据重判）。
// 被 Hack 成功的提交不在重判范围内。
func (s *Store) PrepareSystemTest(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE submissions SET
			status = 'pending', compile_error = '', case_results = '[]',
			time_ms = 0, wall_time_ms = 0, memory_kb = 0, judged_at = NULL,
			system_test_pending = true,
			judge_node_id = NULL, judge_worker_id = NULL,
			judge_started_at = NULL, judge_lease_until = NULL
		 WHERE id = $1 AND NOT system_tested AND NOT is_hacked`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// IsSystemTestPending 判断该提交是否为系统测试重判（需要跑完整测试数据）。
func (s *Store) IsSystemTestPending(ctx context.Context, id int64) (bool, error) {
	var pending bool
	err := s.pool.QueryRow(ctx,
		`SELECT system_test_pending FROM submissions WHERE id = $1`, id).Scan(&pending)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	return pending, err
}

// MarkSubmissionHacked 标记提交被 Hack 成功：判定降级（分数作废），保留被 Hack 标记。
func (s *Store) MarkSubmissionHacked(ctx context.Context, id int64, status string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE submissions SET is_hacked = true, status = $2, score = 0 WHERE id = $1`,
		id, status)
	return err
}
