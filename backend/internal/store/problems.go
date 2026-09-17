package store

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"

	"github.com/jackc/pgx/v5"
	"github.com/yunoj/yunoj/internal/model"
)

// rowScanner 抽象 QueryRow 与 Rows 共有的 Scan 接口。
type rowScanner interface {
	Scan(dest ...any) error
}

// scanProblem 从一行结果中扫描出题目（samples/testcase_scores 为 JSONB 列）。
func scanProblem(row rowScanner) (model.Problem, error) {
	var p model.Problem
	var samples, scores []byte
	err := row.Scan(&p.ID, &p.Title, &p.Statement, &p.InputFormat, &p.OutputFormat,
		&p.Hint, &samples, &p.TimeLimitMs, &p.MemoryLimitKb, &p.Difficulty,
		&p.Tags, &p.AcceptedCount, &p.SubmissionCount,
		&p.Type, &p.CheckerMode, &p.SPJSource, &p.InteractorSource,
		&p.HackGeneratorSource, &p.HackReferenceSource, &p.HackTargetSource, &scores, &p.SubmissionLimit,
		&p.Status, &p.Provider, &p.ShowScore, &p.TestcaseCount, &p.AttachmentCount, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return model.Problem{}, err
	}
	if len(samples) > 0 {
		if err := json.Unmarshal(samples, &p.Samples); err != nil {
			return model.Problem{}, err
		}
	}
	if len(scores) > 0 {
		if err := json.Unmarshal(scores, &p.TestcaseScores); err != nil {
			return model.Problem{}, err
		}
	}
	return p, nil
}

const problemColumns = `id, title, statement, input_format, output_format,
	hint, samples, time_limit_ms, memory_limit_kb, difficulty, tags,
	accepted_count, submission_count, type, checker_mode, spj_source, interactor_source,
	hack_generator_source, hack_reference_source, hack_target_source, testcase_scores, submission_limit, status,
	provider, show_score,
	(SELECT count(*) FROM problem_testcases pt WHERE pt.problem_id = problems.id) AS testcase_count,
	(SELECT count(*) FROM problem_attachments pa WHERE pa.problem_id = problems.id) AS attachment_count,
	created_at, updated_at`

// ProblemFilter 题目列表过滤条件。字段为 nil/空表示不过滤。
type ProblemFilter struct {
	Keyword    string
	Difficulty *int
	// Difficulties 多选难度；非空时覆盖 Difficulty。
	Difficulties []int
	Tag          string
	// Tags 多选标签（任一命中即保留）；非空时覆盖 Tag。
	Tags []string
	Type string
	// Status 题目自身的发布状态（管理员筛选用）。
	Status string
	// MyStatus 当前用户对该题的作答状态：todo / attempted / accepted。
	// 需要同时提供 UserID。
	MyStatus string
	// UserID 用于 MyStatus 过滤的当前用户；为 0 表示未登录。
	UserID int64
	// Sort 排序方式：id / difficulty / difficulty_desc / acceptance / newest / submissions。
	Sort               string
	IncludeUnpublished bool // 是否包含未发布（draft/disabled）题目（管理员列表用）
	Page               int
	Size               int
}

// problemOrderBy 把排序键映射成固定 SQL，避免拼接外部输入。
func problemOrderBy(sort string) string {
	switch sort {
	case "difficulty":
		return " ORDER BY difficulty ASC, id ASC"
	case "difficulty_desc":
		return " ORDER BY difficulty DESC, id ASC"
	case "acceptance":
		// 通过率降序：无提交的题目排在最后
		return " ORDER BY (accepted_count::float / GREATEST(submission_count, 1)) DESC, submission_count DESC, id ASC"
	case "newest":
		return " ORDER BY created_at DESC, id DESC"
	case "submissions":
		return " ORDER BY submission_count DESC, id ASC"
	case "recent":
		// 真实排序由 ListProblems 拼装（需要当前用户 ID）；这里给一个稳定回退
		return " ORDER BY id ASC"
	default:
		return " ORDER BY id ASC"
	}
}

