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
	start_time, end_time, description, cover_image, visibility, reg_start_time, reg_end_time,
	submission_limit, registration_mode, max_team_size, allow_team_edit, created_at`

// CreateContest 创建比赛，成功后填充 ID/CreatedAt。
func (s *Store) CreateContest(ctx context.Context, c *model.Contest) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO contests (title, mode, feedback, score_mode,
			penalty_minutes, freeze_duration_minutes, rank_keys, start_time, end_time,
			 description, cover_image, visibility, reg_start_time, reg_end_time, submission_limit,
			registration_mode, max_team_size, allow_team_edit)
				 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
			 RETURNING id, created_at`,
		c.Title, c.Mode, c.Feedback, c.ScoreMode,
		c.PenaltyMinutes, c.FreezeDurationMinutes, c.RankKeys, c.StartTime, c.EndTime,
		c.Description, c.CoverImage, c.Visibility, c.RegStartTime, c.RegEndTime, c.SubmissionLimit,
		c.RegistrationMode, c.MaxTeamSize, c.AllowTeamEdit,
	).Scan(&c.ID, &c.CreatedAt)
}

// GetContest 按 ID 查询比赛。
func (s *Store) GetContest(ctx context.Context, id int64) (model.Contest, error) {
	var c model.Contest
	err := s.pool.QueryRow(ctx,
		`SELECT `+contestColumns+` FROM contests WHERE id = $1`, id,
	).Scan(&c.ID, &c.Title, &c.Mode, &c.Feedback, &c.ScoreMode,
		&c.PenaltyMinutes, &c.FreezeDurationMinutes, &c.RankKeys,
		&c.StartTime, &c.EndTime, &c.Description, &c.CoverImage, &c.Visibility,
		&c.RegStartTime, &c.RegEndTime, &c.SubmissionLimit,
		&c.RegistrationMode, &c.MaxTeamSize, &c.AllowTeamEdit, &c.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Contest{}, ErrNotFound
	}
	return c, err
}

// ListContests 分页列出比赛（按 ID 倒序）。includePrivate=false 时隐藏 private 比赛。
func (s *Store) ListContests(ctx context.Context, page, size int, includePrivate bool) ([]model.Contest, int64, error) {
	where := ""
	if !includePrivate {
		where = " WHERE visibility = 'public'"
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM contests`+where).Scan(&total); err != nil {
		return nil, 0, err
	}
	rows, err := s.pool.Query(ctx,
		`SELECT `+contestColumns+` FROM contests`+where+` ORDER BY id DESC LIMIT $1 OFFSET $2`,
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
			&c.StartTime, &c.EndTime, &c.Description, &c.CoverImage, &c.Visibility,
			&c.RegStartTime, &c.RegEndTime, &c.SubmissionLimit,
			&c.RegistrationMode, &c.MaxTeamSize, &c.AllowTeamEdit, &c.CreatedAt); err != nil {
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
			reg_start_time = $13, reg_end_time = $14, submission_limit = $15,
			registration_mode = $16, max_team_size = $17, allow_team_edit = $18
			 WHERE id = $1`,
		c.ID, c.Title, c.Mode, c.Feedback, c.ScoreMode,
		c.PenaltyMinutes, c.FreezeDurationMinutes, c.RankKeys, c.StartTime, c.EndTime,
		c.Description, c.Visibility, c.RegStartTime, c.RegEndTime, c.SubmissionLimit,
		c.RegistrationMode, c.MaxTeamSize, c.AllowTeamEdit)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateContestCoverImage 更新比赛封面相对路径。
func (s *Store) UpdateContestCoverImage(ctx context.Context, contestID int64, cover string) error {
	ct, err := s.pool.Exec(ctx, `UPDATE contests SET cover_image = $2 WHERE id = $1`, contestID, cover)
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
		`INSERT INTO contest_problems (contest_id, problem_id, display_id, sort_order, score, submission_limit, theme_color)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 ON CONFLICT (contest_id, problem_id)
		 DO UPDATE SET display_id = $3, sort_order = $4, score = $5, submission_limit = $6, theme_color = $7`,
		cp.ContestID, cp.ProblemID, cp.DisplayID, cp.SortOrder, cp.Score, cp.SubmissionLimit, cp.ThemeColor)
	return err
}

