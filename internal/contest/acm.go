// Package contest 实现比赛计分与排行榜引擎。
// 全部为纯函数（无数据库/网络依赖），便于单元测试与复用。
package contest

import (
	"sort"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

// ContestContext 排行榜计算所需的比赛上下文。
type ContestContext struct {
	StartTime      time.Time
	PenaltyMinutes int
	// Problems 比赛题目 ID 列表（按展示顺序）
	Problems []int64
	// Teams 队伍 ID → 队伍名
	Teams map[int64]string
	// RankKeys 同分排序键（OI 赛制使用，如 "last_problem_score"）
	RankKeys []string
}

// ACMProblemState 一支队伍在单题上的状态。
type ACMProblemState struct {
	Solved         bool
	FailedAttempts int
	SolvedAt       time.Time
}

// ACMStanding ACM 赛制下一条队伍排行。
type ACMStanding struct {
	TeamID   int64
	TeamName string
	Solved   int
	Penalty  int
	LastAC   time.Time
	Rank     int
	Problems map[int64]*ACMProblemState
}

// ProcessACM 按 ACM/ICPC 规则处理一条提交，更新队伍状态。
// 返回 true 表示榜单数据发生变化（需要重排）。
// 规则：AC 计罚时 = 比赛开始到 AC 的分钟数 + 此前错误提交次数 × 罚时；
// 未 AC 的错误提交不罚时；CE 不计入错误次数。
func ProcessACM(standing *ACMStanding, sub model.Submission, start time.Time, penaltyMinutes int) bool {
	if !model.IsFinal(sub.Status) {
		return false
	}
	ps := standing.Problems[sub.ProblemID]
	if ps == nil {
		return false // 非比赛题目
	}
	if ps.Solved {
		return false // 已解决，后续提交不影响榜单
	}
	if sub.Status == model.StatusAccepted {
		ps.Solved = true
		ps.SolvedAt = sub.CreatedAt
		elapsed := int(sub.CreatedAt.Sub(start).Minutes())
		if elapsed < 0 {
			elapsed = 0
		}
		standing.Solved++
		standing.Penalty += elapsed + ps.FailedAttempts*penaltyMinutes
		if ps.SolvedAt.After(standing.LastAC) {
			standing.LastAC = ps.SolvedAt
		}
		return true
	}
	if sub.Status != model.StatusCompileError {
		ps.FailedAttempts++
		return true
	}
	return false
}

// newACMStanding 创建队伍的空榜单条目。
func newACMStanding(teamID int64, teamName string, problems []int64) *ACMStanding {
	ps := make(map[int64]*ACMProblemState, len(problems))
	for _, p := range problems {
		ps[p] = &ACMProblemState{}
	}
	return &ACMStanding{
		TeamID:   teamID,
		TeamName: teamName,
		Problems: ps,
	}
}

// SortACM 按 tie-breaker 排序并填充 Rank：
// 解题数降序 → 罚时升序 → 最后 AC 时间升序 → 队伍 ID 升序（稳定兜底）。
func SortACM(standings []ACMStanding) {
	sort.SliceStable(standings, func(i, j int) bool {
		a, b := standings[i], standings[j]
		if a.Solved != b.Solved {
			return a.Solved > b.Solved
		}
		if a.Penalty != b.Penalty {
			return a.Penalty < b.Penalty
		}
		if !a.LastAC.Equal(b.LastAC) {
			return a.LastAC.Before(b.LastAC)
		}
		return a.TeamID < b.TeamID
	})
	for i := range standings {
		standings[i].Rank = i + 1
	}
}

// BuildACMStandings 从提交记录构建 ACM 排行榜。
// frozenBefore 非零时，提交时间 ≥ frozenBefore 的提交视为冻结：
// 不计入公开榜单，而是收集进 frozen 返回值（供滚榜使用）。
func BuildACMStandings(ctx ContestContext, submissions []model.Submission, frozenBefore time.Time) ([]ACMStanding, []model.Submission) {
	byTeam := make(map[int64]*ACMStanding, len(ctx.Teams))
	for id, name := range ctx.Teams {
		byTeam[id] = newACMStanding(id, name, ctx.Problems)
	}

	var frozen []model.Submission
	for _, sub := range submissions {
		if sub.IsFrozen || (!frozenBefore.IsZero() && !sub.CreatedAt.Before(frozenBefore)) {
			frozen = append(frozen, sub)
			continue
		}
		st, ok := byTeam[sub.UserID]
		if !ok {
			continue
		}
		ProcessACM(st, sub, ctx.StartTime, ctx.PenaltyMinutes)
	}

	standings := make([]ACMStanding, 0, len(byTeam))
	for _, st := range byTeam {
		standings = append(standings, *st)
	}
	SortACM(standings)
	return standings, frozen
}

// RollEvent 滚榜过程中一次「解冻」事件：
// 揭示一条冻结提交后，队伍排名从 RankBefore 变为 RankAfter，
// Standings 为该步之后的完整榜单快照。
type RollEvent struct {
	Submission model.Submission
	TeamID     int64
	TeamName   string
	RankBefore int
	RankAfter  int
	Standings  []ACMStanding
}

// CloneACMStandings 深拷贝榜单及各题状态。事件快照不能与后续步骤
// 继续修改的工作副本共享 map 或状态指针。
func CloneACMStandings(in []ACMStanding) []ACMStanding {
	out := make([]ACMStanding, len(in))
	for i, standing := range in {
		out[i] = standing
		out[i].Problems = make(map[int64]*ACMProblemState, len(standing.Problems))
		for problemID, state := range standing.Problems {
			if state == nil {
				out[i].Problems[problemID] = nil
				continue
			}
			cloned := *state
			out[i].Problems[problemID] = &cloned
		}
	}
	return out
}

// ReplayACMSubmissionSnapshots 按提交顺序重放公开提交，为每条终态提交生成
// 处理后的榜单快照。实时榜单用这些快照逐条播放并发评测结果。
func ReplayACMSubmissionSnapshots(ctx ContestContext, submissions []model.Submission) map[int64][]ACMStanding {
	standings := make([]ACMStanding, 0, len(ctx.Teams))
	for teamID, teamName := range ctx.Teams {
		standings = append(standings, *newACMStanding(teamID, teamName, ctx.Problems))
	}
	SortACM(standings)

	snapshots := make(map[int64][]ACMStanding)
	for _, sub := range submissions {
		if !model.IsFinal(sub.Status) {
			continue
		}
		index := -1
		for i := range standings {
			if standings[i].TeamID == sub.UserID {
				index = i
				break
			}
		}
		if index < 0 {
			continue
		}
		ProcessACM(&standings[index], sub, ctx.StartTime, ctx.PenaltyMinutes)
		SortACM(standings)
		snapshots[sub.ID] = CloneACMStandings(standings)
	}
	return snapshots
}

// RollBoard 滚榜算法。
// 从当前排行榜排名最后的队伍开始，逐个解冻其编号最小的冻结提交；
// 每解冻一条立即重算排名并输出该步的排名变化（用于直播展示）。
func RollBoard(ctx ContestContext, base []ACMStanding, frozen []model.Submission) []RollEvent {
	// 工作副本
	standings := CloneACMStandings(base)
	index := make(map[int64]int, len(standings))
	for i, st := range standings {
		index[st.TeamID] = i
	}

	// 冻结提交按队伍分组，组内按提交 ID 升序（编号最小先解冻）
	byTeam := make(map[int64][]model.Submission)
	var teamOrder []int64
	for _, sub := range frozen {
		if _, ok := index[sub.UserID]; !ok {
			continue
		}
		if _, seen := byTeam[sub.UserID]; !seen {
			teamOrder = append(teamOrder, sub.UserID)
		}
		byTeam[sub.UserID] = append(byTeam[sub.UserID], sub)
	}
	// 队伍顺序：按当前排名从后到前（排名最后的队伍先解冻）
	sort.Slice(teamOrder, func(i, j int) bool {
		return standings[index[teamOrder[i]]].Rank > standings[index[teamOrder[j]]].Rank
	})
	for _, tid := range teamOrder {
		subs := byTeam[tid]
		sort.Slice(subs, func(i, j int) bool { return subs[i].ID < subs[j].ID })
	}

	events := make([]RollEvent, 0, len(frozen))
	for _, tid := range teamOrder {
		for _, sub := range byTeam[tid] {
			i := index[tid]
			rankBefore := standings[i].Rank
			ProcessACM(&standings[i], sub, ctx.StartTime, ctx.PenaltyMinutes)
			SortACM(standings)
			// 重排后重建索引
			index = make(map[int64]int, len(standings))
			for k, st := range standings {
				index[st.TeamID] = k
			}
			events = append(events, RollEvent{
				Submission: sub,
				TeamID:     tid,
				TeamName:   standings[index[tid]].TeamName,
				RankBefore: rankBefore,
				RankAfter:  standings[index[tid]].Rank,
				Standings:  CloneACMStandings(standings),
			})
		}
	}
	return events
}