// ListProblems 分页列出题目，支持标题/难度/标签/题型/状态/我的作答状态过滤与排序。
// 默认仅返回 published；IncludeUnpublished=true 时返回全部状态。
func (s *Store) ListProblems(ctx context.Context, f ProblemFilter) ([]model.Problem, int64, error) {
	conds := []string{}
	args := []any{}
	if f.Keyword != "" {
		args = append(args, "%"+strings.ToLower(f.Keyword)+"%")
		conds = append(conds, fmt.Sprintf("title ILIKE $%d", len(args)))
	}
	if len(f.Difficulties) > 0 {
		args = append(args, f.Difficulties)
		conds = append(conds, fmt.Sprintf("difficulty = ANY($%d)", len(args)))
	} else if f.Difficulty != nil {
		args = append(args, *f.Difficulty)
		conds = append(conds, fmt.Sprintf("difficulty = $%d", len(args)))
	}
	if len(f.Tags) > 0 {
		args = append(args, f.Tags)
		conds = append(conds, fmt.Sprintf("tags && $%d", len(args)))
	} else if f.Tag != "" {
		args = append(args, f.Tag)
		conds = append(conds, fmt.Sprintf("$%d = ANY(tags)", len(args)))
	}
	if f.Type != "" {
		args = append(args, f.Type)
		conds = append(conds, fmt.Sprintf("type = $%d", len(args)))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		conds = append(conds, fmt.Sprintf("status = $%d", len(args)))
	}
	if !f.IncludeUnpublished {
		conds = append(conds, "status = 'published'")
	}
	// 我的作答状态：以当前用户是否 AC / 是否有提交判定
	if f.MyStatus != "" && f.UserID > 0 {
		args = append(args, f.UserID)
		uid := fmt.Sprintf("$%d", len(args))
		accepted := fmt.Sprintf(
			"EXISTS (SELECT 1 FROM submissions s WHERE s.problem_id = problems.id AND s.user_id = %s AND s.status = 'accepted')", uid)
		attempted := fmt.Sprintf(
			"EXISTS (SELECT 1 FROM submissions s WHERE s.problem_id = problems.id AND s.user_id = %s)", uid)
		switch f.MyStatus {
		case "accepted":
			conds = append(conds, accepted)
		case "attempted":
			conds = append(conds, attempted+" AND NOT "+accepted)
		case "todo":
			conds = append(conds, "NOT "+attempted)
		}
	}
	where := ""
	if len(conds) > 0 {
		where = "WHERE " + strings.Join(conds, " AND ")
	}

	var total int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM problems `+where, args...).Scan(&total); err != nil {
		return nil, 0, err
	}

	// 排序：recent 需要当前用户 ID 参与 ORDER BY，因此单独拼接（其余排序键走白名单映射）
	orderBy := problemOrderBy(f.Sort)
	if f.Sort == "recent" && f.UserID > 0 {
		args = append(args, f.UserID)
		orderBy = fmt.Sprintf(
			" ORDER BY (SELECT max(s.created_at) FROM submissions s WHERE s.problem_id = problems.id AND s.user_id = $%d) DESC NULLS LAST, id ASC",
			len(args))
	}

	args = append(args, f.Size, (f.Page-1)*f.Size)
	query := `SELECT ` + problemColumns + ` FROM problems ` + where + orderBy +
		` LIMIT $` + strconv.Itoa(len(args)-1) + ` OFFSET $` + strconv.Itoa(len(args))
	rows, err := s.pool.Query(ctx, query, args...)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()

	items := make([]model.Problem, 0, f.Size)
	for rows.Next() {
		p, err := scanProblem(rows)
		if err != nil {
			return nil, 0, err
		}
		items = append(items, p)
	}
	return items, total, rows.Err()
}

// ---------- 题库筛选项统计 ----------

// DifficultyFacet 单个难度的题目总数与当前用户已解决数。
type DifficultyFacet struct {
	Difficulty int   `json:"difficulty"`
	Total      int64 `json:"total"`
	Solved     int64 `json:"solved"`
}

// TagFacet 标签及其题目数量。
type TagFacet struct {
	Tag   string `json:"tag"`
	Count int64  `json:"count"`
}

// ProblemFacets 题库页需要的聚合数据：总题数、已解决数、难度分布与标签频次。
type ProblemFacets struct {
	Total        int64             `json:"total"`
	Solved       int64             `json:"solved"`
	Difficulties []DifficultyFacet `json:"difficulties"`
	Tags         []TagFacet        `json:"tags"`
}

// ProblemFacets 统计已发布题目的难度分布、标签频次，以及指定用户（0 表示未登录）的解题进度。
func (s *Store) ProblemFacets(ctx context.Context, userID int64) (ProblemFacets, error) {
	out := ProblemFacets{Difficulties: []DifficultyFacet{}, Tags: []TagFacet{}}

	rows, err := s.pool.Query(ctx,
		`SELECT difficulty, count(*) FROM problems WHERE status = 'published'
		 GROUP BY difficulty ORDER BY difficulty`)
	if err != nil {
		return out, err
	}
	byDifficulty := map[int]*DifficultyFacet{}
	for rows.Next() {
		var d int
		var c int64
		if err := rows.Scan(&d, &c); err != nil {
			rows.Close()
			return out, err
		}
		out.Total += c
		byDifficulty[d] = &DifficultyFacet{Difficulty: d, Total: c}
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return out, err
	}

	if userID > 0 {
		srows, err := s.pool.Query(ctx,
			`SELECT p.difficulty, count(DISTINCT p.id)
			 FROM problems p
			 JOIN submissions s ON s.problem_id = p.id AND s.user_id = $1 AND s.status = 'accepted'
			 WHERE p.status = 'published'
			 GROUP BY p.difficulty`, userID)
		if err != nil {
			return out, err
		}
		for srows.Next() {
			var d int
			var c int64
			if err := srows.Scan(&d, &c); err != nil {
				srows.Close()
				return out, err
			}
			out.Solved += c
			if f, ok := byDifficulty[d]; ok {
				f.Solved = c
			}
		}
		srows.Close()
		if err := srows.Err(); err != nil {
			return out, err
		}
	}

	for d := model.MinDifficulty; d <= model.MaxDifficulty; d++ {
		if f, ok := byDifficulty[d]; ok {
			out.Difficulties = append(out.Difficulties, *f)
			continue
		}
		out.Difficulties = append(out.Difficulties, DifficultyFacet{Difficulty: d})
	}

	trows, err := s.pool.Query(ctx,
		`SELECT t.tag, count(*) AS c
		 FROM problems p, unnest(p.tags) AS t(tag)
		 WHERE p.status = 'published'
		 GROUP BY t.tag ORDER BY c DESC, t.tag ASC LIMIT 80`)
	if err != nil {
		return out, err
	}
	defer trows.Close()
	for trows.Next() {
		var f TagFacet
		if err := trows.Scan(&f.Tag, &f.Count); err != nil {
			return out, err
		}
		out.Tags = append(out.Tags, f)
	}
	return out, trows.Err()
}

// NeighborProblems 返回按题号相邻的已发布题目 ID（0 表示没有）。
// 刷题时「上一题 / 下一题」是最高频动作，前端不应为此拉整张题目表。
func (s *Store) NeighborProblems(ctx context.Context, id int64) (prev, next int64, err error) {
	err = s.pool.QueryRow(ctx,
		`SELECT COALESCE((SELECT id FROM problems WHERE status = 'published' AND id < $1 ORDER BY id DESC LIMIT 1), 0),
		        COALESCE((SELECT id FROM problems WHERE status = 'published' AND id > $1 ORDER BY id LIMIT 1), 0)`,
		id).Scan(&prev, &next)
	return prev, next, err
}

// GetProblem 按 ID 查询题目。
func (s *Store) GetProblem(ctx context.Context, id int64) (model.Problem, error) {
	row := s.pool.QueryRow(ctx, `SELECT `+problemColumns+` FROM problems WHERE id = $1`, id)
	p, err := scanProblem(row)
	if errors.Is(err, pgx.ErrNoRows) {
		return model.Problem{}, ErrNotFound
	}
	return p, err
}

// CreateProblem 创建题目，成功后填充 ID/CreatedAt/UpdatedAt。
func (s *Store) CreateProblem(ctx context.Context, p *model.Problem) error {
	if p.CheckerMode == "" {
		p.CheckerMode = model.CheckerModeToken
	}
	samples, err := json.Marshal(p.Samples)
	if err != nil {
		return err
	}
	scores, err := json.Marshal(p.TestcaseScores)
	if err != nil {
		return err
	}
	return s.pool.QueryRow(ctx,
		`INSERT INTO problems (title, statement, input_format, output_format, hint,
			samples, time_limit_ms, memory_limit_kb, difficulty, tags,
		type, checker_mode, spj_source, interactor_source, hack_generator_source, hack_reference_source, hack_target_source,
			testcase_scores, submission_limit, status, provider, show_score)
			 VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10,
			$11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22)
			 RETURNING id, created_at, updated_at`,
		p.Title, p.Statement, p.InputFormat, p.OutputFormat, p.Hint,
		string(samples), p.TimeLimitMs, p.MemoryLimitKb, p.Difficulty, p.Tags,
		p.Type, p.CheckerMode, p.SPJSource, p.InteractorSource,
		p.HackGeneratorSource, p.HackReferenceSource, p.HackTargetSource, string(scores), p.SubmissionLimit, p.Status,
		p.Provider, p.ShowScore,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
}

// UpdateProblem 全量更新题目。题目不存在时返回 ErrNotFound。
func (s *Store) UpdateProblem(ctx context.Context, p *model.Problem) error {
	if p.CheckerMode == "" {
		p.CheckerMode = model.CheckerModeToken
	}
	samples, err := json.Marshal(p.Samples)
	if err != nil {
		return err
	}
	scores, err := json.Marshal(p.TestcaseScores)
	if err != nil {
		return err
	}
	ct, err := s.pool.Exec(ctx,
		`UPDATE problems SET
			title = $2, statement = $3, input_format = $4, output_format = $5,
			hint = $6, samples = $7::jsonb, time_limit_ms = $8, memory_limit_kb = $9,
			difficulty = $10, tags = $11, type = $12, checker_mode = $13,
			spj_source = $14, interactor_source = $15, hack_generator_source = $16,
			hack_reference_source = $17, hack_target_source = $18, testcase_scores = $19::jsonb,
			submission_limit = $20, status = $21, provider = $22, show_score = $23, updated_at = now()
		 WHERE id = $1`,
		p.ID, p.Title, p.Statement, p.InputFormat, p.OutputFormat, p.Hint,
		string(samples), p.TimeLimitMs, p.MemoryLimitKb, p.Difficulty, p.Tags,
		p.Type, p.CheckerMode, p.SPJSource, p.InteractorSource,
		p.HackGeneratorSource, p.HackReferenceSource, p.HackTargetSource, string(scores), p.SubmissionLimit, p.Status,
		p.Provider, p.ShowScore,
	)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// DeleteProblem 删除题目（级联删除其提交记录）。
func (s *Store) DeleteProblem(ctx context.Context, id int64) error {
	ct, err := s.pool.Exec(ctx, `DELETE FROM problems WHERE id = $1`, id)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// AddSubmission 更新题目的提交/通过计数。仅在首次评测时调用，
// 重测不会重复计数。
func (s *Store) AddSubmission(ctx context.Context, problemID int64, accepted bool) error {
	_, err := s.pool.Exec(ctx,
		`UPDATE problems SET
			submission_count = submission_count + 1,
			accepted_count = accepted_count + CASE WHEN $2 THEN 1 ELSE 0 END
		 WHERE id = $1`, problemID, accepted)
	return err
}

// UpdateProblemStatus 仅更新题目状态（草稿/发布/停用）。
func (s *Store) UpdateProblemStatus(ctx context.Context, id int64, status string) error {
	ct, err := s.pool.Exec(ctx,
		`UPDATE problems SET status = $2, updated_at = now() WHERE id = $1`, id, status)
	if err != nil {
		return err
	}
	if ct.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ContestRef 引用题目的比赛信息（删除题目前的影响范围提示）。
type ContestRef struct {
	ContestID int64
	Title     string
}

// ProblemUsage 统计题目的引用情况：被哪些比赛引用、有多少提交。
func (s *Store) ProblemUsage(ctx context.Context, problemID int64) ([]ContestRef, int64, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT c.id, c.title FROM contest_problems cp
		 JOIN contests c ON c.id = cp.contest_id
		 WHERE cp.problem_id = $1 ORDER BY c.id`, problemID)
	if err != nil {
		return nil, 0, err
	}
	defer rows.Close()
	refs := []ContestRef{}
	for rows.Next() {
		var r ContestRef
		if err := rows.Scan(&r.ContestID, &r.Title); err != nil {
			return nil, 0, err
		}
		refs = append(refs, r)
	}
	if err := rows.Err(); err != nil {
		return nil, 0, err
	}
	var subs int64
	if err := s.pool.QueryRow(ctx,
		`SELECT count(*) FROM submissions WHERE problem_id = $1`, problemID).Scan(&subs); err != nil {
		return nil, 0, err
	}
	return refs, subs, nil
}