// UpdateContestProblem 更新单个比赛题目（题号/分值/上限覆盖），不改变排序。
func (s *Store) UpdateContestProblem(ctx context.Context, cp model.ContestProblem) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE contest_problems SET display_id = $3, score = $4, submission_limit = $5, theme_color = $6
		 WHERE contest_id = $1 AND problem_id = $2`,
		cp.ContestID, cp.ProblemID, cp.DisplayID, cp.Score, cp.SubmissionLimit, cp.ThemeColor)
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
		`SELECT contest_id, problem_id, display_id, sort_order, score, submission_limit, theme_color
		 FROM contest_problems WHERE contest_id = $1 AND problem_id = $2`,
		contestID, problemID,
	).Scan(&cp.ContestID, &cp.ProblemID, &cp.DisplayID, &cp.SortOrder, &cp.Score, &cp.SubmissionLimit, &cp.ThemeColor)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ContestProblem{}, ErrNotFound
	}
	return cp, err
}

// ListContestProblems 列出比赛题目（按 sort_order）。
func (s *Store) ListContestProblems(ctx context.Context, contestID int64) ([]model.ContestProblem, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT contest_id, problem_id, display_id, sort_order, score, submission_limit, theme_color
		 FROM contest_problems WHERE contest_id = $1 ORDER BY sort_order, problem_id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestProblem{}
	for rows.Next() {
		var cp model.ContestProblem
		if err := rows.Scan(&cp.ContestID, &cp.ProblemID, &cp.DisplayID,
			&cp.SortOrder, &cp.Score, &cp.SubmissionLimit, &cp.ThemeColor); err != nil {
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

// AddContestTeam 报名/更新参赛队伍（重报名保留已有头像），并确保队长存在于成员表。
func (s *Store) AddContestTeam(ctx context.Context, t model.ContestTeam) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err = tx.Exec(ctx,
		`INSERT INTO contest_teams (contest_id, team_id, team_name, avatar)
		 VALUES ($1, $2, $3, $4)
		 ON CONFLICT (contest_id, team_id) DO UPDATE SET team_name = $3`,
		t.ContestID, t.TeamID, t.TeamName, t.Avatar); err != nil {
		return err
	}
	if _, err = tx.Exec(ctx,
		`INSERT INTO contest_team_members (contest_id, team_id, user_id, is_captain)
		 VALUES ($1, $2, $2, true) ON CONFLICT (contest_id, team_id, user_id)
		 DO UPDATE SET is_captain = true`, t.ContestID, t.TeamID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// GetContestTeam 查询单个队伍报名信息。
func (s *Store) GetContestTeam(ctx context.Context, contestID, teamID int64) (model.ContestTeam, error) {
	var t model.ContestTeam
	err := s.pool.QueryRow(ctx,
		`SELECT contest_id, team_id, team_name, avatar FROM contest_teams
		 WHERE contest_id = $1 AND (team_id = $2 OR EXISTS (
			SELECT 1 FROM contest_team_members m
			WHERE m.contest_id = contest_teams.contest_id AND m.team_id = contest_teams.team_id AND m.user_id = $2
		 ))`, contestID, teamID,
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

// ListContestParticipants 返回比赛参赛者及提交摘要。
func (s *Store) ListContestParticipants(ctx context.Context, contestID int64) ([]model.ContestParticipant, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT t.contest_id, t.team_id, t.team_name, u.username, t.avatar,
		       count(DISTINCT s.id), count(DISTINCT s.id) FILTER (WHERE s.status = 'accepted'), max(s.created_at),
		       COALESCE(array_agg(mu.username ORDER BY tm.is_captain DESC, mu.username)
		         FILTER (WHERE mu.username IS NOT NULL), ARRAY[]::text[])
		FROM contest_teams t
		JOIN users u ON u.id = t.team_id
		LEFT JOIN contest_team_members tm ON tm.contest_id = t.contest_id AND tm.team_id = t.team_id
		LEFT JOIN users mu ON mu.id = tm.user_id
		LEFT JOIN submissions s ON s.contest_id = t.contest_id AND s.user_id = tm.user_id
		WHERE t.contest_id = $1
		GROUP BY t.contest_id, t.team_id, t.team_name, u.username, t.avatar
		ORDER BY t.team_id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestParticipant{}
	for rows.Next() {
		var item model.ContestParticipant
		if err := rows.Scan(&item.ContestID, &item.TeamID, &item.TeamName, &item.Username,
			&item.Avatar, &item.SubmissionCount, &item.AcceptedCount, &item.LastSubmittedAt, &item.Members); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// RemoveContestTeam 移除比赛参赛者，保留其历史提交以便复盘。
func (s *Store) RemoveContestTeam(ctx context.Context, contestID, teamID int64) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM contest_teams WHERE contest_id = $1 AND team_id = $2`, contestID, teamID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// IsContestTeam 判断用户是否已报名该比赛。
func (s *Store) IsContestTeam(ctx context.Context, contestID, teamID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM contest_teams t WHERE t.contest_id = $1 AND (t.team_id = $2 OR EXISTS (
			SELECT 1 FROM contest_team_members m WHERE m.contest_id = t.contest_id AND m.team_id = t.team_id AND m.user_id = $2
		)))`,
		contestID, teamID).Scan(&exists)
	return exists, err
}

// FindContestTeamForUser 返回用户作为队长或成员加入的队伍。
func (s *Store) FindContestTeamForUser(ctx context.Context, contestID, userID int64) (model.ContestTeam, error) {
	return s.GetContestTeam(ctx, contestID, userID)
}

// ListContestTeamMembers 列出队伍成员，队长排在最前。
func (s *Store) ListContestTeamMembers(ctx context.Context, contestID, teamID int64) ([]model.ContestTeamMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT m.contest_id, m.team_id, m.user_id, u.username, m.is_captain, m.joined_at
		FROM contest_team_members m JOIN users u ON u.id = m.user_id
		WHERE m.contest_id = $1 AND m.team_id = $2
		ORDER BY m.is_captain DESC, m.joined_at, m.user_id`, contestID, teamID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestTeamMember{}
	for rows.Next() {
		var item model.ContestTeamMember
		if err := rows.Scan(&item.ContestID, &item.TeamID, &item.UserID, &item.Username, &item.IsCaptain, &item.JoinedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// AddContestTeamMember 将用户加入队伍；唯一索引保证一个比赛只能加入一支队伍。
func (s *Store) AddContestTeamMember(ctx context.Context, contestID, teamID, userID int64) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO contest_team_members (contest_id, team_id, user_id, is_captain)
		 VALUES ($1, $2, $3, false)`, contestID, teamID, userID)
	return err
}

// RemoveContestTeamMember 移除普通成员，队长关系不可删除。
func (s *Store) RemoveContestTeamMember(ctx context.Context, contestID, teamID, userID int64) error {
	ct, err := s.pool.Exec(ctx,
		`DELETE FROM contest_team_members WHERE contest_id = $1 AND team_id = $2 AND user_id = $3 AND is_captain = false`,
		contestID, teamID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateContestAnnouncement 发布比赛出题组广播。
func (s *Store) CreateContestAnnouncement(ctx context.Context, item *model.ContestAnnouncement) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO contest_announcements (contest_id, author_id, title, content, pinned)
		 VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at, updated_at`,
		item.ContestID, item.AuthorID, item.Title, item.Content, item.Pinned,
	).Scan(&item.ID, &item.CreatedAt, &item.UpdatedAt)
}

