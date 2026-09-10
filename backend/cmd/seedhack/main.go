// Command seedhack creates an idempotent Hack problem and a public contest
// that can be used to exercise the problem and contest pages end to end.
//
// Run from the repository root with:
//
//	go -C backend run ./cmd/seedhack
//
// The command talks to the configured PostgreSQL instance and writes test data
// under DATA_DIR. Existing records with the same titles are reused.
package main

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"time"

	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	problemTitle = "Hack 题 · 反转序列"
	contestTitle = "Hack 题挑战赛 · 反转序列"
)

const hackGeneratorSource = `#include <iostream>
using namespace std;

// 读取管理员准备的种子，并生成本轮输入。演示中直接透传种子；
// 实际题目可以在这里使用随机数生成器构造压力数据。
int main() {
    cout << cin.rdbuf();
    return cin.good() ? 0 : 1;
}`

const hackReferenceSource = `#include <iostream>
#include <vector>
using namespace std;

// 参考解输出生成输入序列的逆序，供评测机比较选手输出。
int main() {
    int n;
    if (!(cin >> n) || n < 1 || n > 100000) return 1;
    vector<long long> a(n);
    for (auto &x : a) if (!(cin >> x)) return 1;
	for (int i = n - 1; i >= 0; --i) cout << a[i] << (i ? ' ' : '\n');
    return 0;
}`

// hackTargetSource 是公开给选手的待攻击程序，故意漏输出反转序列的第一个元素。
const hackTargetSource = `#include <iostream>
#include <vector>
using namespace std;
int main() {
    int n;
    if (!(cin >> n)) return 0;
    vector<long long> a(n);
    for (auto &x : a) cin >> x;
    // 故意的边界错误：n >= 3 时漏掉 a[0]，请构造输入让它暴露。
    int first = n >= 3 ? 1 : 0;
    for (int i = n - 1; i >= first; --i) {
        if (i != n - 1) cout << ' ';
        cout << a[i];
    }
    cout << '\n';
}`

type testCase struct {
	input  string
	output string
	score  int
}

func main() {
	ctx := context.Background()
	cfg := config.Load()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("连接数据库失败", "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := model.Migrate(ctx, st.Pool()); err != nil {
		slog.Error("数据库迁移失败", "err", err)
		os.Exit(1)
	}

	problem, err := ensureProblem(ctx, st, cfg.DataDir)
	if err != nil {
		slog.Error("创建 Hack 题失败", "err", err)
		os.Exit(1)
	}
	contest, err := ensureContest(ctx, st)
	if err != nil {
		slog.Error("创建 Hack 比赛失败", "err", err)
		os.Exit(1)
	}
	if err := st.AddContestProblem(ctx, model.ContestProblem{
		ContestID:  contest.ID,
		ProblemID:  problem.ID,
		DisplayID:  "A",
		SortOrder:  1,
		ThemeColor: "purple",
	}); err != nil {
		slog.Error("关联比赛题目失败", "err", err)
		os.Exit(1)
	}

	fmt.Printf("Hack 题:   id=%d  http://localhost:8080/problem/%d\n", problem.ID, problem.ID)
	fmt.Printf("Hack 比赛: id=%d  http://localhost:8080/contest/%d\n", contest.ID, contest.ID)
	fmt.Printf("比赛榜单:       http://localhost:8080/contest/%d/standings\n", contest.ID)
}

