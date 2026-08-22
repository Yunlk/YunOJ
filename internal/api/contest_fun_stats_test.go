package api

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

func TestBuildContestFunStatsIncludesFrozenSubmissions(t *testing.T) {
	start := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	problems := []contestProblemDTO{
		{ProblemID: 101, DisplayID: "A"},
		{ProblemID: 102, DisplayID: "B"},
	}
	teams := map[int64]string{1: "一队", 2: "二队", 3: "三队"}
	subs := []model.Submission{
		{ID: 1, UserID: 1, ProblemID: 101, Status: model.StatusAccepted, CreatedAt: start.Add(2 * time.Minute)},
		{ID: 2, UserID: 2, ProblemID: 101, Status: model.StatusAccepted, CreatedAt: start.Add(2 * time.Minute)},
		{ID: 3, UserID: 1, ProblemID: 102, Status: model.StatusAccepted, CreatedAt: start.Add(5 * time.Minute)},
		{ID: 4, UserID: 3, ProblemID: 102, Status: model.StatusAccepted, CreatedAt: start.Add(6 * time.Minute)},
		{ID: 5, UserID: 2, ProblemID: 102, Status: model.StatusWrongAnswer, IsFrozen: true, CreatedAt: start.Add(7 * time.Minute)},
		{ID: 6, UserID: 2, ProblemID: 102, Status: model.StatusWrongAnswer, IsFrozen: true, CreatedAt: start.Add(8 * time.Minute)},
		{ID: 7, UserID: 1, ProblemID: 102, Status: model.StatusWrongAnswer, CreatedAt: start.Add(9 * time.Minute)},
	}

	stats := buildContestFunStats(subs, problems, teams, start)
	if len(stats.FastestFirstBlood) != 2 || stats.FastestFirstBlood[0].TeamID != 1 || stats.FastestFirstBlood[1].TeamID != 2 {
		t.Fatalf("最快一血应保留同秒并列，得到 %#v", stats.FastestFirstBlood)
	}
	if stats.FastestFirstBlood[0].ElapsedSeconds != 120 || stats.FastestFirstBlood[0].DisplayIDs[0] != "A" {
		t.Fatalf("最快一血时间或题目错误，得到 %#v", stats.FastestFirstBlood[0])
	}
	if len(stats.MostFirstBlood) != 1 || stats.MostFirstBlood[0].TeamID != 1 || stats.MostFirstBlood[0].Count != 2 {
		t.Fatalf("最多一血应为一队 2 题，得到 %#v", stats.MostFirstBlood)
	}
	if len(stats.MostWrongAnswers) != 1 || stats.MostWrongAnswers[0].TeamID != 2 || stats.MostWrongAnswers[0].Count != 2 {
		t.Fatalf("封榜期间 WA 应计入，得到 %#v", stats.MostWrongAnswers)
	}
	if len(stats.LastAccepted) != 1 || stats.LastAccepted[0].TeamID != 3 || stats.LastAccepted[0].DisplayIDs[0] != "B" {
		t.Fatalf("最后一发 AC 应为三队 B，得到 %#v", stats.LastAccepted)
	}
}

func TestBuildContestFunStatsEmpty(t *testing.T) {
	stats := buildContestFunStats(nil, nil, map[int64]string{1: "一队"}, time.Now())
	if len(stats.FastestFirstBlood) != 0 || len(stats.MostFirstBlood) != 0 ||
		len(stats.MostWrongAnswers) != 0 || len(stats.LastAccepted) != 0 {
		t.Fatalf("无提交时趣味排名应为空，得到 %#v", stats)
	}
}
