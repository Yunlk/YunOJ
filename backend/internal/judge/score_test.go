package judge

import (
	"testing"

	"github.com/yunoj/yunoj/internal/model"
)

// TestApplyAllOrNothing 整题通过才计分：未通过的提交不得留下部分分。
func TestApplyAllOrNothing(t *testing.T) {
	cases := []struct {
		name      string
		scores    []int
		verdict   string
		scoreMode string
		want      []int
	}{
		{"AC 保留得分", []int{243, 243}, model.StatusAccepted, model.ScoreModeAllOrNothing, []int{243, 243}},
		{"WA 清零（预测试只过一半）", []int{243, 0}, model.StatusWrongAnswer, model.ScoreModeAllOrNothing, []int{0, 0}},
		{"TLE 清零", []int{120}, model.StatusTimeLimitExceeded, model.ScoreModeAllOrNothing, []int{0}},
		{"partial 模式保留部分分", []int{243, 0}, model.StatusWrongAnswer, model.ScoreModePartial, []int{243, 0}},
		{"无比赛（空模式）保留部分分", []int{243, 0}, model.StatusWrongAnswer, "", []int{243, 0}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			scores := append([]int(nil), tc.scores...)
			applyAllOrNothing(scores, tc.verdict, tc.scoreMode)
			for i := range tc.want {
				if scores[i] != tc.want[i] {
					t.Fatalf("逐点得分期望 %v，实际 %v", tc.want, scores)
				}
			}
		})
	}
}

// TestContestScoreMode contestScoreMode 对空比赛上下文返回空模式（等价于不启用整题计分）。
func TestContestScoreMode(t *testing.T) {
	if got := contestScoreMode(nil); got != "" {
		t.Fatalf("无比赛时期望空模式，实际 %q", got)
	}
	if got := contestScoreMode(&model.Contest{ScoreMode: model.ScoreModePartial}); got != model.ScoreModePartial {
		t.Fatalf("期望 partial，实际 %q", got)
	}
}