// ListContestAnnouncements 列出比赛广播，置顶消息优先。
func (s *Store) ListContestAnnouncements(ctx context.Context, contestID int64) ([]model.ContestAnnouncement, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT a.id, a.contest_id, a.author_id, u.username, a.title, a.content,
			a.pinned, a.created_at, a.updated_at
		 FROM contest_announcements a JOIN users u ON u.id = a.author_id
		 WHERE a.contest_id = $1 ORDER BY a.pinned DESC, a.created_at DESC`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestAnnouncement{}
	for rows.Next() {
		var item model.ContestAnnouncement
		if err := rows.Scan(&item.ID, &item.ContestID, &item.AuthorID, &item.AuthorName,
			&item.Title, &item.Content, &item.Pinned, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// DeleteContestAnnouncement 删除一条比赛广播。
func (s *Store) DeleteContestAnnouncement(ctx context.Context, contestID, announcementID int64) error {
	ct, err := s.pool.Exec(ctx,
		`DELETE FROM contest_announcements WHERE contest_id = $1 AND id = $2`, contestID, announcementID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateContestQuestion 创建选手提问。
func (s *Store) CreateContestQuestion(ctx context.Context, item *model.ContestQuestion) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO contest_questions (contest_id, asker_id, content)
		 VALUES ($1, $2, $3) RETURNING id, asked_at`,
		item.ContestID, item.AskerID, item.Content,
	).Scan(&item.ID, &item.AskedAt)
}

