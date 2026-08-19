package contest

import (
	"testing"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

func acmCtx() ContestContext {
	return ContestContext{
		StartTime:      time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC),
		PenaltyMinutes: 20,
		Problems:       []int64{1, 2},
		Teams: map[int64]string{
			10: "队伍A",
			11: "队伍B",
			12: "队伍C",
		},
	}
}

func sub(id int64, team, problem int64, status string, at time.Time) model.Submission {
	return model.Submission{ID: id, UserID: team, ProblemID: problem, Status: status, CreatedAt: at}
}

func TestProcessACMPenalty(t *testing.T) {
	ctx := acmCtx()
	st := newACMStanding(10, "队伍A", ctx.Problems)

	// 12:10 WA（错误 1 次）
	ProcessACM(st, sub(1, 10, 1, model.StatusWrongAnswer, ctx.StartTime.Add(10*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)
	// 12:30 AC：罚时 = 30 分钟 + 1×20 = 50
	ProcessACM(st, sub(2, 10, 1, model.StatusAccepted, ctx.StartTime.Add(30*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)

	if st.Solved != 1 || st.Penalty != 50 {
		t.Fatalf("期望 solved=1 penalty=50, 实际 solved=%d penalty=%d", st.Solved, st.Penalty)
	}
	// AC 后再提交不影响
	if ProcessACM(st, sub(3, 10, 1, model.StatusWrongAnswer, ctx.StartTime.Add(40*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes) {
		t.Fatal("已解决题目再提交不应改变榜单")
	}
	if st.Penalty != 50 {
		t.Fatalf("AC 后榜单被改变: penalty=%d", st.Penalty)
	}
}

func TestProcessACMCompileErrorNoPenalty(t *testing.T) {
	ctx := acmCtx()
	st := newACMStanding(10, "队伍A", ctx.Problems)

	ProcessACM(st, sub(1, 10, 1, model.StatusCompileError, ctx.StartTime.Add(5*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)
	ProcessACM(st, sub(2, 10, 1, model.StatusAccepted, ctx.StartTime.Add(15*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)

	// CE 不罚时：罚时 = 15 分钟
	if st.Penalty != 15 {
		t.Fatalf("CE 不应计罚时，期望 15，实际 %d", st.Penalty)
	}
}

func TestACMTieBreaker(t *testing.T) {
	ctx := acmCtx()
	base := []ACMStanding{}
	for _, id := range []int64{10, 11, 12} {
		base = append(base, *newACMStanding(id, ctx.Teams[id], ctx.Problems))
	}
	byID := map[int64]int{}
	for i := range base {
		byID[base[i].TeamID] = i
	}

	// 队伍A：1 题，罚时 60
	ProcessACM(&base[byID[10]], sub(1, 10, 1, model.StatusWrongAnswer, ctx.StartTime.Add(10*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)
	ProcessACM(&base[byID[10]], sub(2, 10, 1, model.StatusAccepted, ctx.StartTime.Add(40*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)
	// 队伍B：1 题，罚时 30
	ProcessACM(&base[byID[11]], sub(3, 11, 1, model.StatusAccepted, ctx.StartTime.Add(30*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)
	// 队伍C：1 题，罚时 30，但最后 AC 时间更早
	ProcessACM(&base[byID[12]], sub(4, 12, 2, model.StatusAccepted, ctx.StartTime.Add(20*time.Minute)), ctx.StartTime, ctx.PenaltyMinutes)

	SortACM(base)
	// C 最后 AC 时间 12:20 早于 B 的 12:30 → C 排第 2
	want := []int64{12, 11, 10}
	for i, w := range want {
		if base[i].TeamID != w {
			t.Fatalf("第 %d 名期望队伍 %d，实际 %d", i+1, w, base[i].TeamID)
		}
	}
}

func TestBuildACMFreezeAndRollBoard(t *testing.T) {
	ctx := acmCtx()
	freezeAt := ctx.StartTime.Add(50 * time.Minute)

	subs := []model.Submission{
		// 冻结前
		sub(1, 10, 1, model.StatusWrongAnswer, ctx.StartTime.Add(10*time.Minute)),
		sub(2, 10, 1, model.StatusAccepted, ctx.StartTime.Add(30*time.Minute)),
		sub(3, 11, 1, model.StatusAccepted, ctx.StartTime.Add(20*time.Minute)),
		// 冻结后（50 分钟起）
		sub(4, 11, 2, model.StatusAccepted, ctx.StartTime.Add(55*time.Minute)),
		sub(5, 10, 2, model.StatusAccepted, ctx.StartTime.Add(60*time.Minute)),
	}

	standings, frozen := BuildACMStandings(ctx, subs, freezeAt)
	if len(frozen) != 2 {
		t.Fatalf("期望 2 条冻结提交，实际 %d", len(frozen))
	}
	// 公开榜：A(1题 罚时30+20=50?) 算一下：
	// A: WA@10 → AC@30: 罚时 30 + 20 = 50
	// B: AC@20: 罚时 20
	// 公开榜 B 第 1、A 第 2
	if standings[0].TeamID != 11 || standings[1].TeamID != 10 {
		t.Fatalf("公开榜顺序错误: %d, %d", standings[0].TeamID, standings[1].TeamID)
	}

	events := RollBoard(ctx, standings, frozen)
	if len(events) != 2 {
		t.Fatalf("期望 2 个滚榜事件，实际 %d", len(events))
	}
	// 滚榜后最终：A 解出 2 题（罚时 50+60=110），B 解出 2 题（罚时 20+55=75）
	// B 罚时更少 → B 第 1
	final := events[len(events)-1].Standings
	if final[0].TeamID != 11 || final[1].TeamID != 10 {
		t.Fatalf("滚榜后排名错误: %d, %d", final[0].TeamID, final[1].TeamID)
	}
	// 队伍 A 在滚榜过程中应发生排名上升（2 → 1 或保持），至少有一次变化
	changed := false
	for _, e := range events {
		if e.TeamID == 10 && e.RankBefore != e.RankAfter {
			changed = true
		}
	}
	if !changed {
		t.Fatal("滚榜过程中队伍 A 的排名应发生变化")
	}
}

func TestReplayACMSubmissionSnapshotsAreIndependent(t *testing.T) {
	ctx := acmCtx()
	subs := []model.Submission{
		sub(1, 10, 1, model.StatusWrongAnswer, ctx.StartTime.Add(5*time.Minute)),
		sub(2, 10, 1, model.StatusAccepted, ctx.StartTime.Add(10*time.Minute)),
		sub(3, 11, 2, model.StatusAccepted, ctx.StartTime.Add(12*time.Minute)),
	}
	snapshots := ReplayACMSubmissionSnapshots(ctx, subs)
	if snapshots[1] == nil || snapshots[2] == nil || snapshots[3] == nil {
		t.Fatalf("每条终态提交都应有快照，得到 %#v", snapshots)
	}
	var first *ACMStanding
	for i := range snapshots[1] {
		if snapshots[1][i].TeamID == 10 {
			first = &snapshots[1][i]
		}
	}
	if first == nil || first.Problems[1].Solved || first.Problems[1].FailedAttempts != 1 {
		t.Fatalf("第一个 WA 快照不应被后续 AC 污染，得到 %#v", first)
	}
}
