package judge

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"time"

	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/queue"
	"github.com/yunoj/yunoj/internal/store"
)

const (
	verdictOK              = "ok"      // 运行层面正常，等待比较输出
	defaultOutputLimitKb   = 16 * 1024 // 单次运行输出文件上限 16MB
	compileExtraWallTimeMs = 10_000
	maxCompileErrorBytes   = 16 * 1024
)

// Runner 评测单个提交。每个评测 worker 独占一个 Runner 与沙箱编号，
// 因此无需并发控制。
type Runner struct {
	Store   *store.Store
	Sandbox Sandbox
	BoxID   int
	DataDir string
	// Queue 可选：用于比赛排行榜更新事件推送
	Queue *queue.Queue
}

// Judge 评测一条提交并把最终结果写回数据库。
func (r *Runner) Judge(ctx context.Context, submissionID int64) error {
	logger := slog.With("submission_id", submissionID)

	sub, err := r.Store.GetSubmission(ctx, submissionID)
	if err != nil {
		return err
	}
	if sub.Status != model.StatusPending {
		return nil // 已处理过（重复消费等场景），跳过
	}

	problem, err := r.Store.GetProblem(ctx, sub.ProblemID)
	if err != nil {
		return err
	}
	lang, ok := langs.ByKey(sub.Language)
	if !ok {
		_ = r.Store.SetJudged(ctx, submissionID, model.StatusSystemError,
			"不支持的语言: "+sub.Language, nil, 0, 0)
		return nil
	}
	first, err := r.Store.IsFirstJudge(ctx, submissionID)
	if err != nil {
		return err
	}
	if err := r.Store.SetRunning(ctx, submissionID); err != nil {
		return err
	}

	verdict := model.StatusSystemError
	compileError := ""
	var results []model.CaseResult
	var scores []int
	timeMs, memoryKb := 0, 0

	if err := r.Sandbox.InitBox(ctx, r.BoxID); err != nil {
		compileError = "沙箱初始化失败"
		logger.Error("sandbox init", "err", err)
	} else {
		// 调度器：按题目类型分发到对应评测流水线
		switch problem.Type {
		case model.ProblemTypeSPJ:
			verdict, compileError, results, scores, timeMs, memoryKb = r.judgeSPJInBox(ctx, sub, problem, lang)
		case model.ProblemTypeInteractive:
			verdict, compileError, results, scores, timeMs, memoryKb = r.judgeInteractiveInBox(ctx, sub, problem, lang)
		case model.ProblemTypeStandard, "":
			verdict, compileError, results, timeMs, memoryKb = r.judgeInBox(ctx, sub, problem, lang)
			scores = computeStandardScores(problem, results)
		default:
			compileError = "暂不支持的题目类型: " + problem.Type
		}
	}

	// 仅首次评测更新题目计数，重测不重复计数
	if first && model.IsFinal(verdict) {
		if err := r.Store.AddSubmission(ctx, sub.ProblemID, verdict == model.StatusAccepted); err != nil {
			logger.Error("update problem counters", "err", err)
		}
	}

	if sub.ContestID != nil {
		// 比赛提交：计算总分与冻结标记，并推送排行榜更新事件
		total := 0
		for _, s := range scores {
			total += s
		}
		frozen := false
		if c, err := r.Store.GetContest(ctx, *sub.ContestID); err == nil {
			freezeAt := c.EndTime.Add(-time.Duration(c.FreezeDurationMinutes) * time.Minute)
			frozen = !sub.CreatedAt.Before(freezeAt)
		}
		if err := r.Store.SetJudgedFull(ctx, submissionID, verdict, compileError, results, scores,
			timeMs, memoryKb, total, frozen); err != nil {
			return err
		}
		if r.Queue != nil {
			_ = r.Queue.PublishContestUpdate(ctx, *sub.ContestID)
		}
	} else {
		if err := r.Store.SetJudged(ctx, submissionID, verdict, compileError, results, timeMs, memoryKb); err != nil {
			return err
		}
	}
	logger.Info("judged", "verdict", verdict, "score", sumInts(scores), "time_ms", timeMs, "memory_kb", memoryKb)
	return nil
}

