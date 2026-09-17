package store

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// HomeSummary 返回首页所需的公开比赛分组：
//   - 未结束的公开比赛 → 进行中 / 即将开始（沿用 contestColumns）
//   - 已结束的公开比赛 → 最近举行（按结束时间倒序，首页侧栏用）
//
// 首页不再展示平台总量与「最近添加的题目」，因此这里不做 count(*) 与题目查询。
func (s *Store) HomeSummary(ctx context.Context) (model.HomeSummary, error) {
	h := model.HomeSummary{
		ActiveContests:   []model.Contest{},
		UpcomingContests: []model.Contest{},
		RecentContests:   []model.Contest{},
	}
	now := time.Now()

	rows, err := s.pool.Query(ctx, `
		SELECT `+contestColumns+`
		FROM contests
		WHERE visibility = 'public' AND end_time > $1
		ORDER BY start_time ASC LIMIT 12`, now)
	if err != nil {
		return h, err
	}
	if err := collectContests(rows, func(c model.Contest) {
		if now.Before(c.StartTime) {
			h.UpcomingContests = append(h.UpcomingContests, c)
			return
		}
		h.ActiveContests = append(h.ActiveContests, c)
	}); err != nil {
		return h, err
	}

	ended, err := s.pool.Query(ctx, `
		SELECT `+contestColumns+`
		FROM contests
		WHERE visibility = 'public' AND end_time <= $1
		ORDER BY end_time DESC LIMIT 6`, now)
	if err != nil {
		return h, err
	}
	if err := collectContests(ended, func(c model.Contest) {
		h.RecentContests = append(h.RecentContests, c)
	}); err != nil {
		return h, err
	}
	return h, nil
}

// collectContests 逐行读取比赛并交给 each 处理，结束后统一校验 rows.Err()。
func collectContests(rows pgx.Rows, each func(model.Contest)) error {
	defer rows.Close()
	for rows.Next() {
		var c model.Contest
		if err := rows.Scan(&c.ID, &c.Title, &c.Mode, &c.Feedback, &c.ScoreMode,
			&c.PenaltyMinutes, &c.FreezeDurationMinutes, &c.DynamicDelayMinutes, &c.RankKeys,
			&c.StartTime, &c.EndTime, &c.Description, &c.CoverImage, &c.Visibility,
			&c.RegStartTime, &c.RegEndTime, &c.SubmissionLimit,
			&c.RegistrationMode, &c.MaxTeamSize, &c.AllowTeamEdit,
			&c.PretestOnly, &c.HackingEnabled, &c.CreatedAt); err != nil {
			return err
		}
		each(c)
	}
	return rows.Err()
}
