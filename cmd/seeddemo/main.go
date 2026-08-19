// 滚榜演示数据生成器：创建一场「20 队 × 8 题」的 ACM 演示比赛，
// 生成 ICPC 风格的提交分布（含封榜窗口内的冻结提交），供榜单/滚榜展示。
//
// 用法（开发环境）：
//
//	go run ./cmd/seeddemo            # 生成（幂等：已存在则跳过）
//	go run ./cmd/seeddemo -reset     # 删除上一场演示赛后重新生成
//
// 生成的提交直接以终态写入数据库（不经评测队列），created_at 按比赛时间轴
// 分布，封榜窗口内的提交 is_frozen=true，滚榜播放时可逐条揭晓。
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"math/rand"
	"os"
	"time"

	"github.com/yunoj/yunoj/internal/auth"
	"github.com/yunoj/yunoj/internal/config"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	demoContestTitle = "滚榜演示赛"
	teamCount        = 20
	problemCount     = 8
	demoPassword     = "demo123"
)

// solvePlan 每道题的预设通过率（决定有多少队最终通过）。
var solvePlan = []int{19, 16, 13, 10, 8, 6, 4, 2}

func main() {
	reset := flag.Bool("reset", false, "删除上一场演示赛后重新生成")
	flag.Parse()

	cfg := config.Load()
	ctx := context.Background()
	st, err := store.New(ctx, cfg.DatabaseURL)
	if err != nil {
		slog.Error("连接数据库失败", "err", err)
		os.Exit(1)
	}
	defer st.Close()
	if err := model.Migrate(ctx, st.Pool()); err != nil {
		slog.Error("迁移失败", "err", err)
		os.Exit(1)
	}

	// 幂等：已有演示赛则直接输出信息
	if !*reset {
		if c, err := findDemoContest(ctx, st); err == nil && c != nil {
			printSummary(ctx, st, c)
			return
		}
	} else if c, _ := findDemoContest(ctx, st); c != nil {
		_ = st.DeleteContest(ctx, c.ID)
		// 顺带清理旧的演示题（避免每次 reset 累积孤儿题目）
		if _, err := st.Pool().Exec(ctx,
			`DELETE FROM problems WHERE title LIKE '演示题 %'`); err != nil {
			slog.Warn("清理旧演示题失败", "err", err)
		}
		fmt.Println("已删除上一场演示赛及其演示题")
	}

	// 1. 题目：复制 A+B（problem 1）8 份并发布
	template, err := st.GetProblem(ctx, 1)
	if err != nil {
		slog.Error("找不到模板题目 1（A+B Problem）", "err", err)
		os.Exit(1)
	}
	problems := make([]int64, 0, problemCount)
	letters := []string{"A", "B", "C", "D", "E", "F", "G", "H"}
	for i := 0; i < problemCount; i++ {
		p := model.Problem{
			Title:       fmt.Sprintf("演示题 %s · %s", letters[i], template.Title),
			Statement:   fmt.Sprintf("# 演示题 %s\n\n计算两个整数的和。", letters[i]),
			InputFormat: "两个整数 a, b。", OutputFormat: "a+b 的值。",
			Hint:        "（演示题目，内容与 A+B 相同）",
			Samples:     template.Samples,
			TimeLimitMs: template.TimeLimitMs, MemoryLimitKb: template.MemoryLimitKb,
			Difficulty: min(10, 1+i), Tags: []string{"演示"},
			Type: model.ProblemTypeStandard, Status: model.ProblemStatusDraft,
		}
		if err := st.CreateProblem(ctx, &p); err != nil {
			slog.Error("创建演示题失败", "err", err)
			os.Exit(1)
		}
		if tcs, err := st.ListTestcases(ctx, template.ID); err == nil && len(tcs) > 0 {
			for i := range tcs {
				tcs[i].ProblemID = p.ID
			}
			_ = st.ReplaceAllTestcases(ctx, p.ID, tcs)
		}
		if err := st.UpdateProblemStatus(ctx, p.ID, model.ProblemStatusPublished); err != nil {
			slog.Error("发布演示题失败", "err", err)
			os.Exit(1)
		}
		problems = append(problems, p.ID)
	}
	fmt.Printf("已创建并发布 %d 道演示题: %v\n", problemCount, problems)

	// 2. 比赛：进行中，封榜窗口 = 最后 60 分钟（已有约半小时冻结提交）
	now := time.Now()
	start := now.Add(-2 * time.Hour)
	end := now.Add(30 * time.Minute)
	freeze := end.Add(-60 * time.Minute)
	c := &model.Contest{
		Title: demoContestTitle, Mode: model.ContestModeACM,
		Feedback: model.FeedbackRealtime, ScoreMode: model.ScoreModeAllOrNothing,
		PenaltyMinutes: 20, FreezeDurationMinutes: 60,
		RankKeys: []string{}, StartTime: start, EndTime: end,
		Description: "## 滚榜演示赛\n\n20 支队伍 · 8 道题 · ACM 赛制 · 罚时 20 分钟 · 最后 60 分钟封榜。\n\n榜单与滚榜均有独立展示页（管理员可在排行榜页打开）。",
		Visibility:  model.ContestVisibilityPublic,
	}
	if err := st.CreateContest(ctx, c); err != nil {
		slog.Error("创建演示赛失败", "err", err)
		os.Exit(1)
	}
	for i, pid := range problems {
		if err := st.AddContestProblem(ctx, model.ContestProblem{
			ContestID: c.ID, ProblemID: pid, DisplayID: letters[i], SortOrder: i + 1,
		}); err != nil {
			slog.Error("添加比赛题目失败", "err", err)
			os.Exit(1)
		}
	}
	fmt.Printf("比赛已创建: id=%d start=%s end=%s freeze=%s\n",
		c.ID, start.Format("15:04"), end.Format("15:04"), freeze.Format("15:04"))

	// 3. 20 支队伍（demo01..demo20，幂等：已存在则复用）
	teamIDs := make([]int64, 0, teamCount)
	for i := 1; i <= teamCount; i++ {
		username := fmt.Sprintf("demo%02d", i)
		var u model.User
		if existing, _, err := st.GetUserByUsername(ctx, username); err == nil {
			u = existing
		} else {
			hash, err := auth.HashPassword(demoPassword)
			if err != nil {
				slog.Error("生成密码哈希失败", "err", err)
				os.Exit(1)
			}
			u, err = st.CreateUser(ctx, username, username+"@demo.local", hash, model.RoleUser)
			if err != nil {
				slog.Error("创建用户失败", "username", username, "err", err)
				os.Exit(1)
			}
		}
		teamName := fmt.Sprintf("队伍 %02d", i)
		if err := st.AddContestTeam(ctx, model.ContestTeam{
			ContestID: c.ID, TeamID: u.ID, TeamName: teamName,
		}); err != nil {
			slog.Error("报名失败", "team", teamName, "err", err)
			os.Exit(1)
		}
		teamIDs = append(teamIDs, u.ID)
	}
	fmt.Printf("已创建 %d 支队伍\n", teamCount)

	// 4. 提交分布（确定性伪随机：种子固定，每次生成结果一致）
	rng := rand.New(rand.NewSource(20260820))
	inserted := 0
	frozenCount := 0
	// 每队的基础速度（分钟）：强队早过题，弱队晚
	for p := 0; p < problemCount; p++ {
		nSolve := solvePlan[p]
		// 随机选择 nSolve 个通过队伍（洗牌取前 n 个）
		order := rng.Perm(teamCount)
		solvers := map[int]bool{}
		for k := 0; k < nSolve; k++ {
			solvers[order[k]] = true
		}
		baseMinute := 4 + p*9 // A 最早 ~4 分钟，H ~67 分钟起步
		for ti := 0; ti < teamCount; ti++ {
			teamID := teamIDs[ti]
			if solvers[ti] {
				wa := rng.Intn(4) // 0-3 次未通过尝试
				solveMinute := baseMinute + rng.Intn(18) + ti/3
				// 每队唯一秒偏移（ti*37s）：同一分钟内的多队也能分出先后，一血唯一
				teamSecond := time.Duration(ti) * 37 * time.Second
				// 约一半的 AC 落在封榜窗口（滚榜揭晓素材）
				frozen := rng.Intn(100) < 50
				acAt := start.Add(time.Duration(solveMinute)*time.Minute + teamSecond)
				if frozen {
					acAt = freeze.Add(time.Duration(1+rng.Intn(25))*time.Minute + teamSecond)
				}
				if acAt.After(end) {
					acAt = end.Add(-time.Minute)
					frozen = true
				}
				// 未通过尝试（在 AC 之前；若 AC 在封榜窗口内则前移到窗口外，
				// 保证封榜窗口内只有 AC 提交，滚榜事件干净）
				for w := 0; w < wa; w++ {
					at := acAt.Add(-time.Duration(3+w*2+rng.Intn(4)) * time.Minute)
					if at.Before(start) {
						at = start.Add(2 * time.Minute)
					}
					if !at.Before(freeze) {
						at = freeze.Add(-time.Duration(2+rng.Intn(8)) * time.Minute)
					}
					if err := insertSubmission(ctx, st, c.ID, problems[p], teamID,
						model.StatusWrongAnswer, at, freeze); err != nil {
						slog.Error("插入 WA 提交失败", "err", err)
						os.Exit(1)
					}
					inserted++
				}
				if err := insertSubmission(ctx, st, c.ID, problems[p], teamID,
					model.StatusAccepted, acAt, freeze); err != nil {
					slog.Error("插入 AC 提交失败", "err", err)
					os.Exit(1)
				}
				inserted++
				if frozen {
					frozenCount++
				}
			} else {
				// 未通过队伍：0-4 次尝试（全部在可见窗口，不进滚榜）
				wa := rng.Intn(5)
				for w := 0; w < wa; w++ {
					at := start.Add(time.Duration(10+p*8+w*7+rng.Intn(15)) * time.Minute)
					if at.After(freeze) {
						at = freeze.Add(-time.Duration(1+rng.Intn(10)) * time.Minute)
					}
					if err := insertSubmission(ctx, st, c.ID, problems[p], teamID,
						model.StatusWrongAnswer, at, freeze); err != nil {
						slog.Error("插入 WA 提交失败", "err", err)
						os.Exit(1)
					}
					inserted++
				}
			}
		}
	}
	fmt.Printf("已生成 %d 条提交（其中 %d 条冻结，滚榜可揭晓）\n", inserted, frozenCount)
	printSummary(ctx, st, c)
}

