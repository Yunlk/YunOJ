package contest

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

func oiCtx() ContestContext {
	return ContestContext{
		StartTime: time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC),
		Problems:  []int64{1, 2},
		Teams: map[int64]string{
			10: "队伍A",
			11: "队伍B",
		},
		RankKeys: []string{"last_problem_score"},
	}
}

// 每题 4 个测试点，各 25 分
func oiScores() map[int64][]int {
	return map[int64][]int{1: {25, 25, 25, 25}, 2: {25, 25, 25, 25}}
}

func TestOIProblemScore(t *testing.T) {
	fulls := []int{25, 25, 25, 25}
	if got := ProblemScore(fulls, []int{25, 25, 0, 0}); got != 50 {
		t.Fatalf("期望 50，实际 %d", got)
	}
	if got := ProblemScore(fulls, nil); got != 0 {
		t.Fatalf("无逐点得分时应为 0，实际 %d", got)
	}
}

func TestOIModeALastSubmission(t *testing.T) {
	ctx := oiCtx()
	subs := []model.Submission{
		{ID: 1, UserID: 10, ProblemID: 1, Status: model.StatusAccepted, CreatedAt: ctx.StartTime.Add(10 * time.Minute), CaseScores: []int{25, 25, 25, 25}},
		// 末次提交只有 2 个测试点通过 → 模式 A 取 50 分
		{ID: 2, UserID: 10, ProblemID: 1, Status: model.StatusAccepted, CreatedAt: ctx.StartTime.Add(20 * time.Minute), CaseScores: []int{25, 25, 0, 0}},
	}
	standings := BuildOIStandings(ctx, subs, oiScores(), true)
	if len(standings) != 2 {
		t.Fatalf("期望 2 支队伍，实际 %d", len(standings))
	}
	var a *OIStanding
	for i := range standings {
		if standings[i].TeamID == 10 {
			a = &standings[i]
		}
	}
	if a == nil || a.TotalScore != 50 {
		t.Fatalf("模式 A 应取末次提交得分 50，实际 %+v", a)
	}
	if a.ProblemSubmissions[1] != 2 {
		t.Fatalf("提交次数应计 2，实际 %d", a.ProblemSubmissions[1])
	}
}

func TestOIModeBPerTestcaseMax(t *testing.T) {
	ctx := oiCtx()
	subs := []model.Submission{
		// 第一次通过前 2 个点
		{ID: 1, UserID: 10, ProblemID: 1, Status: model.StatusAccepted, CreatedAt: ctx.StartTime.Add(10 * time.Minute), CaseScores: []int{25, 25, 0, 0}},
		// 第二次通过后 2 个点 → 模式 B 逐点取最高 = 100
		{ID: 2, UserID: 10, ProblemID: 1, Status: model.StatusAccepted, CreatedAt: ctx.StartTime.Add(20 * time.Minute), CaseScores: []int{0, 0, 25, 25}},
	}
	standings := BuildOIStandings(ctx, subs, oiScores(), false)
	var a *OIStanding
	for i := range standings {
		if standings[i].TeamID == 10 {
			a = &standings[i]
		}
	}
	if a == nil || a.TotalScore != 100 {
		t.Fatalf("模式 B 逐测试点取最高应得 100，实际 %+v", a)
	}
}

func TestOIRankTieBreak(t *testing.T) {
	ctx := oiCtx()
	// A 与 B 总分相同（各 75），但 A 最后一题（题目 2）得分更高 → A 排前
	subs := []model.Submission{
		{ID: 1, UserID: 10, ProblemID: 1, Status: model.StatusAccepted, CreatedAt: ctx.StartTime, CaseScores: []int{25, 25, 0, 0}},  // 50
		{ID: 2, UserID: 10, ProblemID: 2, Status: model.StatusAccepted, CreatedAt: ctx.StartTime, CaseScores: []int{25, 0, 0, 0}},   // 25
		{ID: 3, UserID: 11, ProblemID: 1, Status: model.StatusAccepted, CreatedAt: ctx.StartTime, CaseScores: []int{25, 25, 25, 0}}, // 75
		{ID: 4, UserID: 11, ProblemID: 2, Status: model.StatusAccepted, CreatedAt: ctx.StartTime, CaseScores: []int{0, 0, 0, 0}},    // 0
	}
	standings := BuildOIStandings(ctx, subs, oiScores(), false)
	// A 总分 75、B 总分 75；A 最后一题 25 > B 的 0 → A 第 1
	if standings[0].TeamID != 10 {
		t.Fatalf("同分时最后一题得分高者应排前，实际第 1 名 %d", standings[0].TeamID)
	}
}
