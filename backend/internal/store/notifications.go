package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// CreateNotification 创建全站或定向通知。
func (s *Store) CreateNotification(ctx context.Context, item *model.Notification) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO notifications (recipient_id, author_id, kind, title, content)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at`, item.RecipientID, item.AuthorID, item.Kind, item.Title, item.Content).
		Scan(&item.ID, &item.CreatedAt)
}

// ListNotifications 返回用户可见通知，公共通知和定向通知都会返回。
func (s *Store) ListNotifications(ctx context.Context, userID int64, limit int) ([]model.Notification, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT n.id, n.recipient_id, n.author_id, COALESCE(u.username, ''), n.kind, n.title, n.content,
		       EXISTS (SELECT 1 FROM notification_reads nr WHERE nr.notification_id = n.id AND nr.user_id = $1), n.created_at
		FROM notifications n LEFT JOIN users u ON u.id = n.author_id
		WHERE n.recipient_id IS NULL OR n.recipient_id = $1
		ORDER BY n.created_at DESC LIMIT $2`, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Notification{}
	for rows.Next() {
		var item model.Notification
		if err := rows.Scan(&item.ID, &item.RecipientID, &item.AuthorID, &item.AuthorName,
			&item.Kind, &item.Title, &item.Content, &item.Read, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// MarkNotificationRead 标记用户已读。
func (s *Store) MarkNotificationRead(ctx context.Context, userID, notificationID int64) error {
	var visible bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM notifications WHERE id = $1 AND (recipient_id IS NULL OR recipient_id = $2))`, notificationID, userID).Scan(&visible)
	if err != nil {
		return err
	}
	if !visible {
		return ErrNotFound
	}
	_, err = s.pool.Exec(ctx, `INSERT INTO notification_reads (notification_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, notificationID, userID)
	return err
}

// GetNotification 检查通知是否存在。
func (s *Store) GetNotification(ctx context.Context, id int64) (model.Notification, error) {
	var item model.Notification
	err := s.pool.QueryRow(ctx, `SELECT id, recipient_id, author_id, kind, title, content, created_at FROM notifications WHERE id = $1`, id).
		Scan(&item.ID, &item.RecipientID, &item.AuthorID, &item.Kind, &item.Title, &item.Content, &item.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Notification{}, ErrNotFound
	}
	return item, err
}
