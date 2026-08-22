package store

import (
	"context"
	"sort"

	"github.com/yunoj/yunoj/internal/model"
)

// ListRankingEntries 从最终提交实时生成全站训练排名。
// 同一用户对同一题只计一次尝试/解决；系统错误和未完成评测不参与统计。
func (s *Store) ListRankingEntries(ctx context.Context) ([]model.RankingEntry, error) {
	rows, err := s.pool.Query(ctx, `
		WITH final_attempts AS (
			SELECT user_id, problem_id, bool_or(status = 'accepted') AS solved
			FROM submissions
			WHERE status NOT IN ('pending', 'running', 'system_error', 'not_run')
			GROUP BY user_id, problem_id
		), user_stats AS (
			SELECT fa.user_id,
				count(*) AS attempted,
				count(*) FILTER (WHERE fa.solved) AS solved,
				coalesce(sum(CASE WHEN fa.solved THEN CASE p.difficulty
					WHEN 1 THEN 1.0 WHEN 2 THEN 1.2 WHEN 3 THEN 1.5
					WHEN 4 THEN 1.8 WHEN 5 THEN 2.2 WHEN 6 THEN 2.7
					WHEN 7 THEN 3.3 WHEN 8 THEN 4.0 WHEN 9 THEN 5.0
					ELSE 0 END ELSE 0 END), 0)::double precision AS weighted_solved
			FROM final_attempts fa
			JOIN problems p ON p.id = fa.problem_id
			GROUP BY fa.user_id
		), first_accept_times AS (
			SELECT contest_id, problem_id, min(created_at) AS accepted_at
			FROM submissions
			WHERE contest_id IS NOT NULL AND status = 'accepted'
			GROUP BY contest_id, problem_id
		), first_blood_stats AS (
			SELECT s.user_id, count(DISTINCT (s.contest_id, s.problem_id)) AS first_bloods
			FROM submissions s
			JOIN first_accept_times f ON f.contest_id = s.contest_id
				AND f.problem_id = s.problem_id AND f.accepted_at = s.created_at
			WHERE s.status = 'accepted'
			GROUP BY s.user_id
		), last_accepts AS (
			SELECT user_id, max(created_at) AS last_accepted_at
			FROM submissions WHERE status = 'accepted' GROUP BY user_id
		)
		SELECT u.id, u.username, u.avatar, us.solved, us.attempted,
			us.weighted_solved, coalesce(fb.first_bloods, 0), la.last_accepted_at
		FROM users u
		JOIN user_stats us ON us.user_id = u.id
		LEFT JOIN first_blood_stats fb ON fb.user_id = u.id
		LEFT JOIN last_accepts la ON la.user_id = u.id
		WHERE u.role IN ('student', 'user') AND u.disabled = false`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	entries := []model.RankingEntry{}
	for rows.Next() {
		var item model.RankingEntry
		if err := rows.Scan(&item.UserID, &item.Username, &item.Avatar,
			&item.SolvedProblems, &item.AttemptedProblems, &item.WeightedSolved,
			&item.FirstBloods, &item.LastAcceptedAt); err != nil {
			return nil, err
		}
		if item.AttemptedProblems > 0 {
			item.AcceptanceRate = float64(item.SolvedProblems) / float64(item.AttemptedProblems)
		}
		item.Rating = model.CalculateRating(item.WeightedSolved, item.FirstBloods,
			item.SolvedProblems, item.AttemptedProblems)
		entries = append(entries, item)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	sort.Slice(entries, func(i, j int) bool {
		a, b := entries[i], entries[j]
		if a.Rating != b.Rating {
			return a.Rating > b.Rating
		}
		if a.WeightedSolved != b.WeightedSolved {
			return a.WeightedSolved > b.WeightedSolved
		}
		if a.FirstBloods != b.FirstBloods {
			return a.FirstBloods > b.FirstBloods
		}
		if a.LastAcceptedAt == nil || b.LastAcceptedAt == nil {
			return a.LastAcceptedAt != nil
		}
		if !a.LastAcceptedAt.Equal(*b.LastAcceptedAt) {
			return a.LastAcceptedAt.Before(*b.LastAcceptedAt)
		}
		return a.UserID < b.UserID
	})
	for i := range entries {
		entries[i].Rank = i + 1
	}
	return entries, nil
}

// GetUserRankingEntry 返回用户当前的全站名次；尚无有效提交时返回 ErrNotFound。
func (s *Store) GetUserRankingEntry(ctx context.Context, userID int64) (model.RankingEntry, error) {
	entries, err := s.ListRankingEntries(ctx)
	if err != nil {
		return model.RankingEntry{}, err
	}
	for _, item := range entries {
		if item.UserID == userID {
			return item, nil
		}
	}
	return model.RankingEntry{}, ErrNotFound
}
