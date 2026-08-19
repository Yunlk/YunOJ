package store

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

// testStore 连接测试数据库；不可用时跳过（CI/无数据库环境）。
// 默认连接本地开发库，可用 TEST_DATABASE_URL 覆盖。
func testStore(t *testing.T) *Store {
	t.Helper()
	url := os.Getenv("TEST_DATABASE_URL")
	if url == "" {
		url = "postgres://yunoj:yunoj@localhost:5432/yunoj?sslmode=disable"
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	st, err := New(ctx, url)
	if err != nil {
		t.Skipf("跳过（数据库不可用）: %v", err)
	}
	t.Cleanup(st.Close)
	// 保证迁移已应用（幂等），并顺带验证可重复执行
	if err := model.Migrate(ctx, st.Pool()); err != nil {
		t.Fatalf("迁移失败: %v", err)
	}
	return st
}

func createTestProblem(t *testing.T, st *Store, status string) *model.Problem {
	t.Helper()
	if status == "" {
		status = model.ProblemStatusPublished
	}
	p := &model.Problem{
		Title:       "store 测试题目 " + strconv.FormatInt(time.Now().UnixNano(), 10),
		TimeLimitMs: 1000, MemoryLimitKb: 262144, Difficulty: 1,
		Tags: []string{}, Samples: []model.Sample{}, TestcaseScores: []int{},
		Type: model.ProblemTypeStandard, Status: status,
	}
	if err := st.CreateProblem(context.Background(), p); err != nil {
		t.Fatalf("创建测试题目失败: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DeleteProblem(context.Background(), p.ID)
	})
	return p
}

func createTestContest(t *testing.T, st *Store) *model.Contest {
	t.Helper()
	now := time.Now().UTC().Truncate(time.Microsecond)
	c := &model.Contest{
		Title: "store 测试比赛 " + strconv.FormatInt(time.Now().UnixNano(), 10),
		Mode:  model.ContestModeACM, Feedback: model.FeedbackRealtime,
		ScoreMode: model.ScoreModeAllOrNothing, PenaltyMinutes: 20,
		RankKeys:  []string{},
		StartTime: now.Add(time.Hour), EndTime: now.Add(2 * time.Hour),
		Visibility: model.ContestVisibilityPublic,
	}
	if err := st.CreateContest(context.Background(), c); err != nil {
		t.Fatalf("创建测试比赛失败: %v", err)
	}
	t.Cleanup(func() {
		_ = st.DeleteContest(context.Background(), c.ID)
	})
	return c
}

// writeTestFiles 在临时 dataDir 下写 {ordinal}.in/.out 测试文件。
func writeTestFiles(t *testing.T, dataDir string, problemID int64, pairs map[int]string) {
	t.Helper()
	td := filepath.Join(dataDir, "problems", strconv.FormatInt(problemID, 10), "tests")
	if err := os.MkdirAll(td, 0o755); err != nil {
		t.Fatalf("创建测试目录失败: %v", err)
	}
	for ordinal, content := range pairs {
		in := filepath.Join(td, strconv.Itoa(ordinal)+".in")
		out := filepath.Join(td, strconv.Itoa(ordinal)+".out")
		if err := os.WriteFile(in, []byte(content+"-in"), 0o644); err != nil {
			t.Fatalf("写 %s 失败: %v", in, err)
		}
		if err := os.WriteFile(out, []byte(content+"-out"), 0o644); err != nil {
			t.Fatalf("写 %s 失败: %v", out, err)
		}
	}
}

// ---------- 迁移 ----------

func TestMigrateIdempotent(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	var maxVersion int
	if err := st.pool.QueryRow(ctx,
		`SELECT coalesce(max(version), 0) FROM schema_migrations`).Scan(&maxVersion); err != nil {
		t.Fatalf("查询迁移版本失败: %v", err)
	}
	if maxVersion < 5 {
		t.Fatalf("期望至少迁移到版本 5，实际 %d", maxVersion)
	}
	// 重复执行不应报错
	if err := model.Migrate(ctx, st.Pool()); err != nil {
		t.Fatalf("重复迁移失败: %v", err)
	}
}

// ---------- 测试点 manifest ----------

func TestBackfillTestcasesScoresAligned(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p := createTestProblem(t, st, model.ProblemStatusPublished)
	p.TestcaseScores = []int{30, 70}
	if err := st.UpdateProblem(ctx, p); err != nil {
		t.Fatalf("更新分值失败: %v", err)
	}

	dir := t.TempDir()
	writeTestFiles(t, dir, p.ID, map[int]string{1: "a", 2: "b"})

	n, err := st.BackfillTestcases(ctx, dir)
	if err != nil {
		t.Fatalf("回填失败: %v", err)
	}
	if n < 1 {
		t.Fatalf("期望至少回填 1 道题，实际 %d", n)
	}
	cases, err := st.ListTestcases(ctx, p.ID)
	if err != nil {
		t.Fatalf("查询 manifest 失败: %v", err)
	}
	if len(cases) != 2 {
		t.Fatalf("期望 2 个测试点，实际 %d", len(cases))
	}
	if cases[0].Ordinal != 1 || cases[0].Score != 30 {
		t.Errorf("测试点 1 期望 ordinal=1 score=30，实际 %+v", cases[0])
	}
	if cases[1].Ordinal != 2 || cases[1].Score != 70 {
		t.Errorf("测试点 2 期望 ordinal=2 score=70，实际 %+v", cases[1])
	}
	if cases[0].SizeBytes <= 0 || cases[0].InputSHA == "" || cases[0].OutputSHA == "" {
		t.Errorf("测试点应记录大小与摘要，实际 %+v", cases[0])
	}

	// 幂等：重复回填不产生新记录
	if _, err := st.BackfillTestcases(ctx, dir); err != nil {
		t.Fatalf("重复回填失败: %v", err)
	}
	cases2, err := st.ListTestcases(ctx, p.ID)
	if err != nil {
		t.Fatalf("查询 manifest 失败: %v", err)
	}
	if len(cases2) != 2 {
		t.Fatalf("重复回填后应仍为 2 个测试点，实际 %d", len(cases2))
	}
}

func TestBackfillTestcasesEvenSplit(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p := createTestProblem(t, st, model.ProblemStatusPublished)

	dir := t.TempDir()
	writeTestFiles(t, dir, p.ID, map[int]string{1: "a", 2: "b", 3: "c", 4: "d"})

	if _, err := st.BackfillTestcases(ctx, dir); err != nil {
		t.Fatalf("回填失败: %v", err)
	}
	cases, err := st.ListTestcases(ctx, p.ID)
	if err != nil {
		t.Fatalf("查询 manifest 失败: %v", err)
	}
	if len(cases) != 4 {
		t.Fatalf("期望 4 个测试点，实际 %d", len(cases))
	}
	total := 0
	for _, c := range cases {
		if c.Score != 25 {
			t.Errorf("未配置分值时 4 个测试点应各 25 分，实际 ordinal=%d score=%d", c.Ordinal, c.Score)
		}
		total += c.Score
	}
	if total != 100 {
		t.Errorf("总分应恰好 100，实际 %d", total)
	}
}

func TestTestcaseUpsertAndDeleteKeepsOrdinals(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p := createTestProblem(t, st, model.ProblemStatusPublished)

	for _, tc := range []model.ProblemTestCase{
		{ProblemID: p.ID, Ordinal: 5, Score: 40},
		{ProblemID: p.ID, Ordinal: 7, Score: 60},
	} {
		if err := st.UpsertTestcase(ctx, tc); err != nil {
			t.Fatalf("插入测试点 %d 失败: %v", tc.Ordinal, err)
		}
	}
	// 更新分值
	if err := st.UpsertTestcase(ctx, model.ProblemTestCase{ProblemID: p.ID, Ordinal: 5, Score: 50}); err != nil {
		t.Fatalf("更新测试点失败: %v", err)
	}
	// 删除 ordinal 5：ordinal 7 必须保留原位（分值不随删除错位）
	if err := st.DeleteTestcase(ctx, p.ID, 5); err != nil {
		t.Fatalf("删除测试点失败: %v", err)
	}
	cases, err := st.ListTestcases(ctx, p.ID)
	if err != nil {
		t.Fatalf("查询 manifest 失败: %v", err)
	}
	if len(cases) != 1 || cases[0].Ordinal != 7 || cases[0].Score != 60 {
		t.Fatalf("删除后应仅剩 ordinal=7 score=60，实际 %+v", cases)
	}
}

func TestReplaceAllTestcases(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p := createTestProblem(t, st, model.ProblemStatusPublished)

	first := []model.ProblemTestCase{
		{Ordinal: 1, Score: 90},
		{Ordinal: 2, Score: 10},
	}
	if err := st.ReplaceAllTestcases(ctx, p.ID, first); err != nil {
		t.Fatalf("首次替换失败: %v", err)
	}
	second := []model.ProblemTestCase{
		{Ordinal: 1, Score: 100},
	}
	if err := st.ReplaceAllTestcases(ctx, p.ID, second); err != nil {
		t.Fatalf("二次替换失败: %v", err)
	}
	cases, err := st.ListTestcases(ctx, p.ID)
	if err != nil {
		t.Fatalf("查询 manifest 失败: %v", err)
	}
	if len(cases) != 1 || cases[0].Ordinal != 1 || cases[0].Score != 100 {
		t.Fatalf("替换后应仅剩 ordinal=1 score=100，实际 %+v", cases)
	}
}

// ---------- 题目引用统计 ----------

func TestProblemUsage(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p := createTestProblem(t, st, model.ProblemStatusPublished)
	c := createTestContest(t, st)

	if err := st.AddContestProblem(ctx, model.ContestProblem{
		ContestID: c.ID, ProblemID: p.ID, DisplayID: "A", SortOrder: 1,
	}); err != nil {
		t.Fatalf("添加比赛题目失败: %v", err)
	}
	refs, subs, err := st.ProblemUsage(ctx, p.ID)
	if err != nil {
		t.Fatalf("统计引用失败: %v", err)
	}
	if len(refs) != 1 || refs[0].ContestID != c.ID || refs[0].Title != c.Title {
		t.Fatalf("期望引用 1 场比赛 %d(%s)，实际 %+v", c.ID, c.Title, refs)
	}
	if subs != 0 {
		t.Fatalf("新题目提交数应为 0，实际 %d", subs)
	}
}

// ---------- 比赛新字段 ----------

func TestContestRoundtripNewFields(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	c := createTestContest(t, st)

	regStart := c.StartTime.Add(-30 * time.Minute)
	regEnd := c.EndTime
	regStart = regStart.UTC().Truncate(time.Microsecond)
	regEnd = regEnd.UTC().Truncate(time.Microsecond)

	c.Description = "比赛说明 Markdown"
	c.Visibility = model.ContestVisibilityPrivate
	c.RegStartTime = &regStart
	c.RegEndTime = &regEnd
	c.SubmissionLimit = 3
	if err := st.UpdateContest(ctx, c); err != nil {
		t.Fatalf("更新比赛失败: %v", err)
	}

	got, err := st.GetContest(ctx, c.ID)
	if err != nil {
		t.Fatalf("查询比赛失败: %v", err)
	}
	if got.Description != "比赛说明 Markdown" || got.Visibility != model.ContestVisibilityPrivate {
		t.Errorf("说明/可见性不匹配: %+v", got)
	}
	if got.SubmissionLimit != 3 {
		t.Errorf("默认提交上限应为 3，实际 %d", got.SubmissionLimit)
	}
	if got.RegStartTime == nil || got.RegEndTime == nil ||
		!got.RegStartTime.Equal(regStart) || !got.RegEndTime.Equal(regEnd) {
		t.Errorf("报名时间不匹配: start=%v end=%v", got.RegStartTime, got.RegEndTime)
	}
}

func TestContestProblemOverrides(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p := createTestProblem(t, st, model.ProblemStatusPublished)
	c := createTestContest(t, st)

	score := 50
	limit := 7
	if err := st.AddContestProblem(ctx, model.ContestProblem{
		ContestID: c.ID, ProblemID: p.ID, DisplayID: "P1", SortOrder: 1,
		Score: &score, SubmissionLimit: &limit,
	}); err != nil {
		t.Fatalf("添加比赛题目失败: %v", err)
	}
	cps, err := st.ListContestProblems(ctx, c.ID)
	if err != nil {
		t.Fatalf("查询比赛题目失败: %v", err)
	}
	if len(cps) != 1 {
		t.Fatalf("期望 1 道比赛题目，实际 %d", len(cps))
	}
	if cps[0].Score == nil || *cps[0].Score != 50 {
		t.Errorf("单题分值应为 50，实际 %v", cps[0].Score)
	}
	if cps[0].SubmissionLimit == nil || *cps[0].SubmissionLimit != 7 {
		t.Errorf("单题上限应为 7，实际 %v", cps[0].SubmissionLimit)
	}

	// 覆盖值为 nil 时（继承默认/不限）
	if err := st.AddContestProblem(ctx, model.ContestProblem{
		ContestID: c.ID, ProblemID: p.ID, DisplayID: "P1", SortOrder: 1,
	}); err != nil {
		t.Fatalf("更新比赛题目失败: %v", err)
	}
	cps, err = st.ListContestProblems(ctx, c.ID)
	if err != nil {
		t.Fatalf("查询比赛题目失败: %v", err)
	}
	if cps[0].Score != nil || cps[0].SubmissionLimit != nil {
		t.Errorf("nil 覆盖应保存为 NULL，实际 score=%v limit=%v", cps[0].Score, cps[0].SubmissionLimit)
	}
}

func TestReorderContestProblems(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	p1 := createTestProblem(t, st, model.ProblemStatusPublished)
	p2 := createTestProblem(t, st, model.ProblemStatusPublished)
	c := createTestContest(t, st)

	for i, pid := range []int64{p1.ID, p2.ID} {
		if err := st.AddContestProblem(ctx, model.ContestProblem{
			ContestID: c.ID, ProblemID: pid, DisplayID: strconv.Itoa(i + 1), SortOrder: i + 1,
		}); err != nil {
			t.Fatalf("添加比赛题目失败: %v", err)
		}
	}
	if err := st.ReorderContestProblems(ctx, c.ID, []int64{p2.ID, p1.ID}); err != nil {
		t.Fatalf("重排失败: %v", err)
	}
	cps, err := st.ListContestProblems(ctx, c.ID)
	if err != nil {
		t.Fatalf("查询比赛题目失败: %v", err)
	}
	if len(cps) != 2 || cps[0].ProblemID != p2.ID || cps[1].ProblemID != p1.ID {
		t.Fatalf("重排后顺序错误: %+v", cps)
	}
}

// ---------- 题目状态过滤 ----------

func TestProblemStatusFilter(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	draft := createTestProblem(t, st, model.ProblemStatusDraft)
	published := createTestProblem(t, st, model.ProblemStatusPublished)

	// 公共列表：不包含未发布题目
	pub, _, err := st.ListProblems(ctx, ProblemFilter{Page: 1, Size: 100})
	if err != nil {
		t.Fatalf("公共列表查询失败: %v", err)
	}
	for _, p := range pub {
		if p.ID == draft.ID {
			t.Fatalf("公共列表不应包含草稿题目 %d", draft.ID)
		}
	}
	foundPublished := false
	for _, p := range pub {
		if p.ID == published.ID {
			foundPublished = true
		}
	}
	if !foundPublished {
		t.Fatalf("公共列表应包含已发布题目 %d", published.ID)
	}

	// 管理员列表：包含草稿，且可按状态过滤
	all, _, err := st.ListProblems(ctx, ProblemFilter{Page: 1, Size: 100, IncludeUnpublished: true})
	if err != nil {
		t.Fatalf("全量列表查询失败: %v", err)
	}
	foundDraft := false
	for _, p := range all {
		if p.ID == draft.ID {
			foundDraft = true
		}
	}
	if !foundDraft {
		t.Fatalf("全量列表应包含草稿题目 %d", draft.ID)
	}

	only, total, err := st.ListProblems(ctx, ProblemFilter{
		Page: 1, Size: 100, IncludeUnpublished: true, Status: model.ProblemStatusDraft,
	})
	if err != nil {
		t.Fatalf("状态过滤查询失败: %v", err)
	}
	if total < 1 {
		t.Fatalf("按草稿过滤应至少返回 1 条，实际 %d", total)
	}
	for _, p := range only {
		if p.Status != model.ProblemStatusDraft {
			t.Errorf("过滤结果含非草稿题目: %+v", p)
		}
	}
}