// ListContestQuestions 列出当前用户可见的答疑；管理员可见全部提问。
func (s *Store) ListContestQuestions(ctx context.Context, contestID, viewerID int64, isAdmin bool) ([]model.ContestQuestion, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT q.id, q.contest_id, q.asker_id, asker.username, q.content, q.answer,
			q.answerer_id, COALESCE(answerer.username, ''), q.public, q.asked_at, q.answered_at
		 FROM contest_questions q
		 JOIN users asker ON asker.id = q.asker_id
		 LEFT JOIN users answerer ON answerer.id = q.answerer_id
		 WHERE q.contest_id = $1
		   AND ($2 OR q.asker_id = $3 OR (q.public = true AND q.answer <> ''))
		 ORDER BY q.asked_at DESC`, contestID, isAdmin, viewerID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestQuestion{}
	for rows.Next() {
		var item model.ContestQuestion
		if err := rows.Scan(&item.ID, &item.ContestID, &item.AskerID, &item.AskerName,
			&item.Content, &item.Answer, &item.AnswererID, &item.AnswererName,
			&item.Public, &item.AskedAt, &item.AnsweredAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// AnswerContestQuestion 保存管理员回答和公开范围，允许管理员后续修正。
func (s *Store) AnswerContestQuestion(ctx context.Context, contestID, questionID, answererID int64, answer string, public bool) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE contest_questions SET
			answer = $3,
			answerer_id = CASE WHEN btrim($3) = '' THEN NULL ELSE $4::bigint END,
			public = CASE WHEN btrim($3) = '' THEN false ELSE $5::boolean END,
			answered_at = CASE WHEN btrim($3) = '' THEN NULL ELSE now() END
		 WHERE contest_id = $1 AND id = $2`, contestID, questionID, answer, answererID, public)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ---------- 比赛提交 ----------

// ProblemContestStat 比赛内单题聚合统计（总览用）。
type ProblemContestStat struct {
	ProblemID      int64
	AttemptedUsers int64 // 提交过该题的用户数（含 CE）
	AcceptedUsers  int64 // 通过该题的用户数
	Submissions    int64 // 总提交数
}

// ContestProblemStats 按题聚合比赛统计。走 (contest_id, problem_id, user_id) 索引。
func (s *Store) ContestProblemStats(ctx context.Context, contestID int64) (map[int64]ProblemContestStat, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT problem_id,
			count(DISTINCT user_id) AS attempted_users,
			count(DISTINCT user_id) FILTER (WHERE status = 'accepted') AS accepted_users,
			count(*) AS submissions
		 FROM submissions WHERE contest_id = $1 GROUP BY problem_id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := map[int64]ProblemContestStat{}
	for rows.Next() {
		var st ProblemContestStat
		if err := rows.Scan(&st.ProblemID, &st.AttemptedUsers, &st.AcceptedUsers, &st.Submissions); err != nil {
			return nil, err
		}
		stats[st.ProblemID] = st
	}
	return stats, rows.Err()
}

// UserProblemStat 用户在比赛内单题的提交聚合（总览的"我的状态"用）。
type UserProblemStat struct {
	ProblemID int64
	Total     int64 // 提交总数
	Judging   int64 // 评测中（pending/running）数量
	Accepted  bool  // 是否存在 accepted
	BestScore int   // 各次提交最高得分（IOI）
	LastScore int   // 最后一次提交得分（OI）
}

