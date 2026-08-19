// Package store 提供基于 PostgreSQL（pgx 连接池）的数据访问层。
package store

import (
	"context"
	"errors"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// 通用错误。
var (
	ErrNotFound = errors.New("记录不存在")
	ErrConflict = errors.New("唯一约束冲突")
)

// Store 封装数据库连接池与全部数据访问方法。
type Store struct {
	pool *pgxpool.Pool
}

// New 创建连接池并验证连通性。
func New(ctx context.Context, databaseURL string) (*Store, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Store{pool: pool}, nil
}

// Pool 暴露底层连接池（迁移等场景使用）。
func (s *Store) Pool() *pgxpool.Pool { return s.pool }

// Close 关闭连接池。
func (s *Store) Close() { s.pool.Close() }

// isUniqueViolation 判断是否为 PostgreSQL 唯一约束冲突（错误码 23505）。
func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
