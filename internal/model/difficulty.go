package model

import "math"

const (
	DifficultyBeginner   = 1
	DifficultyBasic      = 2
	DifficultyPopular    = 3
	DifficultyPopularP   = 4
	DifficultyAdvanced   = 5
	DifficultyExpert     = 6
	DifficultyProvincial = 7
	DifficultyNOI        = 8
	DifficultyLimit      = 9

	MinDifficulty = DifficultyBeginner
	MaxDifficulty = DifficultyLimit
)

// DifficultyWeight 返回全站排名使用的题目权重。
func DifficultyWeight(difficulty int) float64 {
	switch difficulty {
	case DifficultyBeginner:
		return 1.0
	case DifficultyBasic:
		return 1.2
	case DifficultyPopular:
		return 1.5
	case DifficultyPopularP:
		return 1.8
	case DifficultyAdvanced:
		return 2.2
	case DifficultyExpert:
		return 2.7
	case DifficultyProvincial:
		return 3.3
	case DifficultyNOI:
		return 4.0
	case DifficultyLimit:
		return 5.0
	default:
		return 0
	}
}

// CalculateRating 按已解决题目、比赛一血和有效通过率计算综合分。
func CalculateRating(weightedSolved float64, firstBloods, solved, attempted int64) int {
	passRate := 0.0
	if attempted > 0 {
		passRate = float64(solved) / float64(attempted)
	}
	score := (weightedSolved + 0.1*float64(firstBloods)) * (0.7 + 0.3*passRate) * 40
	return 1000 + int(math.Round(score))
}
