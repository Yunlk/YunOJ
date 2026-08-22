package store

import (
	"context"
	"errors"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// ToggleProblemFavorite 切换用户收藏，返回切换后的状态。
func (s *Store) ToggleProblemFavorite(ctx context.Context, userID, problemID int64) (bool, error) {
	var exists bool
	if err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM problem_favorites WHERE user_id = $1 AND problem_id = $2)`, userID, problemID).Scan(&exists); err != nil {
		return false, err
	}
	if exists {
		_, err := s.pool.Exec(ctx, `DELETE FROM problem_favorites WHERE user_id = $1 AND problem_id = $2`, userID, problemID)
		return false, err
	}
	_, err := s.pool.Exec(ctx, `INSERT INTO problem_favorites (user_id, problem_id) VALUES ($1, $2)`, userID, problemID)
	return true, err
}

// IsProblemFavorite 判断用户是否收藏题目。
func (s *Store) IsProblemFavorite(ctx context.Context, userID, problemID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM problem_favorites WHERE user_id = $1 AND problem_id = $2)`, userID, problemID).Scan(&exists)
	return exists, err
}

// ListFavoriteProblems 返回用户收藏题目。
func (s *Store) ListFavoriteProblems(ctx context.Context, userID int64) ([]model.HomeProblem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT p.id, p.title, p.difficulty, p.tags, p.accepted_count, p.submission_count,
		       p.created_at, p.updated_at
		FROM problem_favorites f JOIN problems p ON p.id = f.problem_id
		WHERE f.user_id = $1 AND p.status = 'published'
		ORDER BY f.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.HomeProblem{}
	for rows.Next() {
		var item model.HomeProblem
		if err := rows.Scan(&item.ID, &item.Title, &item.Difficulty, &item.Tags,
			&item.AcceptedCount, &item.SubmissionCount, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListProblemDiscussions 返回题目讨论。
func (s *Store) ListProblemDiscussions(ctx context.Context, problemID int64) ([]model.ProblemDiscussion, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT d.id, d.problem_id, d.user_id, u.username, d.content, d.created_at, d.updated_at
		FROM problem_discussions d JOIN users u ON u.id = d.user_id
		WHERE d.problem_id = $1 ORDER BY d.created_at DESC`, problemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ProblemDiscussion{}
	for rows.Next() {
		var item model.ProblemDiscussion
		if err := rows.Scan(&item.ID, &item.ProblemID, &item.UserID, &item.Username, &item.Content,
			&item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// CreateProblemDiscussion 创建一条讨论。
func (s *Store) CreateProblemDiscussion(ctx context.Context, item *model.ProblemDiscussion) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO problem_discussions (problem_id, user_id, content) VALUES ($1, $2, $3)
		RETURNING id, created_at, updated_at`, item.ProblemID, item.UserID, item.Content).
		Scan(&item.ID, &item.CreatedAt, &item.UpdatedAt)
}

// DeleteProblemDiscussion 删除自己的讨论或管理员删除讨论。
func (s *Store) DeleteProblemDiscussion(ctx context.Context, id, userID int64, admin bool) error {
	query := `DELETE FROM problem_discussions WHERE id = $1 AND user_id = $2`
	args := []any{id, userID}
	if admin {
		query = `DELETE FROM problem_discussions WHERE id = $1`
		args = []any{id}
	}
	ct, err := s.pool.Exec(ctx, query, args...)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetProblemEditorial 获取官方题解。
func (s *Store) GetProblemEditorial(ctx context.Context, problemID int64) (model.ProblemEditorial, error) {
	var item model.ProblemEditorial
	err := s.pool.QueryRow(ctx, `SELECT problem_id, content, updated_by, updated_at FROM problem_editorials WHERE problem_id = $1`, problemID).
		Scan(&item.ProblemID, &item.Content, &item.UpdatedBy, &item.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ProblemEditorial{}, ErrNotFound
	}
	return item, err
}

// UpsertProblemEditorial 保存官方题解。
func (s *Store) UpsertProblemEditorial(ctx context.Context, problemID, userID int64, content string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO problem_editorials (problem_id, content, updated_by)
		VALUES ($1, $2, $3)
		ON CONFLICT (problem_id) DO UPDATE SET content = EXCLUDED.content, updated_by = EXCLUDED.updated_by, updated_at = now()`, problemID, content, userID)
	return err
}

// ValidateDiscussionContent 校验讨论内容。
func ValidateDiscussionContent(content string) string {
	if strings.TrimSpace(content) == "" {
		return "讨论内容不能为空"
	}
	if len(content) > 16<<10 {
		return "讨论内容过长（最大 16KB）"
	}
	return ""
}