// computeStandardScores 按逐点结果与测试点满分计算普通题目的各点得分。
func computeStandardScores(problem model.Problem, results []model.CaseResult) []int {
	fulls := caseFullScores(problem, len(results))
	scores := make([]int, len(results))
	for i, r := range results {
		if i < len(fulls) && r.Status == model.StatusAccepted {
			scores[i] = fulls[i]
		}
	}
	return scores
}

func sumInts(vals []int) int {
	total := 0
	for _, v := range vals {
		total += v
	}
	return total
}

// judgeInBox 在沙箱内完成「写源码 → 编译 → 逐点运行比较」全流程。
func (r *Runner) judgeInBox(ctx context.Context, sub model.Submission, problem model.Problem, lang langs.Language) (
	verdict, compileError string, results []model.CaseResult, timeMs, memoryKb int) {

	boxDir := r.Sandbox.BoxDir(r.BoxID)

	// 1. 写入源码
	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(sub.Code), 0o644); err != nil {
		return model.StatusSystemError, "写入源码失败", nil, 0, 0
	}

	// 2. 编译（如需要）
	if lang.Compile != nil {
		if stderr, ok := r.compile(ctx, lang, sub.Optimize); !ok {
			return model.StatusCompileError, stderr, nil, 0, 0
		}
	}

	// 3. 读取测试数据
	cases, err := data.ListTests(r.DataDir, sub.ProblemID)
	if err != nil {
		return model.StatusSystemError, "读取测试数据失败", nil, 0, 0
	}
	if len(cases) == 0 {
		return model.StatusSystemError, "该题目没有测试数据，请联系管理员", nil, 0, 0
	}

	// 4. 逐点运行，首个非 AC 即停止（与主流 OJ 一致）
	verdict = model.StatusAccepted
	for i, tc := range cases {
		cr := r.runCase(ctx, boxDir, tc, i+1, problem, lang)
		results = append(results, cr)
		if cr.TimeMs > timeMs {
			timeMs = cr.TimeMs
		}
		if cr.MemoryKb > memoryKb {
			memoryKb = cr.MemoryKb
		}
		if cr.Status != model.StatusAccepted {
			verdict = cr.Status
			break
		}
	}
	return verdict, "", results, timeMs, memoryKb
}

// compile 在沙箱内编译，失败时返回截断后的编译错误信息。
// optimize 控制是否使用开启优化（-O2）的编译命令。
func (r *Runner) compile(ctx context.Context, lang langs.Language, optimize bool) (string, bool) {
	return r.compileFile(ctx, lang, lang.SourceFile, "main", optimize)
}

// compileFile 在沙箱内编译任意源码文件（SPJ/交互器也走这里）。
// 假定语言编译命令的末尾两个参数依次为「输出文件名」「源文件名」。
func (r *Runner) compileFile(ctx context.Context, lang langs.Language, sourceFileName, outputName string, optimize bool) (string, bool) {
	cc := lang.Compile
	command := cc.Command
	if !optimize && cc.CommandNoO2 != nil {
		command = cc.CommandNoO2
	}
	cmd := append([]string(nil), command...)
	if len(cmd) >= 2 {
		cmd[len(cmd)-1] = sourceFileName
		cmd[len(cmd)-2] = outputName
	}
	limits := Limits{
		TimeMs:     cc.TimeMs,
		WallTimeMs: cc.TimeMs + compileExtraWallTimeMs,
		MemoryKb:   cc.MemoryKb,
		FileSizeKb: 64 * 1024,
		StackKb:    256 * 1024,
		Processes:  64,
	}
	if err := prepareRunFiles(r.Sandbox.BoxDir(r.BoxID), nil); err != nil {
		return "沙箱文件准备失败", false
	}
	res, err := r.Sandbox.Run(ctx, r.BoxID, limits,
		"stdin.txt", "stdout.txt", "stderr.txt", cmd...)
	if err != nil || res.Status == "SE" {
		slog.Error("编译沙箱运行失败", "err", err)
		return "沙箱运行失败", false
	}
	if res.Status != "OK" || res.ExitCode != 0 {
		stderr := readCaptured(filepath.Join(r.Sandbox.BoxDir(r.BoxID), "stderr.txt"))
		if stderr == "" {
			stderr = fmt.Sprintf("编译器异常退出（status=%s, exit=%d）", res.Status, res.ExitCode)
		}
		return stderr, false
	}
	return "", true
}

