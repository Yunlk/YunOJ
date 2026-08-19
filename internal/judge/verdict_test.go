package judge

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/yunoj/yunoj/internal/model"
)

func TestVerdictFromRunResourceLimits(t *testing.T) {
	limits := Limits{TimeMs: 1000, MemoryKb: 65536}
	tests := []struct {
		name string
		res  RunResult
		want string
	}{
		{"正常完成", RunResult{Status: "OK", MemoryKb: 1024}, verdictOK},
		{"超时", RunResult{Status: "TO", MemoryKb: 1024}, model.StatusTimeLimitExceeded},
		{"同时超时与超内存时优先 MLE", RunResult{Status: "TO", MemoryKb: 65537}, model.StatusMemoryLimitExceeded},
		{"输出文件超限信号", RunResult{Status: "SG", Signal: linuxSignalXFSZ, MemoryKb: 1024}, model.StatusOutputLimitExceeded},
		{"普通段错误", RunResult{Status: "SG", Signal: 11, MemoryKb: 1024}, model.StatusRuntimeError},
		{"cgroup OOM 优先判 MLE", RunResult{Status: "SG", Signal: 11, MemoryKb: 64000, OOMKilled: true}, model.StatusMemoryLimitExceeded},
		{"RE 但峰值超过限制", RunResult{Status: "RE", MemoryKb: 65537}, model.StatusMemoryLimitExceeded},
		{"正常退出但峰值超过限制", RunResult{Status: "OK", MemoryKb: 65537}, model.StatusMemoryLimitExceeded},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			if got := verdictFromRun(tc.res, limits); got != tc.want {
				t.Fatalf("期望 %s，实际 %s", tc.want, got)
			}
		})
	}
}

func TestApplyCaseVerdict(t *testing.T) {
	tests := []struct {
		name        string
		current     string
		caseStatus  string
		wantVerdict string
		wantStop    bool
	}{
		{"AC 保持继续", model.StatusAccepted, model.StatusAccepted, model.StatusAccepted, false},
		{"首个 WA 被记录但继续", model.StatusAccepted, model.StatusWrongAnswer, model.StatusWrongAnswer, false},
		{"后续 TLE 不覆盖首个 WA", model.StatusWrongAnswer, model.StatusTimeLimitExceeded, model.StatusWrongAnswer, false},
		{"SE 覆盖选手错误并停止", model.StatusWrongAnswer, model.StatusSystemError, model.StatusSystemError, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			gotVerdict, gotStop := applyCaseVerdict(tc.current, tc.caseStatus)
			if gotVerdict != tc.wantVerdict || gotStop != tc.wantStop {
				t.Fatalf("期望 (%s, %v)，实际 (%s, %v)", tc.wantVerdict, tc.wantStop, gotVerdict, gotStop)
			}
		})
	}
}

func TestAppendNotRunResults(t *testing.T) {
	results := appendNotRunResults(
		[]model.CaseResult{{CaseID: 1, Status: model.StatusWrongAnswer}},
		[]judgeCase{{Ordinal: 2}, {Ordinal: 4}},
	)
	if len(results) != 3 || results[1].CaseID != 2 || results[2].CaseID != 4 ||
		results[1].Status != model.StatusNotRun || results[2].Status != model.StatusNotRun {
		t.Fatalf("未运行测试点记录不正确: %#v", results)
	}
}

func TestParseMetaReadsCgroupOOM(t *testing.T) {
	path := filepath.Join(t.TempDir(), "meta.txt")
	meta := "status:SG\nexitsig:11\ncg-mem:65536\ncg-oom-killed:1\n"
	if err := os.WriteFile(path, []byte(meta), 0o600); err != nil {
		t.Fatal(err)
	}

	res, err := parseMeta(path)
	if err != nil {
		t.Fatal(err)
	}
	if !res.OOMKilled {
		t.Fatal("应识别 cg-oom-killed")
	}
	if res.MemoryKb != 65536 {
		t.Fatalf("期望内存 65536 KB，实际 %d KB", res.MemoryKb)
	}
}
