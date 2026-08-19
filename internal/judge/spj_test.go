package judge

import (
	"reflect"
	"testing"

	"github.com/yunoj/yunoj/internal/model"
)

func TestParseSPJOutput(t *testing.T) {
	cases := []struct {
		name     string
		stdout   string
		exitCode int
		full     int
		wantSt   string
		wantSc   int
	}{
		{"AC 无分数输出", "", 0, 100, model.StatusAccepted, 100},
		{"AC 带部分分", "60.0\n", 0, 100, model.StatusAccepted, 60},
		{"AC 带部分分取整", "33.33\n", 0, 100, model.StatusAccepted, 33},
		{"AC 分数行后有多余输出", "100\nxxx", 0, 100, model.StatusAccepted, 100},
		{"AC 非法分数行回退满分", "not-a-number\n", 0, 100, model.StatusAccepted, 100},
		{"WA", "", 1, 100, model.StatusWrongAnswer, 0},
		{"PE", "", 2, 100, model.StatusPresentationError, 0},
		{"SE", "", 3, 100, model.StatusSystemError, 0},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			st, sc := parseSPJOutput(tc.stdout, tc.exitCode, tc.full)
			if st != tc.wantSt || sc != tc.wantSc {
				t.Fatalf("期望 (%s,%d)，实际 (%s,%d)", tc.wantSt, tc.wantSc, st, sc)
			}
		})
	}
}

func TestInteractiveCommand(t *testing.T) {
	got := interactiveCommand([]string{"./main"}, []string{"./interactor", "case.in"})
	want := []string{"/bin/sh", "-c", "exec ./main < f1 > f2 & ./interactor case.in > f1 < f2"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("期望 %v，实际 %v", want, got)
	}
}

func TestComputeStandardScores(t *testing.T) {
	cases := []judgeCase{
		{Ordinal: 1, Score: 10}, {Ordinal: 2, Score: 20},
		{Ordinal: 3, Score: 30}, {Ordinal: 4, Score: 40},
	}
	results := []model.CaseResult{
		{CaseID: 1, Status: model.StatusAccepted},
		{CaseID: 2, Status: model.StatusAccepted},
		{CaseID: 3, Status: model.StatusWrongAnswer},
		{CaseID: 4, Status: model.StatusAccepted},
	}
	scores := computeStandardScores(cases, results)
	want := []int{10, 20, 0, 40}
	if !reflect.DeepEqual(scores, want) {
		t.Fatalf("期望 %v，实际 %v", want, scores)
	}
}

func TestScaleJudgeCases(t *testing.T) {
	// 100 分缩放到 150：等比例放大，余数补给最后一点，总分精确
	cases := []judgeCase{
		{Ordinal: 1, Score: 30}, {Ordinal: 2, Score: 30}, {Ordinal: 3, Score: 40},
	}
	scaled := scaleJudgeCases(cases, 150)
	want := []int{45, 45, 60}
	for i, c := range scaled {
		if c.Score != want[i] {
			t.Fatalf("case %d 期望 %d，实际 %d", i, want[i], c.Score)
		}
	}
	// 缩放到 50：30*50/100=15, 30→15, 40→50-30=20
	scaled2 := scaleJudgeCases(cases, 50)
	want2 := []int{15, 15, 20}
	for i, c := range scaled2 {
		if c.Score != want2[i] {
			t.Fatalf("case %d 期望 %d，实际 %d", i, want2[i], c.Score)
		}
	}
	// 目标与总分相同：原样返回
	scaled3 := scaleJudgeCases(cases, 100)
	for i, c := range scaled3 {
		if c.Score != cases[i].Score {
			t.Fatalf("case %d 应保持不变", i)
		}
	}
	// 总分为 0：原样返回（防御）
	zero := []judgeCase{{Ordinal: 1, Score: 0}}
	if got := scaleJudgeCases(zero, 100); got[0].Score != 0 {
		t.Fatalf("总分 0 时应保持原样")
	}
}

func TestVerdictInteractive(t *testing.T) {
	cases := []struct {
		name string
		res  RunResult
		want string
	}{
		{"AC", RunResult{Status: "OK", ExitCode: 0}, model.StatusAccepted},
		{"WA", RunResult{Status: "OK", ExitCode: 1}, model.StatusWrongAnswer},
		{"WA-RE状态但exit1", RunResult{Status: "RE", ExitCode: 1}, model.StatusWrongAnswer},
		{"交互器异常", RunResult{Status: "OK", ExitCode: 2}, model.StatusSystemError},
		{"TLE", RunResult{Status: "TO"}, model.StatusTimeLimitExceeded},
		{"交互器崩溃(信号)", RunResult{Status: "RE", Signal: 11}, model.StatusSystemError},
		{"OLE", RunResult{Status: "XX"}, model.StatusOutputLimitExceeded},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := verdictInteractive(tc.res); got != tc.want {
				t.Fatalf("期望 %s，实际 %s", tc.want, got)
			}
		})
	}
}
