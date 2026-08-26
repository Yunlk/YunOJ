package store

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// CreateGroup 创建班级/团体，并自动把负责人加入成员表。
func (s *Store) CreateGroup(ctx context.Context, g *model.Group) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)
	if err := tx.QueryRow(ctx, `
		INSERT INTO groups (name, description, owner_id) VALUES ($1, $2, $3)
		RETURNING id, created_at, updated_at`, g.Name, g.Description, g.OwnerID).
		Scan(&g.ID, &g.CreatedAt, &g.UpdatedAt); err != nil {
		return err
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO group_members (group_id, user_id, member_role)
		VALUES ($1, $2, 'teacher') ON CONFLICT DO NOTHING`, g.ID, g.OwnerID); err != nil {
		return err
	}
	return tx.Commit(ctx)
}

// ListGroups 返回管理员/教师拥有的班级或当前学生加入的班级。
func (s *Store) ListGroups(ctx context.Context, userID int64, staff bool) ([]model.Group, error) {
	condition := `EXISTS (SELECT 1 FROM group_members gm WHERE gm.group_id = g.id AND gm.user_id = $1)`
	if staff {
		condition = `g.owner_id = $1 OR ` + condition
	}
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT g.id, g.name, g.description, g.owner_id, owner.username,
		       count(DISTINCT gm.user_id), g.created_at, g.updated_at
		FROM groups g
		JOIN users owner ON owner.id = g.owner_id
		LEFT JOIN group_members gm ON gm.group_id = g.id
		WHERE %s
		GROUP BY g.id, owner.username ORDER BY g.updated_at DESC`, condition), userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Group{}
	for rows.Next() {
		var g model.Group
		if err := rows.Scan(&g.ID, &g.Name, &g.Description, &g.OwnerID, &g.OwnerName,
			&g.MemberCount, &g.CreatedAt, &g.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, g)
	}
	return items, rows.Err()
}

// GetGroup 获取班级基本信息。
func (s *Store) GetGroup(ctx context.Context, id int64) (model.Group, error) {
	var g model.Group
	err := s.pool.QueryRow(ctx, `
		SELECT g.id, g.name, g.description, g.owner_id, owner.username,
		       (SELECT count(*) FROM group_members WHERE group_id = g.id),
		       g.created_at, g.updated_at
		FROM groups g JOIN users owner ON owner.id = g.owner_id WHERE g.id = $1`, id).
		Scan(&g.ID, &g.Name, &g.Description, &g.OwnerID, &g.OwnerName,
			&g.MemberCount, &g.CreatedAt, &g.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Group{}, ErrNotFound
	}
	return g, err
}

// IsGroupMember 判断用户是否属于班级。
func (s *Store) IsGroupMember(ctx context.Context, groupID, userID int64) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2)`, groupID, userID).Scan(&ok)
	return ok, err
}

// ListGroupMembers 列出班级成员。
func (s *Store) ListGroupMembers(ctx context.Context, groupID int64) ([]model.GroupMember, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT u.id, u.username, u.email, gm.member_role, gm.joined_at
		FROM group_members gm JOIN users u ON u.id = gm.user_id
		WHERE gm.group_id = $1 ORDER BY gm.member_role DESC, u.username`, groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.GroupMember{}
	for rows.Next() {
		var m model.GroupMember
		if err := rows.Scan(&m.UserID, &m.Username, &m.Email, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		items = append(items, m)
	}
	return items, rows.Err()
}