// runCase 运行单个测试点并判定。
func (r *Runner) runCase(ctx context.Context, boxDir string, tc data.TestCase, caseID int,
	problem model.Problem, lang langs.Language) model.CaseResult {

	cr := model.CaseResult{CaseID: caseID}

	limits := Limits{
		TimeMs:     scaleInt(problem.TimeLimitMs, lang.TimeFactor),
		WallTimeMs: scaleInt(problem.TimeLimitMs, lang.TimeFactor) * 2,
		MemoryKb:   scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		FileSizeKb: defaultOutputLimitKb,
		StackKb:    scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		Processes:  16,
	}

	inData, err := os.ReadFile(tc.InputPath)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr
	}
	if err := prepareRunFiles(boxDir, inData); err != nil {
		cr.Status = model.StatusSystemError
		return cr
	}

	res, err := r.Sandbox.Run(ctx, r.BoxID, limits,
		"stdin.txt", "stdout.txt", "stderr.txt", lang.RunCommand...)
	if err != nil || res.Status == "SE" {
		slog.Error("用例沙箱运行失败", "case_id", caseID, "err", err)
		cr.Status = model.StatusSystemError
		return cr
	}
	cr.TimeMs, cr.MemoryKb = res.TimeMs, res.MemoryKb

	if v := verdictFromRun(res, limits); v != verdictOK {
		cr.Status = v
		return cr
	}

	outData, err := os.ReadFile(filepath.Join(boxDir, "stdout.txt"))
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr
	}
	expData, err := os.ReadFile(tc.OutputPath)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr
	}
	if TokenCompare(string(expData), string(outData)) {
		cr.Status = model.StatusAccepted
	} else {
		cr.Status = model.StatusWrongAnswer
	}
	return cr
}

// verdictFromRun 把 isolate 运行结果映射为判题状态。
// 返回 verdictOK 表示运行正常，可继续比较输出。
func verdictFromRun(res RunResult, limits Limits) string {
	switch res.Status {
	case "TO":
		return model.StatusTimeLimitExceeded
	case "XX":
		return model.StatusOutputLimitExceeded
	case "SG":
		if res.Signal != 0 {
			return model.StatusRuntimeError
		}
		if res.MemoryKb > limits.MemoryKb {
			return model.StatusMemoryLimitExceeded
		}
		return model.StatusRuntimeError
	case "RE":
		return model.StatusRuntimeError
	}
	if res.ExitCode != 0 {
		return model.StatusRuntimeError
	}
	// 兜底：isolate 偶有边界取整，留 5% 余量再自行判断
	if res.TimeMs > int(float64(limits.TimeMs)*1.05) {
		return model.StatusTimeLimitExceeded
	}
	if res.MemoryKb > limits.MemoryKb {
		return model.StatusMemoryLimitExceeded
	}
	return verdictOK
}

// prepareRunFiles 准备一次运行所需的文件：写入 stdin（nil 表示空），
// 并删除旧的 stdout/stderr（由沙箱进程以自身权限重建，避免属主问题）。
func prepareRunFiles(boxDir string, stdinData []byte) error {
	if stdinData == nil {
		stdinData = []byte{}
	}
	if err := os.WriteFile(filepath.Join(boxDir, "stdin.txt"), stdinData, 0o644); err != nil {
		return err
	}
	_ = os.Remove(filepath.Join(boxDir, "stdout.txt"))
	_ = os.Remove(filepath.Join(boxDir, "stderr.txt"))
	return nil
}

// readCaptured 读取沙箱内捕获的输出，限制读取大小。
func readCaptured(path string) string {
	b, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	if len(b) > maxCompileErrorBytes {
		b = b[:maxCompileErrorBytes]
	}
	return string(b)
}

func scaleInt(v int, factor float64) int {
	return int(math.Round(float64(v) * factor))
}