func ensureProblem(ctx context.Context, st *store.Store, dataDir string) (model.Problem, error) {
	var problem model.Problem
	err := st.Pool().QueryRow(ctx, `SELECT id FROM problems WHERE title = $1 LIMIT 1`, problemTitle).Scan(&problem.ID)
	if err != nil {
		problem = model.Problem{
			Title:               problemTitle,
			Statement:           "# 反转序列\n\n给定一个整数序列，请按从后往前的顺序输出。\n\n这是一道 Codeforces 风格 Hack 题：题面下方给出了待攻击程序。请提交一组符合输入格式的数据；如果这段程序输出错误或触发运行限制，本次 Hack 即成功。",
			InputFormat:         "第一行一个整数 `n`（1 ≤ n ≤ 100000）。第二行包含 n 个整数。",
			OutputFormat:        "一行输出反转后的 n 个整数，整数之间用一个空格分隔。",
			Hint:                "注意输出末尾可以有换行。",
			Samples:             []model.Sample{{Input: "5\n1 2 3 4 5", Output: "5 4 3 2 1"}},
			TimeLimitMs:         1000,
			MemoryLimitKb:       262144,
			Difficulty:          2,
			Tags:                []string{"Hack", "数组", "教学演示"},
			Type:                model.ProblemTypeHack,
			CheckerMode:         model.CheckerModeToken,
			HackGeneratorSource: hackGeneratorSource,
			HackReferenceSource: hackReferenceSource,
			HackTargetSource:    hackTargetSource,
			TestcaseScores:      []int{30, 30, 40},
			Status:              model.ProblemStatusPublished,
		}
		if err := st.CreateProblem(ctx, &problem); err != nil {
			return model.Problem{}, err
		}
	} else {
		problem, err = st.GetProblem(ctx, problem.ID)
		if err != nil {
			return model.Problem{}, err
		}
		if problem.Type != model.ProblemTypeHack {
			return model.Problem{}, fmt.Errorf("题目 %d 已存在但类型不是 hack", problem.ID)
		}
		// Keep the checked-in demo judge sources in sync when the seed command is
		// rerun after an implementation change.
		problem.HackGeneratorSource = hackGeneratorSource
		problem.HackReferenceSource = hackReferenceSource
		problem.HackTargetSource = hackTargetSource
		problem.Statement = "# 反转序列\n\n给定一个整数序列，请按从后往前的顺序输出。\n\n这是一道 Codeforces 风格 Hack 题：题面下方给出了待攻击程序。请提交一组符合输入格式的数据；如果这段程序输出错误或触发运行限制，本次 Hack 即成功。"
		if err := st.UpdateProblem(ctx, &problem); err != nil {
			return model.Problem{}, err
		}
	}

	cases := []testCase{
		{input: "5\n1 2 3 4 5\n", output: "5 4 3 2 1\n", score: 30},
		{input: "3\n-2 0 7\n", output: "7 0 -2\n", score: 30},
		{input: "1\n42\n", output: "42\n", score: 40},
	}
	testDir := data.TestsDir(dataDir, problem.ID)
	if err := os.MkdirAll(testDir, 0o755); err != nil {
		return model.Problem{}, err
	}
	manifest := make([]model.ProblemTestCase, 0, len(cases))
	for i, tc := range cases {
		ordinal := i + 1
		inPath := filepath.Join(testDir, fmt.Sprintf("%d.in", ordinal))
		outPath := filepath.Join(testDir, fmt.Sprintf("%d.out", ordinal))
		if err := os.WriteFile(inPath, []byte(tc.input), 0o644); err != nil {
			return model.Problem{}, err
		}
		if err := os.WriteFile(outPath, []byte(tc.output), 0o644); err != nil {
			return model.Problem{}, err
		}
		item, err := st.TestcaseFromFiles(dataDir, problem.ID, ordinal, tc.score)
		if err != nil {
			return model.Problem{}, err
		}
		manifest = append(manifest, item)
	}
	if err := st.ReplaceAllTestcases(ctx, problem.ID, manifest); err != nil {
		return model.Problem{}, err
	}
	return problem, nil
}

func ensureContest(ctx context.Context, st *store.Store) (model.Contest, error) {
	var contest model.Contest
	err := st.Pool().QueryRow(ctx, `SELECT id FROM contests WHERE title = $1 LIMIT 1`, contestTitle).Scan(&contest.ID)
	if err == nil {
		return st.GetContest(ctx, contest.ID)
	}

	now := time.Now().Truncate(time.Second)
	contest = model.Contest{
		Title:                 contestTitle,
		Mode:                  model.ContestModeACM,
		Feedback:              model.FeedbackRealtime,
		ScoreMode:             model.ScoreModeAllOrNothing,
		PenaltyMinutes:        20,
		FreezeDurationMinutes: 0,
		DynamicDelayMinutes:   0,
		RankKeys:              []string{},
		StartTime:             now.Add(-15 * time.Minute),
		EndTime:               now.Add(2 * time.Hour),
		Description:           "# Hack 题挑战赛\n\n欢迎参加 Hack 题型演示比赛。比赛包含一道 Hack 题「反转序列」，可以从报名页进入比赛，再从题目页提交代码。\n\n- 赛制：ACM\n- 题目：A · 反转序列\n- 题目分值：100\n- 评测：实时反馈\n\n> 说明：评测机按测试点种子运行受信任的生成器，再运行参考解生成标准答案，最后比对选手输出。生成器与参考解仅由管理员维护，并在独立沙箱内执行。",
		Visibility:            model.ContestVisibilityPublic,
		RegistrationMode:      model.ContestRegistrationBoth,
		MaxTeamSize:           3,
		AllowTeamEdit:         true,
	}
	if err := st.CreateContest(ctx, &contest); err != nil {
		return model.Contest{}, err
	}
	return contest, nil
}
