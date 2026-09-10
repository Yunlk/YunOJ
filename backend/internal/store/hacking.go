package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// ---------- 题目锁定（Open Hacking） ----------

// LockProblem 锁定比赛中某题（锁定后该队不能再提交，但可查看并攻击他人提交）。
func (s *Store) LockProblem(ctx context.Context, contestID, teamID, problemID int64) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO contest_problem_locks (contest_id, team_id, problem_id)
		 VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
		contestID, teamID, problemID)
	return err
}

// IsProblemLocked 判断队伍是否已锁定该题。
func (s *Store) IsProblemLocked(ctx context.Context, contestID, teamID, problemID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM contest_problem_locks
			WHERE contest_id = $1 AND team_id = $2 AND problem_id = $3)`,
		contestID, teamID, problemID).Scan(&exists)
	return exists, err
}

// ListProblemLocks 列出队伍在比赛中已锁定的题目 ID。
func (s *Store) ListProblemLocks(ctx context.Context, contestID, teamID int64) ([]int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT problem_id FROM contest_problem_locks
		 WHERE contest_id = $1 AND team_id = $2 ORDER BY problem_id`, contestID, teamID)
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

// ---------- Hack 记录 ----------

// CreateHack 创建一条 Hack 记录（初始状态 pending，等待评测机处理）。
func (s *Store) CreateHack(ctx context.Context, hack *model.ContestHack) error {
	return s.pool.QueryRow(ctx,
		`INSERT INTO contest_hacks
			(contest_id, problem_id, hacker_id, target_submission_id, target_team_id, input, expected_output)
		 VALUES ($1, $2, $3, $4, $5, $6, $7)
		 RETURNING id, created_at`,
		hack.ContestID, hack.ProblemID, hack.HackerID,
		hack.TargetSubmissionID, hack.TargetTeamID, hack.Input, hack.ExpectedOutput,
	).Scan(&hack.ID, &hack.CreatedAt)
}

// GetHack 查询单条 Hack（含昵称等展示字段）。
func (s *Store) GetHack(ctx context.Context, id int64) (model.ContestHack, error) {
	row := s.pool.QueryRow(ctx, hackSelect+` WHERE h.id = $1`, id)
	h, err := scanHack(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.ContestHack{}, ErrNotFound
	}
	return h, err
}

const hackSelect = `SELECT h.id, h.contest_id, h.problem_id, COALESCE(cp.display_id, ''),
	h.hacker_id, hu.username, h.target_submission_id, h.target_team_id, tu.username,
	h.input, h.expected_output, h.verdict, h.target_status, h.judge_note, h.created_at, h.judged_at
	FROM contest_hacks h
	LEFT JOIN contest_problems cp ON cp.contest_id = h.contest_id AND cp.problem_id = h.problem_id
	JOIN users hu ON hu.id = h.hacker_id
	JOIN users tu ON tu.id = h.target_team_id`

func scanHack(row rowScanner) (model.ContestHack, error) {
	var h model.ContestHack
	err := row.Scan(&h.ID, &h.ContestID, &h.ProblemID, &h.DisplayID,
		&h.HackerID, &h.HackerName, &h.TargetSubmissionID, &h.TargetTeamID, &h.TargetTeamName,
		&h.Input, &h.ExpectedOutput, &h.Verdict, &h.TargetStatus, &h.JudgeNote,
		&h.CreatedAt, &h.JudgedAt)
	return h, err
}

// ListContestHacks 列出比赛的 Hack 记录；hackerID > 0 时只返回该用户的。
func (s *Store) ListContestHacks(ctx context.Context, contestID, hackerID int64, limit int) ([]model.ContestHack, error) {
	if limit <= 0 {
		limit = 200
	}
	query := hackSelect + ` WHERE h.contest_id = $1`
	args := []any{contestID}
	if hackerID > 0 {
		query += ` AND h.hacker_id = $2`
		args = append(args, hackerID)
	}
	query += ` ORDER BY h.id DESC LIMIT $` + itoa(len(args)+1)
	args = append(args, limit)
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ContestHack{}
	for rows.Next() {
		h, err := scanHack(rows)
		if err != nil {
			return nil, err
		}
		items = append(items, h)
	}
	return items, rows.Err()
}

// SetHackResult 写回 Hack 判定结果。
func (s *Store) SetHackResult(ctx context.Context, id int64, verdict, targetStatus, note string) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE contest_hacks SET verdict = $2, target_status = $3, judge_note = $4, judged_at = now()
		 WHERE id = $1`, id, verdict, targetStatus, note)
	return err
}

// HackScore 队伍在比赛中的 Hack 统计。
type HackScore struct {
	HackerID int64
	Success  int
	Fail     int
	// Points = 成功 × 100 − 失败 × 50（Codeforces 惯例）
	Points int
}

// ListContestHackScores 汇总各队的 Hack 得分（用于排行榜计分）。
func (s *Store) ListContestHackScores(ctx context.Context, contestID int64) (map[int64]HackScore, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT hacker_id,
			count(*) FILTER (WHERE verdict = 'success') AS success,
			count(*) FILTER (WHERE verdict = 'fail') AS fail
		FROM contest_hacks
		WHERE contest_id = $1 AND verdict IN ('success','fail')
		GROUP BY hacker_id`, contestID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[int64]HackScore{}
	for rows.Next() {
		var hs HackScore
		if err := rows.Scan(&hs.HackerID, &hs.Success, &hs.Fail); err != nil {
			return nil, err
		}
		hs.Points = hs.Success*model.HackSuccessPoints - hs.Fail*model.HackFailPenalty
		out[hs.HackerID] = hs
	}
	return out, rows.Err()
}

// itoa 轻量整数转字符串（避免为此引入 strconv）。
func itoa(n int) string {
	if n == 0 {
		return "0"
	}
	buf := [12]byte{}
	i := len(buf)
	for n > 0 {
		i--
		buf[i] = byte('0' + n%10)
		n /= 10
	}
	return string(buf[i:])
}
