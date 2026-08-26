package judge

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"

	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
)

// 临时测试运行（自测 / 样例测试）的类型定义与执行逻辑。
// 与正式提交评测的区别：不落库、不计数，输入由请求方提供（而非测试数据文件），
// 结果通过 Redis 回传给等待中的 HTTP 请求。

const maxTestOutputBytes = 64 << 10 // 单次运行返回的输出上限 64KB

// TestTask 一次测试运行任务（JSON 编码后在 Redis 队列中传递）。
type TestTask struct {
	RunID     string `json:"run_id"`
	ProblemID int64  `json:"problem_id"`
	Language  string `json:"language"`
	Code      string `json:"code"`
	// Optimize 是否开启 -O2 优化（C/C++）
	Optimize bool        `json:"optimize"`
	Cases    []TestInput `json:"cases"`
}

// TestInput 单个运行用例。Expected 非空表示需要比较输出（样例测试）。
type TestInput struct {
	Input    string `json:"input"`
	Expected string `json:"expected,omitempty"`
}

// TestResult 测试运行结果。
type TestResult struct {
	Status       string           `json:"status"`
	CompileError string           `json:"compile_error,omitempty"`
	Cases        []TestCaseResult `json:"cases"`
}

// TestCaseResult 单个用例的运行结果。
type TestCaseResult struct {
	Status   string `json:"status"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr,omitempty"`
	TimeMs   int    `json:"time_ms"`
	MemoryKb int    `json:"memory_kb"`
	// Passed 仅在提供期望输出（样例测试）时非 nil
	Passed *bool `json:"passed,omitempty"`
}

// Test 在沙箱内完成「编译 → 逐用例运行（→ 与期望输出比较）」。
// 只依赖传入的输入，不读取题目测试数据文件。
func (r *Runner) Test(ctx context.Context, task TestTask) TestResult {
	res := TestResult{Status: model.StatusSystemError}

	lang, ok := langs.ByKey(task.Language)
	if !ok {
		res.CompileError = "不支持的语言: " + task.Language
		return res
	}
	if err := r.Sandbox.InitBox(ctx, r.BoxID); err != nil {
		slog.Error("测试沙箱初始化失败", "err", err)
		res.CompileError = "沙箱初始化失败"
		return res
	}

	boxDir := r.Sandbox.BoxDir(r.BoxID)
	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(task.Code), 0o644); err != nil {
		res.CompileError = "写入源码失败"
		return res
	}
	if lang.Compile != nil {
		if stderr, ok := r.compile(ctx, lang, task.Optimize); !ok {
			res.Status = model.StatusCompileError
			res.CompileError = stderr
			return res
		}
	}

	problem, err := r.Store.GetProblem(ctx, task.ProblemID)
	if err != nil {
		res.CompileError = "题目不存在"
		return res
	}

	res.Status = model.StatusAccepted
	for _, tc := range task.Cases {
		cr := r.runTestInput(ctx, boxDir, tc, problem, lang)
		res.Cases = append(res.Cases, cr)
		if cr.Status != model.StatusAccepted {
			res.Status = cr.Status
		}
	}
	return res
}

// runTestInput 运行单个用例。tc.Expected 非空时与输出做 token 比较。
func (r *Runner) runTestInput(ctx context.Context, boxDir string, tc TestInput,
	problem model.Problem, lang langs.Language) TestCaseResult {

	cr := TestCaseResult{Status: model.StatusSystemError}

	limits := Limits{
		TimeMs:     scaleInt(problem.TimeLimitMs, lang.TimeFactor),
		WallTimeMs: scaleInt(problem.TimeLimitMs, lang.TimeFactor) * 2,
		MemoryKb:   scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		FileSizeKb: defaultOutputLimitKb,
		StackKb:    scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		Processes:  16,
	}

	if err := prepareRunFiles(boxDir, []byte(tc.Input)); err != nil {
		return cr
	}
	run, err := r.Sandbox.Run(ctx, r.BoxID, limits,
		"stdin.txt", "stdout.txt", "stderr.txt", lang.RunCommand...)
	if err != nil || run.Status == "SE" {
		slog.Error("测试用例沙箱运行失败", "err", err)
		return cr
	}
	cr.TimeMs, cr.MemoryKb = run.TimeMs, run.MemoryKb

	if v := verdictFromRun(run, limits); v != verdictOK {
		cr.Status = v
		return cr
	}

	out, err := os.ReadFile(filepath.Join(boxDir, "stdout.txt"))
	if err != nil {
		return cr
	}
	if len(out) > maxTestOutputBytes {
		out = out[:maxTestOutputBytes]
	}
	cr.Stdout = string(out)
	if stderr := readCaptured(filepath.Join(boxDir, "stderr.txt")); stderr != "" {
		cr.Stderr = stderr
	}

	if tc.Expected != "" {
		passed := TokenCompare(tc.Expected, cr.Stdout)
		cr.Passed = &passed
		if passed {
			cr.Status = model.StatusAccepted
		} else {
			cr.Status = model.StatusWrongAnswer
		}
	} else {
		cr.Status = model.StatusAccepted
	}
	return cr
}
