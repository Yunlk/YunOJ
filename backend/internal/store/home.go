package store

import (
	"context"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

// HomeSummary 返回首页所需的公开概览和近期内容。
func (s *Store) HomeSummary(ctx context.Context) (model.HomeSummary, error) {
	var h model.HomeSummary
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE disabled = false`).Scan(&h.UserCount); err != nil {
		return h, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM problems WHERE status = 'published'`).Scan(&h.ProblemCount); err != nil {
		return h, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM contests WHERE visibility = 'public'`).Scan(&h.ContestCount); err != nil {
		return h, err
	}
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM submissions`).Scan(&h.SubmissionCount); err != nil {
		return h, err
	}
	h.GroupCount, h.AssignmentCount, _ = s.CountEducationStats(ctx)

	now := time.Now()
	rows, err := s.pool.Query(ctx, `
		SELECT id, title, mode, feedback, score_mode, penalty_minutes, freeze_duration_minutes,
		       rank_keys, start_time, end_time, description, visibility, reg_start_time, reg_end_time,
		       submission_limit, created_at
		FROM contests
		WHERE visibility = 'public' AND end_time > $1
		ORDER BY start_time ASC LIMIT 12`, now)
	if err != nil {
		return h, err
	}
	defer rows.Close()
	for rows.Next() {
		var c model.Contest
		if err := rows.Scan(&c.ID, &c.Title, &c.Mode, &c.Feedback, &c.ScoreMode,
			&c.PenaltyMinutes, &c.FreezeDurationMinutes, &c.RankKeys, &c.StartTime, &c.EndTime,
			&c.Description, &c.Visibility, &c.RegStartTime, &c.RegEndTime, &c.SubmissionLimit, &c.CreatedAt); err != nil {
			return h, err
		}
		if now.Before(c.StartTime) {
			h.UpcomingContests = append(h.UpcomingContests, c)
		} else {
			h.ActiveContests = append(h.ActiveContests, c)
		}
	}
	if err := rows.Err(); err != nil {
		return h, err
	}
	if h.ActiveContests == nil {
		h.ActiveContests = []model.Contest{}
	}
	if h.UpcomingContests == nil {
		h.UpcomingContests = []model.Contest{}
	}

	problems, _, err := s.ListProblems(ctx, ProblemFilter{Page: 1, Size: 8})
	if err != nil {
		return h, err
	}
	h.RecentProblems = make([]model.HomeProblem, 0, len(problems))
	for _, p := range problems {
		h.RecentProblems = append(h.RecentProblems, model.HomeProblem{
			ID: p.ID, Title: p.Title, Difficulty: p.Difficulty, Tags: p.Tags,
			AcceptedCount: p.AcceptedCount, SubmissionCount: p.SubmissionCount,
			CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
	}
	return h, nil
}
