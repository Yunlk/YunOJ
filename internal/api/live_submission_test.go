package api

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/model"
)

func TestLiveSubmissionDTOsKeepsConcurrentAndRunningEvents(t *testing.T) {
	start := time.Date(2026, 8, 20, 10, 0, 0, 0, time.UTC)
	subs := []model.Submission{
		{ID: 10, UserID: 1, ProblemID: 101, Status: model.StatusAccepted, CreatedAt: start},
		{ID: 11, UserID: 2, ProblemID: 102, Status: model.StatusPending, CreatedAt: start.Add(time.Second)},
		{ID: 12, UserID: 3, ProblemID: 101, Status: model.StatusAccepted, CreatedAt: start.Add(2 * time.Second)},
	}
	problems := []contestProblemDTO{
		{ProblemID: 101, DisplayID: "A"},
		{ProblemID: 102, DisplayID: "B"},
	}
	teams := map[int64]string{1: "A队", 2: "B队", 3: "C队"}

	ctx := contest.ContestContext{
		StartTime: start, PenaltyMinutes: 20,
		Problems: []int64{101, 102}, Teams: teams,
	}
	snapshots := contest.ReplayACMSubmissionSnapshots(ctx, subs)
	events := liveSubmissionDTOs(subs, problems, teams, nil, snapshots)
	if len(events) != len(subs) || events[0].SubmissionID != 10 || events[1].SubmissionID != 11 || events[2].SubmissionID != 12 {
		t.Fatalf("快照应保留并发提交和各自状态，得到 %#v", events)
	}
	if events[0].Standings == nil || events[1].Standings != nil || events[2].Standings == nil {
		t.Fatalf("只有终态提交应附带榜单快照，得到 %#v", events)
	}
}
