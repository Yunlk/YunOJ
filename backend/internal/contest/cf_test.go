package contest

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

var (
	cfStart = time.Date(2026, 9, 1, 9, 0, 0, 0, time.UTC)
	cfEnd   = cfStart.Add(2 * time.Hour) // 时长 120 分钟
)

// TestCFDecayScore 分值线性衰减：开赛满分，结束降到 30%，之后不再下降。
func TestCFDecayScore(t *testing.T) {
	cases := []struct {
		name     string
		at       time.Time
		initial  int
		expected int
	}{
		{"开赛瞬间=满分", cfStart, 500, 500},
		{"开赛前=满分", cfStart.Add(-time.Minute), 500, 500},
		{"半程=65%", cfStart.Add(time.Hour), 500, 325}, // 1 - 0.7*0.5 = 0.65
		{"结束=30%", cfEnd, 1000, 300},
		{"结束后=30%（不再下降）", cfEnd.Add(time.Hour), 1000, 300},
		{"中途四分之三=47.5%", cfStart.Add(90 * time.Minute), 1000, 475},
		{"初始分为 0", cfStart, 0, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := CFDecayScore(tc.initial, tc.at, cfStart, cfEnd)
			if got != tc.expected {
				t.Fatalf("期望 %d，实际 %d", tc.expected, got)
			}
		})
	}
}

// TestCFPenaltyMinutesDefault 未配置罚时（0）时使用 CF 默认 10 分钟。
func TestCFPenaltyMinutesDefault(t *testing.T) {
	if CFPenaltyMinutes(0) != CFDefaultPenaltyMinutes {
		t.Fatal("0 应回落到默认 10 分钟")
	}
	if CFPenaltyMinutes(20) != 20 {
		t.Fatal("显式配置应被保留")
	}
}

func cfCtx() ContestContext {
	return ContestContext{
		StartTime:      cfStart,
		EndTime:        cfEnd,
		PenaltyMinutes: 10,
		Problems:       []int64{1, 2},
		Teams:          map[int64]string{1: "甲", 2: "乙", 3: "丙"},
	}
}

func cfSub(id, team, problem int64, status string, at time.Time, score int) model.Submission {
	return model.Submission{
		ID: id, UserID: team, ProblemID: problem, Status: status,
		CreatedAt: at, Score: score, ContestID: nil,
	}
}

// TestBuildCFStandingsBasic 基本计分：早提交得分高、错误提交计入罚时、按总分排名。
func TestBuildCFStandingsBasic(t *testing.T) {
	initial := map[int64]int{1: 500, 2: 1000}
	subs := []model.Submission{
		// 甲：A 题先错一次，30 分钟时 AC（分值 500*(1-0.7*0.25)=412）
		cfSub(1, 1, 1, model.StatusWrongAnswer, cfStart.Add(10*time.Minute), 0),
		cfSub(2, 1, 1, model.StatusAccepted, cfStart.Add(30*time.Minute), 412),
		// 乙：A 题 10 分钟 AC（分值 500*(1-0.7*(1/12))≈471），再 60 分钟 AC B 题（1000*(1-0.7*0.5)=650）
		cfSub(3, 2, 1, model.StatusAccepted, cfStart.Add(10*time.Minute), 471),
		cfSub(4, 2, 2, model.StatusAccepted, cfStart.Add(60*time.Minute), 650),
	}
	standings, _ := BuildCFStandings(cfCtx(), subs, initial, 10, time.Time{})

	if len(standings) != 3 {
		t.Fatalf("期望 3 支队伍，实际 %d", len(standings))
	}
	// 乙 1121 分 > 甲 412 分 > 丙 0 分
	if standings[0].TeamName != "乙" || standings[0].Score != 1121 {
		t.Fatalf("第 1 名应为乙 1121 分，实际 %s %d", standings[0].TeamName, standings[0].Score)
	}
	if standings[0].Penalty != 70 { // 10 分钟 + 60 分钟
		t.Fatalf("乙罚时应为 70，实际 %d", standings[0].Penalty)
	}
	if standings[1].TeamName != "甲" || standings[1].Score != 412 {
		t.Fatalf("第 2 名应为甲 412 分，实际 %s %d", standings[1].TeamName, standings[1].Score)
	}
	if standings[1].Penalty != 40 { // 30 分钟用时 + 1 次错误 × 10
		t.Fatalf("甲罚时应为 40，实际 %d", standings[1].Penalty)
	}
	if standings[2].Score != 0 || standings[2].Penalty != 0 {
		t.Fatalf("未提交队伍应为 0 分 0 罚时，实际 %d/%d", standings[2].Score, standings[2].Penalty)
	}
}

// TestBuildCFStandingsTieBreak 同分时按罚时升序、再按最后 AC 升序。
func TestBuildCFStandingsTieBreak(t *testing.T) {
	initial := map[int64]int{1: 500}
	subs := []model.Submission{
		// 甲：20 分钟 AC，分值 500*(1-0.7*(1/6))≈442
		cfSub(1, 1, 1, model.StatusAccepted, cfStart.Add(20*time.Minute), 442),
		// 乙：同为 442，但迟 10 分钟
		cfSub(2, 2, 1, model.StatusAccepted, cfStart.Add(30*time.Minute), 442),
	}
	standings, _ := BuildCFStandings(cfCtx(), subs, initial, 10, time.Time{})
	if standings[0].TeamName != "甲" || standings[1].TeamName != "乙" {
		t.Fatalf("同分应按最后 AC 时间升序：期望 甲→乙，实际 %s→%s",
			standings[0].TeamName, standings[1].TeamName)
	}
}

