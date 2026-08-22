package store

import (
	"context"
	"fmt"
)

// JudgeStatusCounts 评测任务状态计数。
func (s *Store) JudgeStatusCounts(ctx context.Context) (map[string]int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT status, count(*) FROM submissions GROUP BY status`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	counts := map[string]int64{}
	for rows.Next() {
		var status string
		var n int64
		if err := rows.Scan(&status, &n); err != nil {
			return nil, err
		}
		counts[status] = n
	}
	return counts, rows.Err()
}

// ResetStaleRunning 将超过指定时间仍运行中的提交放回待评测状态。
func (s *Store) ResetStaleRunning(ctx context.Context, ageSeconds int) ([]int64, error) {
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		UPDATE submissions SET status = 'pending', compile_error = '', case_results = '[]',
			time_ms = 0, memory_kb = 0, judged_at = NULL
		WHERE status = 'running' AND created_at < now() - interval '%d seconds'
		RETURNING id`, ageSeconds))
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

// ListPendingSubmissionIDs 返回待评测提交 ID，限制数量避免后台误操作造成大批量入队。
func (s *Store) ListPendingSubmissionIDs(ctx context.Context, limit int) ([]int64, error) {
	rows, err := s.pool.Query(ctx, `SELECT id FROM submissions WHERE status = 'pending' ORDER BY id LIMIT $1`, limit)
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