func findDemoContest(ctx context.Context, st *store.Store) (*model.Contest, error) {
	// 遍历最近 50 场找同名演示赛
	items, _, err := st.ListContests(ctx, 1, 50, true)
	if err != nil {
		return nil, err
	}
	for i := range items {
		if items[i].Title == demoContestTitle {
			return &items[i], nil
		}
	}
	return nil, nil
}

func insertSubmission(ctx context.Context, st *store.Store, contestID, problemID, teamID int64,
	status string, createdAt, freezeAt time.Time) error {

	frozen := !createdAt.Before(freezeAt)
	score := 0
	var caseScores string
	var caseResults string
	if status == model.StatusAccepted {
		score = 100
		caseScores = "[100]"
		caseResults = `[{"case_id":1,"status":"accepted","time_ms":1,"memory_kb":1400}]`
	} else {
		caseScores = "[0]"
		caseResults = `[{"case_id":1,"status":"wrong_answer","time_ms":1,"memory_kb":1400}]`
	}
	_, err := st.Pool().Exec(ctx,
		`INSERT INTO submissions (problem_id, user_id, language, code, status, compile_error,
			case_results, time_ms, memory_kb, score, case_scores, is_frozen, contest_id, created_at, judged_at)
		 VALUES ($1, $2, 'cpp', '// demo submission', $3, '', $4::jsonb, 1, 1400, $5, $6::jsonb, $7, $8, $9, $9)`,
		problemID, teamID, status, caseResults, score, caseScores, frozen, contestID, createdAt)
	return err
}

func printSummary(ctx context.Context, st *store.Store, c *model.Contest) {
	fmt.Printf("\n演示赛信息:\n")
	fmt.Printf("  比赛 ID: %d  《%s》\n", c.ID, c.Title)
	fmt.Printf("  榜单展示页:  http://localhost:5173/contest/%d/board\n", c.ID)
	fmt.Printf("  滚榜展示页:  http://localhost:5173/contest/%d/roll\n", c.ID)
	fmt.Printf("  总览页:      http://localhost:5173/contest/%d\n", c.ID)
	fmt.Printf("  队伍: %d 支（demo01..demo20，密码 %s）\n", teamCount, demoPassword)
	freezeAt := c.EndTime.Add(-time.Duration(c.FreezeDurationMinutes) * time.Minute)
	if subs, err := st.ListContestSubmissions(ctx, c.ID); err == nil {
		frozen := 0
		for _, s := range subs {
			if !s.CreatedAt.Before(freezeAt) {
				frozen++
			}
		}
		fmt.Printf("  提交: %d 条，冻结 %d 条\n", len(subs), frozen)
	}
}