// TestBuildCFStandingsScoreFallback 提交未记录分数时按提交时刻现算（兼容旧数据）。
func TestBuildCFStandingsScoreFallback(t *testing.T) {
	initial := map[int64]int{1: 1000}
	subs := []model.Submission{
		cfSub(1, 1, 1, model.StatusAccepted, cfStart.Add(time.Hour), 0), // Score=0 → 现算
	}
	standings, _ := BuildCFStandings(cfCtx(), subs, initial, 10, time.Time{})
	if standings[0].Score != 650 {
		t.Fatalf("半程通过应为 650 分，实际 %d", standings[0].Score)
	}
}

// TestBuildCFStandingsFreeze 封榜后的提交不计入公开榜单，单独返回。
func TestBuildCFStandingsFreeze(t *testing.T) {
	initial := map[int64]int{1: 500}
	freezeAt := cfStart.Add(90 * time.Minute)
	subs := []model.Submission{
		cfSub(1, 1, 1, model.StatusAccepted, cfStart.Add(30*time.Minute), 400),
		cfSub(2, 2, 1, model.StatusAccepted, cfStart.Add(100*time.Minute), 350),
	}
	standings, frozen := BuildCFStandings(cfCtx(), subs, initial, 10, freezeAt)
	if len(frozen) != 1 {
		t.Fatalf("应有 1 条冻结提交，实际 %d", len(frozen))
	}
	if standings[0].TeamName != "甲" {
		t.Fatalf("公开榜单应只有甲通过，实际第 1 名 %s", standings[0].TeamName)
	}
	for _, st := range standings {
		if st.TeamName == "乙" && st.Score != 0 {
			t.Fatalf("乙的冻结提交不应计入公开榜单")
		}
	}
}

// TestBuildCFStandingsCompileErrorNotCounted CE 不计入错误次数。
func TestBuildCFStandingsCompileErrorNotCounted(t *testing.T) {
	initial := map[int64]int{1: 500}
	subs := []model.Submission{
		cfSub(1, 1, 1, model.StatusCompileError, cfStart.Add(5*time.Minute), 0),
		cfSub(2, 1, 1, model.StatusCompileError, cfStart.Add(6*time.Minute), 0),
		cfSub(3, 1, 1, model.StatusAccepted, cfStart.Add(10*time.Minute), 471),
	}
	standings, _ := BuildCFStandings(cfCtx(), subs, initial, 10, time.Time{})
	if standings[0].Penalty != 10 {
		t.Fatalf("CE 不应计入罚时，期望 10，实际 %d", standings[0].Penalty)
	}
}

// TestBuildCFStandingsHackedSubmission 被 Hack 成功的提交整体作废：
// 不得分、不解题、不计罚时也不计入错误次数；若该队另有有效 AC，则按那次提交计分。
func TestBuildCFStandingsHackedSubmission(t *testing.T) {
	initial := map[int64]int{1: 500}

	// 甲：唯一一次 AC（30 分钟，412 分）被 Hack → 该题全盘作废
	hackedOnly := cfSub(1, 1, 1, model.StatusAccepted, cfStart.Add(30*time.Minute), 412)
	hackedOnly.IsHacked = true

	// 乙：10 分钟 AC（471 分），未被 Hack → 正常计分
	valid := cfSub(2, 2, 1, model.StatusAccepted, cfStart.Add(10*time.Minute), 471)

	// 丙：15 分钟 AC（465 分）有效；20 分钟另一次 AC（442 分）被 Hack → 保留 465
	keep := cfSub(3, 3, 1, model.StatusAccepted, cfStart.Add(15*time.Minute), 465)
	hackedLater := cfSub(4, 3, 1, model.StatusAccepted, cfStart.Add(20*time.Minute), 442)
	hackedLater.IsHacked = true

	standings, _ := BuildCFStandings(cfCtx(),
		[]model.Submission{hackedOnly, valid, keep, hackedLater}, initial, 10, time.Time{})

	byTeam := map[int64]CFStanding{}
	for _, st := range standings {
		byTeam[st.TeamID] = st
	}
	if got := byTeam[1]; got.Score != 0 || got.Solved != 0 || got.Penalty != 0 {
		t.Fatalf("唯一 AC 被 Hack 后应为 0 分/0 题/0 罚时，实际 %d/%d/%d", got.Score, got.Solved, got.Penalty)
	}
	if got := byTeam[1].Problems[1]; got.FailedAttempts != 0 {
		t.Fatalf("被 Hack 的提交不应计入错误次数，实际 %d", got.FailedAttempts)
	}
	if got := byTeam[2]; got.Score != 471 || got.Solved != 1 {
		t.Fatalf("未被 Hack 的乙应保留 471 分，实际 %d 分 %d 题", got.Score, got.Solved)
	}
	if got := byTeam[3]; got.Score != 465 || got.Solved != 1 {
		t.Fatalf("丙应保留有效那次的 465 分，实际 %d 分 %d 题", got.Score, got.Solved)
	}
}
