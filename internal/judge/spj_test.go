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
		{"PE 按 WA", "", 2, 100, model.StatusWrongAnswer, 0},
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
	problem := model.Problem{TestcaseScores: []int{10, 20, 30, 40}}
	results := []model.CaseResult{
		{CaseID: 1, Status: model.StatusAccepted},
		{CaseID: 2, Status: model.StatusAccepted},
		{CaseID: 3, Status: model.StatusWrongAnswer},
		{CaseID: 4, Status: model.StatusAccepted},
	}
	scores := computeStandardScores(problem, results)
	want := []int{10, 20, 0, 40}
	if !reflect.DeepEqual(scores, want) {
		t.Fatalf("期望 %v，实际 %v", want, scores)
	}
}

func TestComputeStandardScoresEvenSplit(t *testing.T) {
	// 未配置分数时 100 平均分给 3 个测试点（余数补给最后一点）
	problem := model.Problem{}
	results := []model.CaseResult{
		{CaseID: 1, Status: model.StatusAccepted},
		{CaseID: 2, Status: model.StatusAccepted},
		{CaseID: 3, Status: model.StatusAccepted},
	}
	scores := computeStandardScores(problem, results)
	want := []int{33, 33, 34}
	if !reflect.DeepEqual(scores, want) {
		t.Fatalf("期望 %v，实际 %v", want, scores)
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
