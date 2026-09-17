package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

const attachmentColumns = `a.id, a.problem_id, a.filename, a.content_type, a.size_bytes,
	a.storage_path, a.uploaded_by, COALESCE(u.username, ''), a.created_at`

// ListProblemAttachments 列出某题的全部附件（按上传顺序）。
func (s *Store) ListProblemAttachments(ctx context.Context, problemID int64) ([]model.ProblemAttachment, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT `+attachmentColumns+`
		FROM problem_attachments a
		LEFT JOIN users u ON u.id = a.uploaded_by
		WHERE a.problem_id = $1
		ORDER BY a.id`, problemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := make([]model.ProblemAttachment, 0, 4)
	for rows.Next() {
		var a model.ProblemAttachment
		if err := rows.Scan(&a.ID, &a.ProblemID, &a.Filename, &a.ContentType, &a.SizeBytes,
			&a.StoragePath, &a.UploadedBy, &a.Uploader, &a.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	return items, rows.Err()
}

// GetProblemAttachment 取单个附件（下载/删除前需要 storage_path）。
func (s *Store) GetProblemAttachment(ctx context.Context, problemID, id int64) (model.ProblemAttachment, error) {
	var a model.ProblemAttachment
	err := s.pool.QueryRow(ctx, `
		SELECT `+attachmentColumns+`
		FROM problem_attachments a
		LEFT JOIN users u ON u.id = a.uploaded_by
		WHERE a.problem_id = $1 AND a.id = $2`, problemID, id,
	).Scan(&a.ID, &a.ProblemID, &a.Filename, &a.ContentType, &a.SizeBytes,
		&a.StoragePath, &a.UploadedBy, &a.Uploader, &a.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ProblemAttachment{}, ErrNotFound
	}
	return a, err
}

// CountProblemAttachments 统计某题已有附件数量（上传上限校验用）。
func (s *Store) CountProblemAttachments(ctx context.Context, problemID int64) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM problem_attachments WHERE problem_id = $1`, problemID).Scan(&n)
	return n, err
}

// CreateProblemAttachment 写入附件元数据，成功后填充 ID/CreatedAt。
func (s *Store) CreateProblemAttachment(ctx context.Context, a *model.ProblemAttachment) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO problem_attachments (problem_id, filename, content_type, size_bytes, storage_path, uploaded_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, created_at`,
		a.ProblemID, a.Filename, a.ContentType, a.SizeBytes, a.StoragePath, a.UploadedBy,
	).Scan(&a.ID, &a.CreatedAt)
}

// DeleteProblemAttachment 删除附件元数据并返回被删记录（调用方负责删文件）。
func (s *Store) DeleteProblemAttachment(ctx context.Context, problemID, id int64) (model.ProblemAttachment, error) {
	a, err := s.GetProblemAttachment(ctx, problemID, id)
	if err != nil {
		return model.ProblemAttachment{}, err
	}
	if _, err := s.pool.Exec(ctx,
		`DELETE FROM problem_attachments WHERE problem_id = $1 AND id = $2`, problemID, id); err != nil {
		return model.ProblemAttachment{}, err
	}
	return a, nil
}