// UserContestProblemStats 用户在比赛内的分题提交聚合。
// 走 (contest_id, user_id) 索引。
func (s *Store) UserContestProblemStats(ctx context.Context, contestID, userID int64) (map[int64]UserProblemStat, error) {
	rows, err := s.pool.Query(ctx,
		`WITH team AS (
			SELECT COALESCE((SELECT team_id FROM contest_team_members WHERE contest_id = $1 AND user_id = $2), $2) AS team_id
		)
		SELECT s.problem_id,
			count(*) AS total,
			count(*) FILTER (WHERE s.status IN ('pending','running')) AS judging,
			bool_or(s.status = 'accepted') AS accepted,
			coalesce(max(s.score), 0) AS best_score,
			coalesce((array_agg(s.score ORDER BY s.id DESC))[1], 0) AS last_score
		 FROM submissions s CROSS JOIN team t
		 WHERE s.contest_id = $1 AND s.user_id IN (
			SELECT m.user_id FROM contest_team_members m WHERE m.contest_id = $1 AND m.team_id = t.team_id
		 )
		 GROUP BY s.problem_id`, contestID, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := map[int64]UserProblemStat{}
	for rows.Next() {
		var st UserProblemStat
		if err := rows.Scan(&st.ProblemID, &st.Total, &st.Judging,
			&st.Accepted, &st.BestScore, &st.LastScore); err != nil {
			return nil, err
		}
		stats[st.ProblemID] = st
	}
	return stats, rows.Err()
}

// ListContestSubmissions 查询比赛的提交（排行榜引擎数据源）。
// 返回全部提交，包含分数/逐点得分/冻结标记；不含代码等大字段。
func (s *Store) ListContestSubmissions(ctx context.Context, contestID int64) ([]model.Submission, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT s.id, s.problem_id, COALESCE(tm.team_id, s.user_id), s.language, s.status, s.time_ms, s.memory_kb,
			score, case_scores, is_frozen, created_at, judged_at
		 FROM submissions s
		 LEFT JOIN contest_team_members tm ON tm.contest_id = s.contest_id AND tm.user_id = s.user_id
		 WHERE s.contest_id = $1
		 ORDER BY s.id`, contestID)
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

// ListContestSubmissionsDetailed 返回比赛时间线导出所需的评测结果明细。
// 调用方应显式忽略 Code 字段，数据包默认不包含源代码。
func (s *Store) ListContestSubmissionsDetailed(ctx context.Context, contestID int64) ([]model.Submission, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT s.id, s.problem_id, COALESCE(p.title, ''), COALESCE(tm.team_id, s.user_id),
		       COALESCE(u.username, ''), s.language, s.code, s.status, s.compile_error,
		       s.case_results, s.time_ms, s.memory_kb, s.score, s.case_scores,
		       s.is_frozen, s.created_at, s.judged_at
		FROM submissions s
		LEFT JOIN contest_team_members tm ON tm.contest_id = s.contest_id AND tm.user_id = s.user_id
		LEFT JOIN problems p ON p.id = s.problem_id
		LEFT JOIN users u ON u.id = s.user_id
		WHERE s.contest_id = $1 ORDER BY s.id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Submission{}
	contestIDCopy := contestID
	for rows.Next() {
		var sub model.Submission
		var caseResults, caseScores []byte
		if err := rows.Scan(&sub.ID, &sub.ProblemID, &sub.ProblemTitle, &sub.UserID,
			&sub.Username, &sub.Language, &sub.Code, &sub.Status, &sub.CompileError,
			&caseResults, &sub.TimeMs, &sub.MemoryKb, &sub.Score, &caseScores,
			&sub.IsFrozen, &sub.CreatedAt, &sub.JudgedAt); err != nil {
			return nil, err
		}
		sub.ContestID = &contestIDCopy
		if len(caseResults) > 0 {
			if err := json.Unmarshal(caseResults, &sub.CaseResults); err != nil {
				return nil, err
			}
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
		`SELECT count(*) FROM submissions s
		 LEFT JOIN contest_team_members tm ON tm.contest_id = s.contest_id AND tm.user_id = s.user_id
		 WHERE s.contest_id = $1 AND s.problem_id = $2 AND COALESCE(tm.team_id, s.user_id) = $3`,
		contestID, problemID, teamID).Scan(&n)
	return n, err
}
