package store

import (
	"context"
	"encoding/json"
	"errors"
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
		&p.CreatedAt, &p.UpdatedAt)
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
	testcase_scores, submission_limit, created_at, updated_at`

// ListProblems 分页列出题目，支持按标题模糊搜索（keyword 为空则不过滤）。
func (s *Store) ListProblems(ctx context.Context, keyword string, page, size int) ([]model.Problem, int64, error) {
	where := ""
	args := []any{}
	if keyword != "" {
		args = append(args, "%"+strings.ToLower(keyword)+"%")
		where = "WHERE title ILIKE $1"
	}

	var total int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM problems `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	args = append(args, size, (page-1)*size)
	query := `SELECT ` + problemColumns + ` FROM problems ` + where + ` ORDER BY id LIMIT $` +
		strconv.Itoa(len(args)-1) + ` OFFSET $` + strconv.Itoa(len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.Problem, 0, size)
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
			type, spj_source, interactor_source, testcase_scores, submission_limit)
		 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
			$11, $12, $13, $14::jsonb, $15)
		 RETURNING id, created_at, updated_at`,
		p.Title, p.Statement, p.InputFormat, p.OutputFormat, p.Hint,
		string(samples), p.TimeLimitMs, p.MemoryLimitKb, p.Difficulty, p.Tags,
		p.Type, p.SPJSource, p.InteractorSource, string(scores), p.SubmissionLimit,
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
			submission_limit = $16, updated_at = now()
		 WHERE id = $1`,
		p.ID, p.Title, p.Statement, p.InputFormat, p.OutputFormat, p.Hint,
		string(samples), p.TimeLimitMs, p.MemoryLimitKb, p.Difficulty, p.Tags,
		p.Type, p.SPJSource, p.InteractorSource, string(scores), p.SubmissionLimit,
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
