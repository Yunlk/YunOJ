package store

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// ---------- 比赛 CRUD ----------

const contestColumns = `id, title, mode, feedback, score_mode,
	penalty_minutes, freeze_duration_minutes, rank_keys,
	start_time, end_time, description, visibility, reg_start_time, reg_end_time,
	submission_limit, created_at`

// CreateContest 创建比赛，成功后填充 ID/CreatedAt。
func (s *Store) CreateContest(ctx context.Context, c *model.Contest) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO contests (title, mode, feedback, score_mode,
			penalty_minutes, freeze_duration_minutes, rank_keys, start_time, end_time,
			description, visibility, reg_start_time, reg_end_time, submission_limit)
		 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
		 RETURNING id, created_at`,
		c.Title, c.Mode, c.Feedback, c.ScoreMode,
		c.PenaltyMinutes, c.FreezeDurationMinutes, c.RankKeys, c.StartTime, c.EndTime,
		c.Description, c.Visibility, c.RegStartTime, c.RegEndTime, c.SubmissionLimit,
	).Scan(&c.ID, &c.CreatedAt)
}

// GetContest 按 ID 查询比赛。
func (s *Store) GetContest(ctx context.Context, id int64) (model.Contest, error) {
	var c model.Contest
	err := s.pool.QueryRow(ctx,
		`SELECT `+contestColumns+` FROM contests WHERE id = $1`, id,
	).Scan(&c.ID, &c.Title, &c.Mode, &c.Feedback, &c.ScoreMode,
		&c.PenaltyMinutes, &c.FreezeDurationMinutes, &c.RankKeys,
		&c.StartTime, &c.EndTime, &c.Description, &c.Visibility,
		&c.RegStartTime, &c.RegEndTime, &c.SubmissionLimit, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Contest{}, ErrNotFound
	}
	return c, err
}

// ListContests 分页列出比赛（按 ID 倒序）。
func (s *Store) ListContests(ctx context.Context, page, size int) ([]model.Contest, int64, error) {
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM contests`).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+contestColumns+` FROM contests ORDER BY id DESC LIMIT $1 OFFSET $2`,
		size, (page-1)*size)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]model.Contest, 0, size)
	for rows.Next() {
		var c model.Contest
		if err := rows.Scan(&c.ID, &c.Title, &c.Mode, &c.Feedback, &c.ScoreMode,
			&c.PenaltyMinutes, &c.FreezeDurationMinutes, &c.RankKeys,
			&c.StartTime, &c.EndTime, &c.Description, &c.Visibility,
			&c.RegStartTime, &c.RegEndTime, &c.SubmissionLimit, &c.CreatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, c)
	}
	return items, total, rows.Err()
}

// UpdateContest 更新比赛。
func (s *Store) UpdateContest(ctx context.Context, c *model.Contest) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE contests SET title = $2, mode = $3, feedback = $4, score_mode = $5,
			penalty_minutes = $6, freeze_duration_minutes = $7, rank_keys = $8,
			start_time = $9, end_time = $10, description = $11, visibility = $12,
			reg_start_time = $13, reg_end_time = $14, submission_limit = $15
		 WHERE id = $1`,
		c.ID, c.Title, c.Mode, c.Feedback, c.ScoreMode,
		c.PenaltyMinutes, c.FreezeDurationMinutes, c.RankKeys, c.StartTime, c.EndTime,
		c.Description, c.Visibility, c.RegStartTime, c.RegEndTime, c.SubmissionLimit)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteContest 删除比赛。
func (s *Store) DeleteContest(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM contests WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- 比赛题目 ----------

// AddContestProblem 将题目加入比赛（重复加入则更新展示编号/排序/分值/上限覆盖）。
func (s *Store) AddContestProblem(ctx context.Context, cp model.ContestProblem) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO contest_problems (contest_id, problem_id, display_id, sort_order, score, submission_limit)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (contest_id, problem_id)
		 DO UPDATE SET display_id = $3, sort_order = $4, score = $5, submission_limit = $6`,
		cp.ContestID, cp.ProblemID, cp.DisplayID, cp.SortOrder, cp.Score, cp.SubmissionLimit)
	return err
}

