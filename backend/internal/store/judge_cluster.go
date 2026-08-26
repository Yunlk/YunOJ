package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// SyncJudgeLanguages 同步服务端受信任语言清单，保留管理员设置的启停状态。
func (s *Store) SyncJudgeLanguages(ctx context.Context, languages []model.JudgeLanguageConfig) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	for _, language := range languages {
		if _, err := tx.Exec(ctx, `
			INSERT INTO judge_languages (key, name, version)
			VALUES ($1, $2, $3)
			ON CONFLICT (key) DO UPDATE SET
				name = EXCLUDED.name,
				version = EXCLUDED.version,
				updated_at = now()`,
			language.Key, language.Name, language.Version); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

func (s *Store) ListJudgeLanguages(ctx context.Context) ([]model.JudgeLanguageConfig, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT key, name, version, enabled, updated_at
		FROM judge_languages ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.JudgeLanguageConfig{}
	for rows.Next() {
		var item model.JudgeLanguageConfig
		if err := rows.Scan(&item.Key, &item.Name, &item.Version, &item.Enabled, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) IsJudgeLanguageEnabled(ctx context.Context, key string) (bool, error) {
	var enabled bool
	err := s.pool.QueryRow(ctx,
		`SELECT enabled FROM judge_languages WHERE key = $1`, key).Scan(&enabled)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	return enabled, err
}

func (s *Store) SetJudgeLanguageEnabled(ctx context.Context, key string, enabled bool) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE judge_languages SET enabled = $2, updated_at = now() WHERE key = $1`,
		key, enabled)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// HeartbeatJudgeNode 注册或刷新节点，并返回管理员配置的目标状态。
func (s *Store) HeartbeatJudgeNode(ctx context.Context, node model.JudgeNode, initialConcurrency int) (model.JudgeNode, error) {
	languages, err := json.Marshal(node.Languages)
	if err != nil {
		return model.JudgeNode{}, err
	}
	if initialConcurrency < 0 {
		initialConcurrency = 0
	}
	var rawLanguages []byte
	err = s.pool.QueryRow(ctx, `
		INSERT INTO judge_nodes (
			node_id, display_name, hostname, version, desired_concurrency,
			actual_concurrency, languages, last_heartbeat
		) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, now())
		ON CONFLICT (node_id) DO UPDATE SET
			hostname = EXCLUDED.hostname,
			version = EXCLUDED.version,
			actual_concurrency = EXCLUDED.actual_concurrency,
			languages = EXCLUDED.languages,
			last_heartbeat = now(),
			updated_at = now()
		RETURNING node_id, display_name, hostname, version, enabled,
			desired_concurrency, actual_concurrency, languages,
			last_heartbeat, created_at, updated_at`,
		node.NodeID, node.DisplayName, node.Hostname, node.Version, initialConcurrency,
		node.ActualConcurrency, string(languages),
	).Scan(&node.NodeID, &node.DisplayName, &node.Hostname, &node.Version, &node.Enabled,
		&node.DesiredConcurrency, &node.ActualConcurrency, &rawLanguages,
		&node.LastHeartbeat, &node.CreatedAt, &node.UpdatedAt)
	if err != nil {
		return model.JudgeNode{}, err
	}
	if err := json.Unmarshal(rawLanguages, &node.Languages); err != nil {
		return model.JudgeNode{}, err
	}
	return node, nil
}

func (s *Store) ListJudgeNodes(ctx context.Context) ([]model.JudgeNode, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT node_id, display_name, hostname, version, enabled,
			desired_concurrency, actual_concurrency, languages,
			last_heartbeat, created_at, updated_at
		FROM judge_nodes ORDER BY display_name, node_id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.JudgeNode{}
	for rows.Next() {
		var item model.JudgeNode
		var rawLanguages []byte
		if err := rows.Scan(&item.NodeID, &item.DisplayName, &item.Hostname, &item.Version,
			&item.Enabled, &item.DesiredConcurrency, &item.ActualConcurrency, &rawLanguages,
			&item.LastHeartbeat, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		if err := json.Unmarshal(rawLanguages, &item.Languages); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) UpdateJudgeNode(ctx context.Context, nodeID string, displayName *string, enabled *bool, concurrency *int) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE judge_nodes SET
			display_name = COALESCE($2, display_name),
			enabled = COALESCE($3, enabled),
			desired_concurrency = COALESCE($4, desired_concurrency),
			updated_at = now()
		WHERE node_id = $1`, nodeID, displayName, enabled, concurrency)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

func (s *Store) AddJudgeAuditLog(ctx context.Context, actorID int64, action, target, detail string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO judge_audit_logs (actor_id, action, target, detail)
		VALUES ($1, $2, $3, $4)`, actorID, action, target, detail)
	return err
}

func (s *Store) ListJudgeAuditLogs(ctx context.Context, limit int) ([]model.JudgeAuditLog, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT l.id, l.actor_id, COALESCE(u.username, ''), l.action, l.target, l.detail, l.created_at
		FROM judge_audit_logs l
		LEFT JOIN users u ON u.id = l.actor_id
		ORDER BY l.id DESC LIMIT $1`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.JudgeAuditLog{}
	for rows.Next() {
		var item model.JudgeAuditLog
		if err := rows.Scan(&item.ID, &item.ActorID, &item.ActorName, &item.Action,
			&item.Target, &item.Detail, &item.CreatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
