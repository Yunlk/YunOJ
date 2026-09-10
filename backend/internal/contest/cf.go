package contest

import (
	"math"
	"sort"
	"time"

	"github.com/yunoj/yunoj/internal/model"
)

// Codeforces 风格赛制（CF）计分规则：
//
//   - 每道题有一个「初始满分」（比赛题目里的单题分值；未设置时取题目满分）。
//   - 分值随比赛进行线性衰减：开赛瞬间为 100%，比赛结束时降到 30%，之后不再下降。
//     提交得分在「提交时刻」确定（与 CF 一致：越早通过分越高）。
//   - 每题取该队各次 AC 提交中的最高得分（正常情况即首次 AC）。
//   - 罚时 = 首次通过该题的用时（分钟）+ 通过前的错误提交次数 × 罚时（CF 惯例 10 分钟）。
//     CE 不计入错误次数；未通过的题目不计罚时。
//   - 排名：总分降序 → 罚时升序 → 最后 AC 时间升序 → 队伍 ID。
//   - CF 不封榜，但引擎仍支持封榜参数（与 ACM 相同语义，便于复用与测试）。
const (
	// CFMinScoreRatio 衰减下限：比赛结束时保留初始分的比例。
	CFMinScoreRatio = 0.30
	// CFDefaultPenaltyMinutes 未配置罚时时的默认值（CF 为 10 分钟）。
	CFDefaultPenaltyMinutes = 10
)

// CFDecayScore 计算在 at 时刻提交可得的分数。
// start/end 为比赛时间窗；at 早于开始按满分，晚于结束按下限（30%）。
func CFDecayScore(initial int, at, start, end time.Time) int {
	if initial <= 0 {
		return 0
	}
	if !end.After(start) {
		return initial
	}
	ratio := 1.0
	if at.After(start) {
		elapsed := at.Sub(start).Seconds()
		total := end.Sub(start).Seconds()
		fraction := elapsed / total
		if fraction > 1 {
			fraction = 1
		}
		ratio = 1 - (1-CFMinScoreRatio)*fraction
	}
	score := int(math.Round(float64(initial) * ratio))
	if score < int(math.Round(float64(initial)*CFMinScoreRatio)) {
		score = int(math.Round(float64(initial) * CFMinScoreRatio))
	}
	if score > initial {
		score = initial
	}
	return score
}

// CFPenaltyMinutes 归一化罚时参数：未配置（0）时使用 CF 默认值。
func CFPenaltyMinutes(penaltyMinutes int) int {
	if penaltyMinutes <= 0 {
		return CFDefaultPenaltyMinutes
	}
	return penaltyMinutes
}

// CFProblemState 一支队伍在单题上的状态。
type CFProblemState struct {
	// Score 该题已得分数（各次 AC 中的最高分）
	Score          int
	FailedAttempts int
	SolvedAt       time.Time
	LastStatus     string
}

// CFStanding CF 赛制下一条队伍排行。
type CFStanding struct {
	TeamID   int64
	TeamName string
	// Score 总分（各题得分之和）
	Score int
	// Penalty 罚时（分钟）
	Penalty  int
	Solved   int
	LastAC   time.Time
	Rank     int
	Problems map[int64]*CFProblemState
}

// newCFStanding 创建队伍的空榜单条目。
func newCFStanding(teamID int64, teamName string, problems []int64) *CFStanding {
	ps := make(map[int64]*CFProblemState, len(problems))
	for _, p := range problems {
		ps[p] = &CFProblemState{}
	}
	return &CFStanding{TeamID: teamID, TeamName: teamName, Problems: ps}
}

// ProcessCF 按 CF 规则处理一条提交。返回 true 表示榜单数据发生变化。
// fallbackScore 用于提交记录里没有分数（历史数据）时按提交时刻现算分值。
func ProcessCF(standing *CFStanding, sub model.Submission, start, end time.Time,
	penaltyMinutes int, fallbackScore func(sub model.Submission) int) bool {

	if !model.IsFinal(sub.Status) {
		return false
	}
	ps := standing.Problems[sub.ProblemID]
	if ps == nil {
		return false // 非比赛题目
	}
	ps.LastStatus = sub.Status

	// 被 Hack 成功的提交整体作废（CF 规则）：既不算通过、也不计入错误次数与罚时。
	// 直接跳过即可等价于「按剩余仍有效的提交重算该题得分」：
	// 若该队还有其它有效 AC，会由那次提交正常计分；若没有，则该题不得分。
	if sub.IsHacked {
		ps.LastStatus = model.StatusWrongAnswer
		return true
	}

	if sub.Status == model.StatusAccepted {
		score := sub.Score
		if score <= 0 && fallbackScore != nil {
			score = fallbackScore(sub)
		}
		if ps.SolvedAt.IsZero() {
			// 首次通过：结算罚时（用时 + 通过前错误次数 × 罚时）
			elapsed := int(sub.CreatedAt.Sub(start).Minutes())
			if elapsed < 0 {
				elapsed = 0
			}
			ps.SolvedAt = sub.CreatedAt
			standing.Solved++
			standing.Penalty += elapsed + ps.FailedAttempts*CFPenaltyMinutes(penaltyMinutes)
			ps.Score = score
			standing.Score += score
			standing.LastAC = sub.CreatedAt
			return true
		}
		// 已通过：重测等情况可能给出更高分，取最高分但不重复计罚时
		if score > ps.Score {
			standing.Score += score - ps.Score
			ps.Score = score
			if sub.CreatedAt.After(standing.LastAC) {
				standing.LastAC = sub.CreatedAt
			}
			return true
		}
		return true
	}

	if sub.Status == model.StatusCompileError {
		return true // CE 不计入错误次数，仅刷新展示状态
	}
	ps.FailedAttempts++
	return true
}

// SortCF 排序并填充 Rank：总分降序 → 罚时升序 → 最后 AC 升序 → 队伍 ID。
func SortCF(standings []CFStanding) {
	sort.SliceStable(standings, func(i, j int) bool {
		a, b := standings[i], standings[j]
		if a.Score != b.Score {
			return a.Score > b.Score
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

// BuildCFStandings 从提交记录构建 CF 风格排行榜。
// initialScores: 题目 ID → 初始满分（用于历史数据现算分值）。
// frozenBefore 非零时，提交时间 ≥ frozenBefore 的提交视为冻结并单独返回。
func BuildCFStandings(ctx ContestContext, submissions []model.Submission,
	initialScores map[int64]int, penaltyMinutes int, frozenBefore time.Time) ([]CFStanding, []model.Submission) {

	byTeam := make(map[int64]*CFStanding, len(ctx.Teams))
	for id, name := range ctx.Teams {
		byTeam[id] = newCFStanding(id, name, ctx.Problems)
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
		fallback := func(s model.Submission) int {
			return CFDecayScore(initialScores[s.ProblemID], s.CreatedAt, ctx.StartTime, ctx.EndTime)
		}
		ProcessCF(st, sub, ctx.StartTime, ctx.EndTime, penaltyMinutes, fallback)
	}

	standings := make([]CFStanding, 0, len(byTeam))
	for _, st := range byTeam {
		// Hack 得分计入总分（CF 规则：成功 +100、失败 -50）
		if ctx.HackPoints != nil {
			st.Score += ctx.HackPoints[st.TeamID]
		}
		standings = append(standings, *st)
	}
	SortCF(standings)
	return standings, frozen
}