// UpdateContestProblem 更新单个比赛题目（题号/分值/上限覆盖），不改变排序。
func (s *Store) UpdateContestProblem(ctx context.Context, cp model.ContestProblem) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE contest_problems SET display_id = $3, score = $4, submission_limit = $5
		 WHERE contest_id = $1 AND problem_id = $2`,
		cp.ContestID, cp.ProblemID, cp.DisplayID, cp.Score, cp.SubmissionLimit)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetContestProblem 查询单道比赛题目（分值/上限覆盖）。
func (s *Store) GetContestProblem(ctx context.Context, contestID, problemID int64) (model.ContestProblem, error) {
	var cp model.ContestProblem
	err := s.pool.QueryRow(ctx,
		`SELECT contest_id, problem_id, display_id, sort_order, score, submission_limit
		 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`,
		contestID, problemID,
	).Scan(&cp.ContestID, &cp.ProblemID, &cp.DisplayID, &cp.SortOrder, &cp.Score, &cp.SubmissionLimit)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ContestProblem{}, ErrNotFound
	}
	return cp, err
}

// ListContestProblems 列出比赛题目（按 sort_order）。
func (s *Store) ListContestProblems(ctx context.Context, contestID int64) ([]model.ContestProblem, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT contest_id, problem_id, display_id, sort_order, score, submission_limit
		 FROM contest_problems WHERE contest_id = $1 ORDER BY sort_order, problem_id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestProblem{}
	for rows.Next() {
		var cp model.ContestProblem
		if err := rows.Scan(&cp.ContestID, &cp.ProblemID, &cp.DisplayID,
			&cp.SortOrder, &cp.Score, &cp.SubmissionLimit); err != nil {
			return nil, err
		}
		items = append(items, cp)
	}
	return items, rows.Err()
}

// RemoveContestProblem 从比赛移除题目。
func (s *Store) RemoveContestProblem(ctx context.Context, contestID, problemID int64) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`, contestID, problemID)
	return err
}

// ReorderContestProblems 按给定题目 ID 顺序重写 sort_order（拖拽排序用）。
// 不属于该比赛的 ID 会被忽略。
func (s *Store) ReorderContestProblems(ctx context.Context, contestID int64, problemIDs []int64) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	for i, pid := range problemIDs {
		if _, err := tx.Exec(ctx,
			`UPDATE contest_problems SET sort_order = $3 WHERE contest_id = $1 AND problem_id = $2`,
			contestID, pid, i+1); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// ---------- 比赛队伍 ----------

// AddContestTeam 报名/更新参赛队伍（重报名保留已有头像）。
func (s *Store) AddContestTeam(ctx context.Context, t model.ContestTeam) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO contest_teams (contest_id, team_id, team_name, avatar)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (contest_id, team_id) DO UPDATE SET team_name = $3`,
		t.ContestID, t.TeamID, t.TeamName, t.Avatar)
	return err
}

// GetContestTeam 查询单个队伍报名信息。
func (s *Store) GetContestTeam(ctx context.Context, contestID, teamID int64) (model.ContestTeam, error) {
	var t model.ContestTeam
	err := s.pool.QueryRow(ctx,
		`SELECT contest_id, team_id, team_name, avatar FROM contest_teams
		 WHERE contest_id = $1 AND team_id = $2`, contestID, teamID,
	).Scan(&t.ContestID, &t.TeamID, &t.TeamName, &t.Avatar)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ContestTeam{}, ErrNotFound
	}
	return t, err
}

// UpdateContestTeamAvatar 更新队伍头像路径。
func (s *Store) UpdateContestTeamAvatar(ctx context.Context, contestID, teamID int64, avatar string) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE contest_teams SET avatar = $3 WHERE contest_id = $1 AND team_id = $2`,
		contestID, teamID, avatar)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ListContestTeams 列出参赛队伍。
func (s *Store) ListContestTeams(ctx context.Context, contestID int64) ([]model.ContestTeam, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT contest_id, team_id, team_name, avatar FROM contest_teams
		 WHERE contest_id = $1 ORDER BY team_id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestTeam{}
	for rows.Next() {
		var t model.ContestTeam
		if err := rows.Scan(&t.ContestID, &t.TeamID, &t.TeamName, &t.Avatar); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

// IsContestTeam 判断用户是否已报名该比赛。
func (s *Store) IsContestTeam(ctx context.Context, contestID, teamID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM contest_teams WHERE contest_id = $1 AND team_id = $2)`,
		contestID, teamID).Scan(&exists)
	return exists, err
}

// ---------- 比赛提交 ----------

// ListContestSubmissions 查询比赛的提交（排行榜引擎数据源）。
// 返回全部提交，包含分数/逐点得分/冻结标记；不含代码等大字段。
func (s *Store) ListContestSubmissions(ctx context.Context, contestID int64) ([]model.Submission, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT id, problem_id, user_id, language, status, time_ms, memory_kb,
			score, case_scores, is_frozen, created_at, judged_at
		 FROM submissions
		 WHERE contest_id = $1
		 ORDER BY id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Submission{}
	for rows.Next() {
		var sub model.Submission
		var caseScores []byte
		if err := rows.Scan(&sub.ID, &sub.ProblemID, &sub.UserID, &sub.Language,
			&sub.Status, &sub.TimeMs, &sub.MemoryKb,
			&sub.Score, &caseScores, &sub.IsFrozen, &sub.CreatedAt, &sub.JudgedAt); err != nil {
			return nil, err
		}
		if len(caseScores) > 0 {
			if err := json.Unmarshal(caseScores, &sub.CaseScores); err != nil {
				return nil, err
			}
		}
		items = append(items, sub)
	}
	return items, rows.Err()
}

// CountTeamProblemSubmissions 统计队伍在比赛中对某题的提交次数（提交次数限制用）。
func (s *Store) CountTeamProblemSubmissions(ctx context.Context, contestID, problemID, teamID int64) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM submissions
		 WHERE contest_id = $1 AND problem_id = $2 AND user_id = $3`,
		contestID, problemID, teamID).Scan(&n)
	return n, err
}
