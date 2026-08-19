package contest

import (
	"sort"

	"github.com/yunoj/yunoj/internal/model"
)

// OIStanding OI/IOI 赛制下一条队伍排行。
type OIStanding struct {
	TeamID   int64
	TeamName string
	// TotalScore 总分
	TotalScore int
	// ProblemScores 各题当前得分
	ProblemScores map[int64]int
	// LastProblemScore 最后一题得分（同分 tie-breaker 用）
	LastProblemScore int
	// ProblemSubmissions 各题提交次数（提交次数限制校验用）
	ProblemSubmissions map[int64]int
	Rank               int
}

// SortOI 按配置的同分规则排序并填充 Rank。
// 默认：总分降序 → 最后一题得分降序（rankKeys 含 "last_problem_score" 时生效）→ 队伍 ID 升序。
func SortOI(standings []OIStanding, rankKeys []string) {
	useLastProblem := false
	for _, k := range rankKeys {
		if k == "last_problem_score" {
			useLastProblem = true
		}
	}
	sort.SliceStable(standings, func(i, j int) bool {
		a, b := standings[i], standings[j]
		if a.TotalScore != b.TotalScore {
			return a.TotalScore > b.TotalScore
		}
		if useLastProblem && a.LastProblemScore != b.LastProblemScore {
			return a.LastProblemScore > b.LastProblemScore
		}
		return a.TeamID < b.TeamID
	})
	for i := range standings {
		standings[i].Rank = i + 1
	}
}

// ProblemScore 由逐测试点得分计算某题一次提交的得分。
// caseScores 与测试点对齐；缺省部分按 0 计。
func ProblemScore(testcaseScores, caseScores []int) int {
	total := 0
	for i, full := range testcaseScores {
		if i < len(caseScores) {
			total += caseScores[i]
			continue
		}
		// 无逐点得分时视为未通过
		_ = full
	}
	return total
}

// CaseFullScores 归一化各测试点满分：优先用题目配置；未配置时平均分配 100 分
// （除不尽的余数补给最后一个测试点，保证总分恰为 100）。
func CaseFullScores(testcaseScores []int, testCount int) []int {
	if len(testcaseScores) > 0 {
		return testcaseScores
	}
	if testCount <= 0 {
		return nil
	}
	fulls := make([]int, testCount)
	base := 100 / testCount
	for i := range fulls {
		fulls[i] = base
	}
	fulls[testCount-1] += 100 - base*testCount
	return fulls
}

// BuildOIStandings 构建 OI 赛制排行榜。
// modeA 为 true 时是传统 OI：每題只取最后一次有效提交的得分；
// 为 false 时是 IOI 风格：每个测试点独立取该队所有提交中的最高分再求和。
// problemScores: 题目 ID → 各测试点满分（nil 表示均分，由调用方先归一化）。
func BuildOIStandings(ctx ContestContext, submissions []model.Submission,
	problemScores map[int64][]int, modeA bool) []OIStanding {

	byTeam := make(map[int64]*OIStanding, len(ctx.Teams))
	// 模式 B 的逐测试点最高分（中间状态，不导出）
	caseMax := make(map[int64]map[int64][]int, len(ctx.Teams))
	for id, name := range ctx.Teams {
		byTeam[id] = &OIStanding{
			TeamID:             id,
			TeamName:           name,
			ProblemScores:      map[int64]int{},
			ProblemSubmissions: map[int64]int{},
		}
		caseMax[id] = map[int64][]int{}
	}

	// 按提交时间排序（同分取末次时依赖顺序）
	sorted := append([]model.Submission(nil), submissions...)
	sort.SliceStable(sorted, func(i, j int) bool { return sorted[i].CreatedAt.Before(sorted[j].CreatedAt) })

	for _, sub := range sorted {
		st, ok := byTeam[sub.UserID]
		if !ok {
			continue
		}
		if !model.IsFinal(sub.Status) {
			continue // 未完成评测的不参与计分
		}
		st.ProblemSubmissions[sub.ProblemID]++

		fulls := problemScores[sub.ProblemID]

		if modeA {
			// 模式 A：末次提交覆盖（含 0 分提交）
			st.ProblemScores[sub.ProblemID] = ProblemScore(fulls, sub.CaseScores)
		} else {
			// 模式 B：每个测试点独立取所有提交中的最高分
			maxes := caseMax[sub.UserID][sub.ProblemID]
			if maxes == nil {
				maxes = make([]int, len(fulls))
				caseMax[sub.UserID][sub.ProblemID] = maxes
			}
			for i, s := range sub.CaseScores {
				if i < len(maxes) && s > maxes[i] {
					maxes[i] = s
				}
			}
		}
	}

	standings := make([]OIStanding, 0, len(byTeam))
	for _, st := range byTeam {
		total := 0
		for pid := range st.ProblemSubmissions {
			if modeA {
				total += st.ProblemScores[pid]
			} else {
				score := 0
				for _, v := range caseMax[st.TeamID][pid] {
					score += v
				}
				st.ProblemScores[pid] = score
				total += score
			}
		}
		st.TotalScore = total
		// 最后一题得分（按展示顺序）
		if n := len(ctx.Problems); n > 0 {
			st.LastProblemScore = st.ProblemScores[ctx.Problems[n-1]]
		}
		standings = append(standings, *st)
	}
	SortOI(standings, ctx.RankKeys)
	return standings
}
