package model

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// migration 表示一次数据库迁移。stmts 为按顺序执行的一组单条 SQL 语句。
type migration struct {
	version int
	name    string
	stmts   []string
}

var migrations = []migration{
	{
		version: 1,
		name:    "init",
		stmts: []string{
			`CREATE TABLE IF NOT EXISTS users (
				id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				username      TEXT NOT NULL UNIQUE,
				email         TEXT NOT NULL UNIQUE,
				password_hash TEXT NOT NULL,
				role          TEXT NOT NULL DEFAULT 'user',
				created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE TABLE IF NOT EXISTS problems (
				id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				title            TEXT NOT NULL,
				statement        TEXT NOT NULL DEFAULT '',
				input_format     TEXT NOT NULL DEFAULT '',
				output_format    TEXT NOT NULL DEFAULT '',
				hint             TEXT NOT NULL DEFAULT '',
				samples          JSONB NOT NULL DEFAULT '[]',
				time_limit_ms    INTEGER NOT NULL DEFAULT 1000,
				memory_limit_kb  INTEGER NOT NULL DEFAULT 262144,
				difficulty       INTEGER NOT NULL DEFAULT 5,
				tags             TEXT[] NOT NULL DEFAULT '{}',
				accepted_count   BIGINT NOT NULL DEFAULT 0,
				submission_count BIGINT NOT NULL DEFAULT 0,
				created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE TABLE IF NOT EXISTS submissions (
				id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				problem_id    BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
				user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				language      TEXT NOT NULL,
				code          TEXT NOT NULL,
				status        TEXT NOT NULL DEFAULT 'pending',
				compile_error TEXT NOT NULL DEFAULT '',
				case_results  JSONB NOT NULL DEFAULT '[]',
				time_ms       INTEGER NOT NULL DEFAULT 0,
				memory_kb     INTEGER NOT NULL DEFAULT 0,
				created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
				judged_at     TIMESTAMPTZ
			)`,
			`CREATE INDEX IF NOT EXISTS idx_submissions_problem ON submissions (problem_id, id DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_submissions_user ON submissions (user_id, id DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions (status)`,
		},
	},
	{
		version: 2,
		name:    "submission_optimize",
		stmts: []string{
			// 是否开启 -O2 优化（C/C++）
			`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS optimize BOOLEAN NOT NULL DEFAULT true`,
		},
	},
	{
		version: 3,
		name:    "contest_system",
		stmts: []string{
			// ---- 题目类型与特殊评测 ----
			// type: standard | spj | interactive | output_only
			`ALTER TABLE problems ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'standard'`,
			// spj_source/interactor_source: 特殊评测器/交互器源码（在沙箱内编译运行）
			`ALTER TABLE problems ADD COLUMN IF NOT EXISTS spj_source TEXT NOT NULL DEFAULT ''`,
			`ALTER TABLE problems ADD COLUMN IF NOT EXISTS interactor_source TEXT NOT NULL DEFAULT ''`,
			// testcase_scores: 各测试点分数（与排序后的测试点对齐；空 = 平均分配）
			`ALTER TABLE problems ADD COLUMN IF NOT EXISTS testcase_scores JSONB NOT NULL DEFAULT '[]'`,
			// submission_limit: 比赛内该题提交次数上限（0 = 不限）
			`ALTER TABLE problems ADD COLUMN IF NOT EXISTS submission_limit INTEGER NOT NULL DEFAULT 0`,
			// ---- 比赛 ----
			`CREATE TABLE IF NOT EXISTS contests (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				title TEXT NOT NULL,
				mode TEXT NOT NULL DEFAULT 'ACM',
				feedback TEXT NOT NULL DEFAULT 'realtime',
				score_mode TEXT NOT NULL DEFAULT 'all_or_nothing',
				penalty_minutes INTEGER NOT NULL DEFAULT 20,
				freeze_duration_minutes INTEGER NOT NULL DEFAULT 0,
				rank_keys TEXT[] NOT NULL DEFAULT '{}',
				start_time TIMESTAMPTZ NOT NULL DEFAULT now(),
				end_time TIMESTAMPTZ NOT NULL DEFAULT now() + interval '7 days',
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE TABLE IF NOT EXISTS contest_problems (
				contest_id BIGINT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
				problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
				display_id TEXT NOT NULL DEFAULT '',
				sort_order INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (contest_id, problem_id)
			)`,
			`CREATE TABLE IF NOT EXISTS contest_teams (
				contest_id BIGINT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
				team_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				team_name TEXT NOT NULL,
				PRIMARY KEY (contest_id, team_id)
			)`,
			// ---- 提交扩展：比赛上下文、分数与冻结 ----
			`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS contest_id BIGINT REFERENCES contests(id) ON DELETE SET NULL`,
			`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0`,
			// case_scores: 与 case_results 对齐的各测试点得分
			`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS case_scores JSONB NOT NULL DEFAULT '[]'`,
			`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS is_frozen BOOLEAN NOT NULL DEFAULT false`,
			`CREATE INDEX IF NOT EXISTS idx_submissions_contest ON submissions (contest_id, id)`,
		},
	},
}

// Migrate 按版本顺序应用尚未执行的迁移。所有语句都是幂等的
// （CREATE ... IF NOT EXISTS），且并发启动的多个实例会通过
// schema_migrations 的唯一约束安全地跳过重复执行。
func Migrate(ctx context.Context, pool *pgxpool.Pool) error {
	_, err := pool.Exec(ctx, `CREATE TABLE IF NOT EXISTS schema_migrations (
		version    INTEGER PRIMARY KEY,
		name       TEXT NOT NULL,
		applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
	)`)
	if err != nil {
		return err
	}

	for _, m := range migrations {
		var exists bool
		if err := pool.QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM schema_migrations WHERE version = $1)`, m.version).Scan(&exists); err != nil {
			return err
		}
		if exists {
			continue
		}

		tx, err := pool.Begin(ctx)
		if err != nil {
			return err
		}
		for _, stmt := range m.stmts {
			if _, err := tx.Exec(ctx, stmt); err != nil {
				_ = tx.Rollback(ctx)
				return fmt.Errorf("迁移 %d (%s) 失败: %w", m.version, m.name, err)
			}
		}
		if _, err := tx.Exec(ctx,
			`INSERT INTO schema_migrations (version, name) VALUES ($1, $2)`, m.version, m.name); err != nil {
			_ = tx.Rollback(ctx)
			// 另一个实例并发应用了同一迁移，视为成功。
			if isUniqueViolation(err) {
				continue
			}
			return err
		}
		if err := tx.Commit(ctx); err != nil {
			return err
		}
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
