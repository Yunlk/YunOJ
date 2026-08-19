package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// SubmissionFilter 提交列表过滤条件，字段为 nil/空表示不过滤。
type SubmissionFilter struct {
	ProblemID *int64
	UserID    *int64
	ContestID *int64
	Status    string
	Page      int
	Size      int
}

const submissionListColumns = `s.id, s.problem_id, p.title, s.user_id, u.username,
	s.language, s.status, s.time_ms, s.memory_kb, s.score, s.created_at`

func scanSubmissionList(row rowScanner) (model.Submission, error) {
	var sub model.Submission
	err := row.Scan(&sub.ID, &sub.ProblemID, &sub.ProblemTitle, &sub.UserID,
		&sub.Username, &sub.Language, &sub.Status, &sub.TimeMs, &sub.MemoryKb,
		&sub.Score, &sub.CreatedAt)
	return sub, err
}

// CreateSubmission 创建提交记录（初始状态 pending）。
func (s *Store) CreateSubmission(ctx context.Context, problemID, userID int64, language, code string, optimize bool) (int64, error) {
	return s.CreateSubmissionFull(ctx, problemID, userID, language, code, optimize, nil)
}

// CreateSubmissionFull 创建提交记录，支持指定比赛上下文。
func (s *Store) CreateSubmissionFull(ctx context.Context, problemID, userID int64, language, code string, optimize bool, contestID *int64) (int64, error) {
	var id int64
	err := s.pool.QueryRow(ctx,
		`INSERT INTO submissions (problem_id, user_id, language, code, optimize, contest_id)
		 VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
		problemID, userID, language, code, optimize, contestID,
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
	if f.Status != "" {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("s.status = $%d", len(args)))
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
			s.time_ms, s.memory_kb, s.optimize, s.contest_id, s.score,
			s.case_scores, s.is_frozen, s.created_at, s.judged_at
		 FROM submissions s
		 JOIN problems p ON p.id = s.problem_id
		 JOIN users u ON u.id = s.user_id
		 WHERE s.id = $1`, id,
	).Scan(&sub.ID, &sub.ProblemID, &sub.ProblemTitle, &sub.UserID, &sub.Username,
		&sub.Language, &sub.Code, &sub.Status, &sub.CompileError, &caseResults,
		&sub.TimeMs, &sub.MemoryKb, &sub.Optimize, &sub.ContestID, &sub.Score,
		&caseScores, &sub.IsFrozen, &sub.CreatedAt, &sub.JudgedAt)
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
	_, err := s.pool.Exec(ctx,
		`UPDATE submissions SET status = 'running' WHERE id = $1 AND status = 'pending'`, id)
	return err
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
	return s.SetJudgedFull(ctx, id, status, compileError, caseResults, nil,
		timeMs, memoryKb, 0, false)
}

// SetJudgedFull 写入最终判定结果，支持比赛计分（逐点分数、总分与冻结标记）。
func (s *Store) SetJudgedFull(ctx context.Context, id int64, status, compileError string,
	caseResults []model.CaseResult, caseScores []int, timeMs, memoryKb, score int, isFrozen bool) error {

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
	_, err = s.pool.Exec(ctx,
		`UPDATE submissions SET
			status = $2, compile_error = $3, case_results = $4::jsonb,
			time_ms = $5, memory_kb = $6, score = $7, case_scores = $8::jsonb,
			is_frozen = $9, judged_at = now()
		 WHERE id = $1`,
		id, status, compileError, string(cr), timeMs, memoryKb, score, string(cs), isFrozen)
	return err
}

// ResetForRejudge 将提交重置为待评测状态。
func (s *Store) ResetForRejudge(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE submissions SET
			status = 'pending', compile_error = '', case_results = '[]',
			time_ms = 0, memory_kb = 0, judged_at = NULL
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
		`UPDATE submissions SET status = 'pending' WHERE id = ANY($1)`, ids)
	return err
}
