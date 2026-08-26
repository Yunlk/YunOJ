package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/yunoj/yunoj/internal/model"
)

// CountUsers 返回用户总数（用于首个用户自动成为管理员）。
func (s *Store) CountUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users`).Scan(&n)
	return n, err
}

// CreateUser 创建用户，唯一约束冲突时返回 ErrConflict。
func (s *Store) CreateUser(ctx context.Context, username, email, passwordHash, role string) (model.User, error) {
	var u model.User
	err := s.pool.QueryRow(ctx,
		`INSERT INTO users (username, email, password_hash, role)
		 VALUES ($1, $2, $3, $4)
		 RETURNING id, username, email, role, disabled, avatar, created_at`,
		username, email, passwordHash, role,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.Disabled, &u.Avatar, &u.CreatedAt)
	if isUniqueViolation(err) {
		return model.User{}, ErrConflict
	}
	if err != nil {
		return model.User{}, err
	}
	return u, nil
}

// GetUserByUsername 按用户名查找用户，同时返回密码哈希供登录校验。
func (s *Store) GetUserByUsername(ctx context.Context, username string) (model.User, string, error) {
	var u model.User
	var hash string
	err := s.pool.QueryRow(ctx,
		`SELECT id, username, email, role, password_hash, disabled, avatar, created_at
		 FROM users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &hash, &u.Disabled, &u.Avatar, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.User{}, "", ErrNotFound
	}
	if err != nil {
		return model.User{}, "", err
	}
	return u, hash, nil
}

// GetUserByID 按 ID 查找用户。
func (s *Store) GetUserByID(ctx context.Context, id int64) (model.User, error) {
	var u model.User
	err := s.pool.QueryRow(ctx,
		`SELECT id, username, email, role, disabled, avatar, created_at
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.Disabled, &u.Avatar, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return u, nil
}

// AdminUserFilter 管理员用户列表过滤条件。
type AdminUserFilter struct {
	Keyword string
	Role    string
	Page    int
	Size    int
}

// ListUsers 返回后台用户列表及总数。
func (s *Store) ListUsers(ctx context.Context, f AdminUserFilter) ([]model.User, int64, error) {
	where := []string{}
	args := []any{}
	if f.Keyword != "" {
		args = append(args, "%"+f.Keyword+"%")
		where = append(where, fmt.Sprintf("(u.username ILIKE $%d OR u.email ILIKE $%d)", len(args), len(args)))
	}
	if f.Role != "" {
		args = append(args, f.Role)
		where = append(where, fmt.Sprintf("u.role = $%d", len(args)))
	}
	condition := ""
	if len(where) > 0 {
		condition = "WHERE " + strings.Join(where, " AND ")
	}
	var total int64
	if err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users u `+condition, args...).Scan(&total); err != nil {
		return nil, 0, err
	}
	args = append(args, f.Size, (f.Page-1)*f.Size)
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT u.id, u.username, u.email, u.role, u.disabled, u.avatar, u.created_at
		FROM users u %s ORDER BY u.created_at DESC LIMIT $%d OFFSET $%d`, condition, len(args)-1, len(args)), args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	items := make([]model.User, 0, f.Size)
	for rows.Next() {
		var u model.User
		if err := rows.Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.Disabled, &u.Avatar, &u.CreatedAt); err != nil {
			return nil, 0, err
		}
		items = append(items, u)
	}
	return items, total, rows.Err()
}

// UpdateUserAdmin 更新用户角色、禁用状态和可选的新密码。
func (s *Store) UpdateUserAdmin(ctx context.Context, id int64, role string, disabled bool, passwordHash *string) error {
	var ct pgconn.CommandTag
	var err error
	if passwordHash != nil {
		ct, err = s.pool.Exec(ctx, `UPDATE users SET role = $2, disabled = $3, password_hash = $4 WHERE id = $1`, id, role, disabled, *passwordHash)
	} else {
		ct, err = s.pool.Exec(ctx, `UPDATE users SET role = $2, disabled = $3 WHERE id = $1`, id, role, disabled)
	}
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// UpdateUserPassword 更新用户密码哈希。
func (s *Store) UpdateUserPassword(ctx context.Context, id int64, passwordHash string) error {
	ct, err := s.pool.Exec(ctx, `UPDATE users SET password_hash = $2 WHERE id = $1`, id, passwordHash)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CountActiveUsers 返回未禁用用户数。
func (s *Store) CountActiveUsers(ctx context.Context) (int64, error) {
	var n int64
	err := s.pool.QueryRow(ctx, `SELECT count(*) FROM users WHERE disabled = false`).Scan(&n)
	return n, err
}

// UpdateUserAvatar 更新用户头像相对路径。
func (s *Store) UpdateUserAvatar(ctx context.Context, userID int64, avatar string) error {
	ct, err := s.pool.Exec(ctx, `UPDATE users SET avatar = $2 WHERE id = $1`, userID, avatar)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetUserSubmissionStats 返回用户个人中心所需的提交聚合统计。
func (s *Store) GetUserSubmissionStats(ctx context.Context, userID int64) (total, accepted, problems, contests int64, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT count(*),
			count(*) FILTER (WHERE status = 'accepted'),
			count(DISTINCT problem_id),
			count(DISTINCT contest_id) FILTER (WHERE contest_id IS NOT NULL)
		 FROM submissions WHERE user_id = $1`, userID,
	).Scan(&total, &accepted, &problems, &contests)
	return
}

// ListUserActivity 返回指定日期范围内按天聚合的提交数量。
func (s *Store) ListUserActivity(ctx context.Context, userID int64, since time.Time) ([]model.UserActivityDay, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)
		 FROM submissions WHERE user_id = $1 AND created_at >= $2
		 GROUP BY created_at::date ORDER BY created_at::date`, userID, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.UserActivityDay{}
	for rows.Next() {
		var item model.UserActivityDay
		if err := rows.Scan(&item.Date, &item.Count); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// ListUserContestSummaries 返回用户参加过的比赛及最后提交时间。
func (s *Store) ListUserContestSummaries(ctx context.Context, userID int64) ([]model.UserContestSummary, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT c.id, c.title, c.mode, count(s.id), max(s.created_at)
		 FROM submissions s JOIN contests c ON c.id = s.contest_id
		 WHERE s.user_id = $1 AND s.contest_id IS NOT NULL
		 GROUP BY c.id, c.title, c.mode ORDER BY max(s.created_at) DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.UserContestSummary{}
	for rows.Next() {
		var item model.UserContestSummary
		if err := rows.Scan(&item.ID, &item.Title, &item.Mode, &item.SubmissionCount, &item.LastSubmittedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}