// UpdateGroup 更新班级资料。
func (s *Store) UpdateGroup(ctx context.Context, id int64, name, description string) error {
	ct, err := s.pool.Exec(ctx, `UPDATE groups SET name = $2, description = $3, updated_at = now() WHERE id = $1`, id, name, description)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddGroupMember 将用户加入班级。
func (s *Store) AddGroupMember(ctx context.Context, groupID, userID int64, role string) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO group_members (group_id, user_id, member_role)
		VALUES ($1, $2, $3)
		ON CONFLICT (group_id, user_id) DO UPDATE SET member_role = EXCLUDED.member_role`, groupID, userID, role)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

// RemoveGroupMember 移除班级成员，但不允许移除负责人。
func (s *Store) RemoveGroupMember(ctx context.Context, groupID, userID int64) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM group_members WHERE group_id = $1 AND user_id = $2 AND user_id <> (SELECT owner_id FROM groups WHERE id = $1)`, groupID, userID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// CreateAssignment 创建作业/测试。
func (s *Store) CreateAssignment(ctx context.Context, a *model.Assignment) error {
	return s.pool.QueryRow(ctx, `
		INSERT INTO assignments (group_id, creator_id, title, description, kind, start_at, due_at, published)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id, created_at, updated_at`, a.GroupID, a.CreatorID, a.Title, a.Description,
		a.Kind, a.StartAt, a.DueAt, a.Published).Scan(&a.ID, &a.CreatedAt, &a.UpdatedAt)
}

// UpdateAssignment 更新作业设置。
func (s *Store) UpdateAssignment(ctx context.Context, a *model.Assignment) error {
	ct, err := s.pool.Exec(ctx, `
		UPDATE assignments SET title = $2, description = $3, kind = $4,
		start_at = $5, due_at = $6, published = $7, updated_at = now()
		WHERE id = $1`, a.ID, a.Title, a.Description, a.Kind, a.StartAt, a.DueAt, a.Published)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// GetAssignment 获取作业详情。
func (s *Store) GetAssignment(ctx context.Context, id int64) (model.Assignment, error) {
	var a model.Assignment
	err := s.pool.QueryRow(ctx, `
		SELECT a.id, a.group_id, a.creator_id, a.title, a.description, a.kind,
		       a.start_at, a.due_at, a.published, u.username,
		       (SELECT count(*) FROM assignment_problems ap WHERE ap.assignment_id = a.id),
		       a.created_at, a.updated_at
		FROM assignments a JOIN users u ON u.id = a.creator_id WHERE a.id = $1`, id).
		Scan(&a.ID, &a.GroupID, &a.CreatorID, &a.Title, &a.Description, &a.Kind,
			&a.StartAt, &a.DueAt, &a.Published, &a.CreatorName, &a.ProblemCount,
			&a.CreatedAt, &a.UpdatedAt)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Assignment{}, ErrNotFound
	}
	return a, err
}

// ListAssignments 列出班级作业。
func (s *Store) ListAssignments(ctx context.Context, groupID int64, includeDraft bool) ([]model.Assignment, error) {
	condition := "a.group_id = $1"
	if !includeDraft {
		condition += " AND a.published = true"
	}
	rows, err := s.pool.Query(ctx, fmt.Sprintf(`
		SELECT a.id, a.group_id, a.creator_id, a.title, a.description, a.kind,
		       a.start_at, a.due_at, a.published, u.username,
		       (SELECT count(*) FROM assignment_problems ap WHERE ap.assignment_id = a.id),
		       a.created_at, a.updated_at
		FROM assignments a JOIN users u ON u.id = a.creator_id
		WHERE %s ORDER BY a.start_at DESC`, condition), groupID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.Assignment{}
	for rows.Next() {
		var a model.Assignment
		if err := rows.Scan(&a.ID, &a.GroupID, &a.CreatorID, &a.Title, &a.Description, &a.Kind,
			&a.StartAt, &a.DueAt, &a.Published, &a.CreatorName, &a.ProblemCount,
			&a.CreatedAt, &a.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, a)
	}
	return items, rows.Err()
}

// ListAssignmentProblems 列出作业内题目。
func (s *Store) ListAssignmentProblems(ctx context.Context, assignmentID int64) ([]model.AssignmentProblem, error) {
	rows, err := s.pool.Query(ctx, `
		SELECT ap.assignment_id, ap.problem_id, p.title, ap.sort_order, ap.max_score
		FROM assignment_problems ap JOIN problems p ON p.id = ap.problem_id
		WHERE ap.assignment_id = $1 ORDER BY ap.sort_order, ap.problem_id`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.AssignmentProblem{}
	for rows.Next() {
		var p model.AssignmentProblem
		if err := rows.Scan(&p.AssignmentID, &p.ProblemID, &p.Title, &p.SortOrder, &p.MaxScore); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// AddAssignmentProblem 添加作业内题目。
func (s *Store) AddAssignmentProblem(ctx context.Context, assignmentID, problemID int64, order, maxScore int) error {
	_, err := s.pool.Exec(ctx, `
		INSERT INTO assignment_problems (assignment_id, problem_id, sort_order, max_score)
		VALUES ($1, $2, $3, $4)
		ON CONFLICT (assignment_id, problem_id) DO UPDATE SET sort_order = EXCLUDED.sort_order, max_score = EXCLUDED.max_score`, assignmentID, problemID, order, maxScore)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	return err
}

// RemoveAssignmentProblem 移除作业内题目。
func (s *Store) RemoveAssignmentProblem(ctx context.Context, assignmentID, problemID int64) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM assignment_problems WHERE assignment_id = $1 AND problem_id = $2`, assignmentID, problemID)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AssignmentContainsProblem 判断题目是否属于作业。
func (s *Store) AssignmentContainsProblem(ctx context.Context, assignmentID, problemID int64) (bool, error) {
	var ok bool
	err := s.pool.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM assignment_problems WHERE assignment_id = $1 AND problem_id = $2)`, assignmentID, problemID).Scan(&ok)
	return ok, err
}

// ListAssignmentProgress 返回每个成员的最高分和已通过题数。
func (s *Store) ListAssignmentProgress(ctx context.Context, assignmentID int64) ([]model.AssignmentProgress, error) {
	rows, err := s.pool.Query(ctx, `
		WITH problem_totals AS (
			SELECT count(*)::bigint AS total, coalesce(sum(max_score), 0)::bigint AS max_score
			FROM assignment_problems WHERE assignment_id = $1
		), best AS (
			SELECT s.user_id, s.problem_id,
			       max(CASE
			         WHEN s.status = 'accepted' THEN ap.max_score
			         WHEN s.score > 0 THEN LEAST(ap.max_score, s.score)
			         ELSE 0
			       END)::bigint AS score
			FROM submissions s JOIN assignment_problems ap
			  ON ap.assignment_id = s.assignment_id AND ap.problem_id = s.problem_id
			WHERE s.assignment_id = $1 AND s.status NOT IN ('pending', 'running')
			GROUP BY s.user_id, s.problem_id
		)
		SELECT u.id, u.username, coalesce(sum(b.score), 0)::bigint,
		       count(*) FILTER (WHERE b.score > 0)::bigint,
		       pt.total, pt.max_score
		FROM group_members gm
		JOIN assignments a ON a.group_id = gm.group_id
		JOIN users u ON u.id = gm.user_id
		CROSS JOIN problem_totals pt
		LEFT JOIN best b ON b.user_id = u.id
		WHERE a.id = $1
		GROUP BY u.id, u.username, pt.total, pt.max_score
		ORDER BY sum(coalesce(b.score, 0)) DESC, u.username`, assignmentID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.AssignmentProgress{}
	for rows.Next() {
		var p model.AssignmentProgress
		if err := rows.Scan(&p.UserID, &p.Username, &p.BestScore, &p.Solved, &p.ProblemCount, &p.TotalScore); err != nil {
			return nil, err
		}
		items = append(items, p)
	}
	return items, rows.Err()
}

// CountEducationStats 返回首页教学相关计数。
func (s *Store) CountEducationStats(ctx context.Context) (groups, assignments int64, err error) {
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM groups`).Scan(&groups)
	if err != nil {
		return
	}
	err = s.pool.QueryRow(ctx, `SELECT count(*) FROM assignments WHERE published = true`).Scan(&assignments)
	return
}

// IsAssignmentOpen 判断学生当前是否可以提交作业。
func (s *Store) IsAssignmentOpen(ctx context.Context, assignmentID int64, now time.Time) (bool, error) {
	var published bool
	var start time.Time
	var due *time.Time
	err := s.pool.QueryRow(ctx, `SELECT published, start_at, due_at FROM assignments WHERE id = $1`, assignmentID).Scan(&published, &start, &due)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, ErrNotFound
	}
	if err != nil {
		return false, err
	}
	return published && !now.Before(start) && (due == nil || now.Before(*due)), nil
}

// ValidateAssignmentText 校验作业字段，供 API 共用。
func ValidateAssignmentText(title, description, kind string) string {
	if strings.TrimSpace(title) == "" || len([]rune(title)) > 128 {
		return "作业标题长度需在 1-128 字符之间"
	}
	if len(description) > 64<<10 {
		return "作业说明过长（最大 64KB）"
	}
	if kind != "assignment" && kind != "test" {
		return "作业类型只能是 assignment 或 test"
	}
	return ""
}
