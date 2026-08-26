package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// rowScanner 抽象 QueryRow 与 Rows 共有的 Scan 接口。
type rowScanner interface {
	Scan(dest ...any) error
}

// scanProblem 从一行结果中扫描出题目（samples/testcase_scores 为 JSONB 列）。
func scanProblem(row rowScanner) (model.Problem, error) {
	var p model.Problem
	var samples, scores []byte
	err := row.Scan(&p.ID, &p.Title, &p.Statement, &p.InputFormat, &p.OutputFormat,
		&p.Hint, &samples, &p.TimeLimitMs, &p.MemoryLimitKb, &p.Difficulty,
		&p.Tags, &p.AcceptedCount, &p.SubmissionCount,
		&p.Type, &p.SPJSource, &p.InteractorSource, &scores, &p.SubmissionLimit,
		&p.Status, &p.TestcaseCount, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return model.Problem{}, err
	}
	if len(samples) > 0 {
		if err := json.Unmarshal(samples, &p.Samples); err != nil {
			return model.Problem{}, err
		}
	}
	if len(scores) > 0 {
		if err := json.Unmarshal(scores, &p.TestcaseScores); err != nil {
			return model.Problem{}, err
		}
	}
	return p, nil
}

const problemColumns = `id, title, statement, input_format, output_format,
	hint, samples, time_limit_ms, memory_limit_kb, difficulty, tags,
	accepted_count, submission_count, type, spj_source, interactor_source,
	testcase_scores, submission_limit, status,
	(SELECT count(*) FROM problem_testcases pt WHERE pt.problem_id = problems.id) AS testcase_count,
	created_at, updated_at`

// ProblemFilter 题目列表过滤条件。字段为 nil/空表示不过滤。
type ProblemFilter struct {
	Keyword            string
	Difficulty         *int
	Tag                string
	Type               string
	Status             string
	IncludeUnpublished bool // 是否包含未发布（draft/disabled）题目（管理员列表用）
	Page               int
	Size               int
}

// ListProblems 分页列出题目，支持标题/难度/标签/题型/状态过滤。
// 默认仅返回 published；IncludeUnpublished=true 时返回全部状态。
func (s *Store) ListProblems(ctx context.Context, f ProblemFilter) ([]model.Problem, int64, error) {
	conds := []string{}
	args := []any{}
	if f.Keyword != "" {
		args = append(args, "%"+strings.ToLower(f.Keyword)+"%")
		conds = append(conds, fmt.Sprintf("title ILIKE $%d", len(args)))
	}
	if f.Difficulty != nil {
		args = append(args, *f.Difficulty)
		conds = append(conds, fmt.Sprintf("difficulty = $%d", len(args)))
	}
	if f.Tag != "" {
		args = append(args, f.Tag)
		conds = append(conds, fmt.Sprintf("$%d = ANY(tags)", len(args)))
	}
	if f.Type != "" {
		args = append(args, f.Type)
		conds = append(conds, fmt.Sprintf("type = $%d", len(args)))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("status = $%d", len(args)))
	}
	if !f.IncludeUnpublished {
		conds = append(conds, "status = 'published'")
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	var total int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM problems `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, f.Size, (f.Page-1)*f.Size)
	query := `SELECT ` + problemColumns + ` FROM problems ` + where + ` ORDER BY id LIMIT $` +
		strconv.Itoa(len(args)-1) + ` OFFSET $` + strconv.Itoa(len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.Problem, 0, f.Size)
	for rows.Next() {
		p, err := scanProblem(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, p)
	}
	return items, total, rows.Err()
}

// GetProblem 按 ID 查询题目。
func (s *Store) GetProblem(ctx context.Context, id int64) (model.Problem, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+problemColumns+` FROM problems WHERE id = $1`, id)
	p, err := scanProblem(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Problem{}, ErrNotFound
	}
	return p, err
}

// CreateProblem 创建题目，成功后填充 ID/CreatedAt/UpdatedAt。
func (s *Store) CreateProblem(ctx context.Context, p *model.Problem) error {
	samples, err := json.Marshal(p.Samples)
	if err != nil {
		return err
	}
	scores, err := json.Marshal(p.TestcaseScores)
	if err != nil {
		return err
	}
	return s.pool.QueryRow(ctx,
		`INSERT INTO problems (title, statement, input_format, output_format, hint,
			samples, time_limit_ms, memory_limit_kb, difficulty, tags,
			type, spj_source, interactor_source, testcase_scores, submission_limit, status)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
			$11, $12, $13, $14::jsonb, $15, $16)
		 RETURNING id, created_at, updated_at`,
		p.Title, p.Statement, p.InputFormat, p.OutputFormat, p.Hint,
		string(samples), p.TimeLimitMs, p.MemoryLimitKb, p.Difficulty, p.Tags,
		p.Type, p.SPJSource, p.InteractorSource, string(scores), p.SubmissionLimit,
		p.Status,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

// UpdateProblem 全量更新题目。题目不存在时返回 ErrNotFound。
func (s *Store) UpdateProblem(ctx context.Context, p *model.Problem) error {
	samples, err := json.Marshal(p.Samples)
	if err != nil {
		return err
	}
	scores, err := json.Marshal(p.TestcaseScores)
	if err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx,
		`UPDATE problems SET
			title = $2, statement = $3, input_format = $4, output_format = $5,
			hint = $6, samples = $7::jsonb, time_limit_ms = $8, memory_limit_kb = $9,
			difficulty = $10, tags = $11, type = $12, spj_source = $13,
			interactor_source = $14, testcase_scores = $15::jsonb,
			submission_limit = $16, status = $17, updated_at = now()
		 WHERE id = $1`,
		p.ID, p.Title, p.Statement, p.InputFormat, p.OutputFormat, p.Hint,
		string(samples), p.TimeLimitMs, p.MemoryLimitKb, p.Difficulty, p.Tags,
		p.Type, p.SPJSource, p.InteractorSource, string(scores), p.SubmissionLimit,
		p.Status,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteProblem 删除题目（级联删除其提交记录）。
func (s *Store) DeleteProblem(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM problems WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddSubmission 更新题目的提交/通过计数。仅在首次评测时调用，
// 重测不会重复计数。
func (s *Store) AddSubmission(ctx context.Context, problemID int64, accepted bool) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE problems SET
			submission_count = submission_count + 1,
			accepted_count = accepted_count + CASE WHEN $2 THEN 1 ELSE 0 END
		 WHERE id = $1`, problemID, accepted)
	return err
}

// UpdateProblemStatus 仅更新题目状态（草稿/发布/停用）。
func (s *Store) UpdateProblemStatus(ctx context.Context, id int64, status string) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE problems SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ContestRef 引用题目的比赛信息（删除题目前的影响范围提示）。
type ContestRef struct {
	ContestID int64
	Title     string
}

// ProblemUsage 统计题目的引用情况：被哪些比赛引用、有多少提交。
func (s *Store) ProblemUsage(ctx context.Context, problemID int64) ([]ContestRef, int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT c.id, c.title FROM contest_problems cp
		 JOIN contests c ON c.id = cp.contest_id
		 WHERE cp.problem_id = $1 ORDER BY c.id`, problemID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	refs := []ContestRef{}
	for rows.Next() {
		var r ContestRef
		if err := rows.Scan(&r.ContestID, &r.Title); err != nil {
			return nil, 0, err
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var subs int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM submissions WHERE problem_id = $1`, problemID).Scan(&subs); err != nil {
		return nil, 0, err
	}
	return refs, subs, nil
}
