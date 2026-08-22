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
	{
		version: 4,
		name:    "contest_team_avatar",
		stmts: []string{
			// 队伍头像：data 目录下的相对路径（如 avatars/c1_t1_1710000000.png），空 = 未上传
			`ALTER TABLE contest_teams ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`,
		},
	},
	{
		version: 5,
		name:    "problem_status_testcase_manifest_contest_meta",
		stmts: []string{
			// ---- 题目状态：draft | published | disabled ----
			`ALTER TABLE problems ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published'`,
			// ---- 测试点 manifest：分值/编号稳定关联的权威来源 ----
			// ordinal 为稳定编号（删除后留空档不重排），分值永远跟随 ordinal；
			// 数据文件仍为 {DataDir}/problems/{id}/tests/{ordinal}.in/.out。
			// problems.testcase_scores 自本迁移起弃用（仅回填时读取一次）。
			`CREATE TABLE IF NOT EXISTS problem_testcases (
				problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
				ordinal    INTEGER NOT NULL,
				score      INTEGER NOT NULL DEFAULT 0,
				size_bytes BIGINT  NOT NULL DEFAULT 0,
				input_sha  TEXT NOT NULL DEFAULT '',
				output_sha TEXT NOT NULL DEFAULT '',
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (problem_id, ordinal)
			)`,
			// ---- 比赛元信息：说明/可见性/报名时间窗/默认提交上限 ----
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`,
			// visibility: public | private（private 不出现在公开列表，需报名或管理员可访问）
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'`,
			// 报名时间窗；NULL = 随比赛时间窗（reg_start=start_time, reg_end=end_time）
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS reg_start_time TIMESTAMPTZ`,
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS reg_end_time TIMESTAMPTZ`,
			// 比赛默认单题提交上限（0 = 不限）；单题覆盖见 contest_problems.submission_limit
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS submission_limit INTEGER NOT NULL DEFAULT 0`,
			// ---- 比赛题目：单题分值覆盖 + 单题提交上限覆盖 ----
			// score: NULL = 用题目 manifest 总分；submission_limit: NULL = 继承比赛默认，0 = 不限
			`ALTER TABLE contest_problems ADD COLUMN IF NOT EXISTS score INTEGER`,
			`ALTER TABLE contest_problems ADD COLUMN IF NOT EXISTS submission_limit INTEGER`,
			// ---- 总览统计索引：避免对全部比赛提交逐条扫描 ----
			`CREATE INDEX IF NOT EXISTS idx_submissions_contest_problem_user ON submissions (contest_id, problem_id, user_id)`,
			`CREATE INDEX IF NOT EXISTS idx_submissions_contest_status ON submissions (contest_id, status)`,
		},
	},
	{
		version: 6,
		name:    "contest_overview_user_index",
		stmts: []string{
			// 总览/我的提交按 (contest_id, user_id) 查询的覆盖索引
			`CREATE INDEX IF NOT EXISTS idx_submissions_contest_user ON submissions (contest_id, user_id, id DESC)`,
		},
	},
	{
		version: 7,
		name:    "user_avatar",
		stmts: []string{
			`ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar TEXT NOT NULL DEFAULT ''`,
		},
	},
	{
		version: 8,
		name:    "contest_communications",
		stmts: []string{
			`CREATE TABLE IF NOT EXISTS contest_announcements (
				id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				contest_id  BIGINT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
				author_id   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
				title       TEXT NOT NULL DEFAULT '',
				content     TEXT NOT NULL,
				pinned      BOOLEAN NOT NULL DEFAULT false,
				created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_contest_announcements_contest ON contest_announcements (contest_id, pinned DESC, created_at DESC)`,
			`CREATE TABLE IF NOT EXISTS contest_questions (
				id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				contest_id    BIGINT NOT NULL REFERENCES contests(id) ON DELETE CASCADE,
				asker_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				content       TEXT NOT NULL,
				answer        TEXT NOT NULL DEFAULT '',
				answerer_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
				public        BOOLEAN NOT NULL DEFAULT false,
				asked_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
				answered_at   TIMESTAMPTZ
			)`,
			`CREATE INDEX IF NOT EXISTS idx_contest_questions_contest ON contest_questions (contest_id, asked_at DESC)`,
			`CREATE INDEX IF NOT EXISTS idx_contest_questions_asker ON contest_questions (asker_id, asked_at DESC)`,
		},
	},
	{
		version: 9,
		name:    "difficulty_levels_and_ranking_index",
		stmts: []string{
			// 旧系统允许 1-10；新九级体系保留 1-9，仅将历史最高档 10 合并为 Limit。
			`UPDATE problems SET difficulty = 9 WHERE difficulty > 9`,
			`UPDATE problems SET difficulty = 1 WHERE difficulty < 1`,
			`ALTER TABLE problems DROP CONSTRAINT IF EXISTS problems_difficulty_check`,
			`ALTER TABLE problems ADD CONSTRAINT problems_difficulty_check CHECK (difficulty BETWEEN 1 AND 9)`,
			// 全站排名按用户、题目和终态聚合；此索引避免提交量增长后重复全表排序。
			`CREATE INDEX IF NOT EXISTS idx_submissions_ranking ON submissions (user_id, problem_id, status, created_at, id)`,
		},
	},
	{
		version: 10,
		name:    "teaching_workspace",
		stmts: []string{
			// 旧 user 角色统一迁移为 student；保留应用层对旧值的兼容判断。
			`UPDATE users SET role = 'student' WHERE role = 'user'`,
			`ALTER TABLE users ADD COLUMN IF NOT EXISTS disabled BOOLEAN NOT NULL DEFAULT false`,
			`CREATE INDEX IF NOT EXISTS idx_users_role_created ON users (role, created_at DESC)`,
			`CREATE TABLE IF NOT EXISTS groups (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				name TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				owner_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_groups_owner ON groups (owner_id, created_at DESC)`,
			`CREATE TABLE IF NOT EXISTS group_members (
				group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
				user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				member_role TEXT NOT NULL DEFAULT 'student',
				joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (group_id, user_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_group_members_user ON group_members (user_id, joined_at DESC)`,
			`CREATE TABLE IF NOT EXISTS assignments (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				group_id BIGINT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
				creator_id BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
				title TEXT NOT NULL,
				description TEXT NOT NULL DEFAULT '',
				kind TEXT NOT NULL DEFAULT 'assignment',
				start_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				due_at TIMESTAMPTZ,
				published BOOLEAN NOT NULL DEFAULT false,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_assignments_group ON assignments (group_id, start_at DESC)`,
			`CREATE TABLE IF NOT EXISTS assignment_problems (
				assignment_id BIGINT NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
				problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE RESTRICT,
				sort_order INTEGER NOT NULL DEFAULT 0,
				max_score INTEGER NOT NULL DEFAULT 100,
				PRIMARY KEY (assignment_id, problem_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_assignment_problems_problem ON assignment_problems (problem_id)`,
			`ALTER TABLE submissions ADD COLUMN IF NOT EXISTS assignment_id BIGINT REFERENCES assignments(id) ON DELETE SET NULL`,
			`CREATE INDEX IF NOT EXISTS idx_submissions_assignment_user ON submissions (assignment_id, user_id, problem_id, status, score)`,
		},
	},
	{
		version: 11,
		name:    "problem_learning_tools",
		stmts: []string{
			`CREATE TABLE IF NOT EXISTS problem_favorites (
				user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (user_id, problem_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_problem_favorites_user ON problem_favorites (user_id, created_at DESC)`,
			`CREATE TABLE IF NOT EXISTS problem_discussions (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				problem_id BIGINT NOT NULL REFERENCES problems(id) ON DELETE CASCADE,
				user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				content TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE INDEX IF NOT EXISTS idx_problem_discussions_problem ON problem_discussions (problem_id, created_at DESC)`,
			`CREATE TABLE IF NOT EXISTS problem_editorials (
				problem_id BIGINT PRIMARY KEY REFERENCES problems(id) ON DELETE CASCADE,
				content TEXT NOT NULL DEFAULT '',
				updated_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
				updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
		},
	},
	{
		version: 12,
		name:    "site_notifications",
		stmts: []string{
			`CREATE TABLE IF NOT EXISTS notifications (
				id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
				recipient_id BIGINT REFERENCES users(id) ON DELETE CASCADE,
				author_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
				kind TEXT NOT NULL DEFAULT 'system',
				title TEXT NOT NULL,
				content TEXT NOT NULL,
				created_at TIMESTAMPTZ NOT NULL DEFAULT now()
			)`,
			`CREATE TABLE IF NOT EXISTS notification_reads (
				notification_id BIGINT NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
				user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				read_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (notification_id, user_id)
			)`,
			`CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON notifications (recipient_id, created_at DESC)`,
		},
	},
	{
		version: 13,
		name:    "contest_registration_theme",
		stmts: []string{
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS registration_mode TEXT NOT NULL DEFAULT 'both'`,
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS max_team_size INTEGER NOT NULL DEFAULT 1`,
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS allow_team_edit BOOLEAN NOT NULL DEFAULT true`,
			`ALTER TABLE contest_problems ADD COLUMN IF NOT EXISTS theme_color TEXT NOT NULL DEFAULT ''`,
			`CREATE TABLE IF NOT EXISTS contest_team_members (

				contest_id BIGINT NOT NULL,
				team_id BIGINT NOT NULL,
				user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
				is_captain BOOLEAN NOT NULL DEFAULT false,
				joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
				PRIMARY KEY (contest_id, team_id, user_id),
				FOREIGN KEY (contest_id, team_id) REFERENCES contest_teams(contest_id, team_id) ON DELETE CASCADE
			)`,
			`CREATE UNIQUE INDEX IF NOT EXISTS idx_contest_team_members_user ON contest_team_members (contest_id, user_id)`,
			`INSERT INTO contest_team_members (contest_id, team_id, user_id, is_captain)
			 SELECT contest_id, team_id, team_id, true FROM contest_teams
			 ON CONFLICT DO NOTHING`,
			`CREATE INDEX IF NOT EXISTS idx_contest_team_members_team ON contest_team_members (contest_id, team_id, joined_at)`,
		},
	},
	{
		version: 14,
		name:    "contest_cover_image",
		stmts: []string{
			`ALTER TABLE contests ADD COLUMN IF NOT EXISTS cover_image TEXT NOT NULL DEFAULT ''`,
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
