package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5"
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
		 RETURNING id, username, email, role, created_at`,
		username, email, passwordHash, role,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.CreatedAt)
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
		`SELECT id, username, email, role, password_hash, created_at
		 FROM users WHERE username = $1`, username,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &hash, &u.CreatedAt)
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
		`SELECT id, username, email, role, created_at
		 FROM users WHERE id = $1`, id,
	).Scan(&u.ID, &u.Username, &u.Email, &u.Role, &u.CreatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.User{}, ErrNotFound
	}
	if err != nil {
		return model.User{}, err
	}
	return u, nil
}
