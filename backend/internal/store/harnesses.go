package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// 函数题（problem_harnesses）的读写。
//
// 约定：一道函数题允许只配一部分语言的模板，未配模板的语言不能提交
// （判题侧会返回明确原因，见 judge 包的 harnessSource）。

// ListProblemHarnesses 列出某题的全部语言模板（按语言键排序，便于稳定展示）。
func (s *Store) ListProblemHarnesses(ctx context.Context, problemID int64) ([]model.ProblemHarness, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT problem_id, language, template, initial_code, updated_at
		FROM problem_harnesses
		WHERE problem_id = $1
		ORDER BY language`, problemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.ProblemHarness, 0, 4)
	for rows.Next() {
		var h model.ProblemHarness
		if err := rows.Scan(&h.ProblemID, &h.Language, &h.Template, &h.InitialCode, &h.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}

// GetProblemHarness 取某题某种语言的模板；不存在返回 ErrNotFound。
func (s *Store) GetProblemHarness(ctx context.Context, problemID int64, language string) (model.ProblemHarness, error) {
	var h model.ProblemHarness
	err := s.pool.QueryRow(ctx, `
		SELECT problem_id, language, template, initial_code, updated_at
		FROM problem_harnesses
		WHERE problem_id = $1 AND language = $2`, problemID, language).
		Scan(&h.ProblemID, &h.Language, &h.Template, &h.InitialCode, &h.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ProblemHarness{}, ErrNotFound
	}
	return h, err
}

// ReplaceProblemHarnesses 全量替换某题的语言模板（事务内先删后插）。
// 传空切片表示该题不再是函数题 / 清空全部语言模板。
func (s *Store) ReplaceProblemHarnesses(ctx context.Context, problemID int64, harnesses []model.ProblemHarness) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx, `DELETE FROM problem_harnesses WHERE problem_id = $1`, problemID); err != nil {
		return err
	}
	for i := range harnesses {
		h := &harnesses[i]
		if _, err := tx.Exec(ctx, `
			INSERT INTO problem_harnesses (problem_id, language, template, initial_code)
			VALUES ($1, $2, $3, $4)`,
			problemID, h.Language, h.Template, h.InitialCode); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// CopyProblemHarnesses 复制题目时把语言模板一并带过去。
func (s *Store) CopyProblemHarnesses(ctx context.Context, fromProblemID, toProblemID int64) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO problem_harnesses (problem_id, language, template, initial_code)
		SELECT $2, language, template, initial_code
		FROM problem_harnesses
		WHERE problem_id = $1
		ON CONFLICT (problem_id, language) DO NOTHING`, fromProblemID, toProblemID)
	return err
}
