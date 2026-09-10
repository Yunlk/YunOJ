package judge

import (
	"context"
	"fmt"
	"log/slog"
	"os"

	"path/filepath"
	"strings"

	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
)

const (
	hackTargetSourceFile    = "hack_target.cpp"
	hackTargetBinary        = "hack_target"
	hackTargetOutput        = "hack_target.out"
	hackTargetError         = "hack_target.err"
	hackGeneratorSourceFile = "hack_generator.cpp"
	hackReferenceSourceFile = "hack_reference.cpp"
	hackGeneratorBinary     = "hack_generator"
	hackReferenceBinary     = "hack_reference"
	hackGeneratedInput      = "hack_generated.in"
	hackReferenceOutput     = "hack_reference.out"
	hackReferenceError      = "hack_reference.err"
	hackGeneratorError      = "hack_generator.err"
	maxHackGeneratedBytes   = 16 << 20
	hackToolBoxOffset       = 1000
)

// judgeHackInBox 分发两种 Hack 评测协议：优先使用 Codeforces 风格的
// HackTargetSource（选手提交输入、攻击目标程序），没有目标程序时兼容旧版
// 生成器 + 参考解协议。两种协议都在 isolate 沙箱内执行。
func (r *Runner) judgeHackInBox(ctx context.Context, sub model.Submission, problem model.Problem,
	lang langs.Language, judgeCases []judgeCase) (
	verdict, compileError string, results []model.CaseResult, scores []int, timeMs, memoryKb int) {
	if strings.TrimSpace(problem.HackTargetSource) != "" {
		return r.judgeTargetHackInBox(ctx, sub, problem, judgeCases)
	}
	boxDir := r.Sandbox.BoxDir(r.BoxID)
	if problem.HackGeneratorSource == "" || problem.HackReferenceSource == "" {
		return model.StatusSystemError, "Hack 题缺少测试生成器或参考解源码", nil, nil, 0, 0
	}
	toolRunner := *r
	toolRunner.BoxID = r.BoxID + hackToolBoxOffset
	if err := toolRunner.Sandbox.InitBox(ctx, toolRunner.BoxID); err != nil {
		return model.StatusSystemError, "Hack 工具沙箱初始化失败", nil, nil, 0, 0
	}
	defer func() { _ = toolRunner.Sandbox.Cleanup(context.Background(), toolRunner.BoxID) }()

	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(sub.Code), 0o644); err != nil {
		return model.StatusSystemError, "写入源码失败", nil, nil, 0, 0
	}
	if lang.Compile != nil {
		if stderr, ok := r.compile(ctx, lang, sub.Optimize); !ok {
			return model.StatusCompileError, stderr, nil, nil, 0, 0
		}
	}

	cpp, ok := langs.ByKey("cpp")
	if !ok || cpp.Compile == nil {
		return model.StatusSystemError, "评测机缺少 C++ 编译器", nil, nil, 0, 0
	}
	toolDir := toolRunner.Sandbox.BoxDir(toolRunner.BoxID)
	if err := os.WriteFile(filepath.Join(toolDir, hackGeneratorSourceFile), []byte(problem.HackGeneratorSource), 0o644); err != nil {
		return model.StatusSystemError, "写入 Hack 生成器失败", nil, nil, 0, 0
	}
	if stderr, ok := toolRunner.compileFile(ctx, cpp, hackGeneratorSourceFile, hackGeneratorBinary, true); !ok {
		return model.StatusSystemError, "Hack 生成器编译失败: " + stderr, nil, nil, 0, 0
	}
	if err := os.WriteFile(filepath.Join(toolDir, hackReferenceSourceFile), []byte(problem.HackReferenceSource), 0o644); err != nil {
		return model.StatusSystemError, "写入 Hack 参考解失败", nil, nil, 0, 0
	}
	if stderr, ok := toolRunner.compileFile(ctx, cpp, hackReferenceSourceFile, hackReferenceBinary, true); !ok {
		return model.StatusSystemError, "Hack 参考解编译失败: " + stderr, nil, nil, 0, 0
	}

	verdict = model.StatusAccepted
	for i, jc := range judgeCases {
		cr, score := r.runHackCase(ctx, &toolRunner, boxDir, jc, problem, lang)
		results = append(results, cr)
		scores = append(scores, score)
		if cr.TimeMs > timeMs {
			timeMs = cr.TimeMs
		}
		if cr.MemoryKb > memoryKb {
			memoryKb = cr.MemoryKb
		}
		var stop bool
		verdict, stop = applyCaseVerdict(verdict, cr.Status)
		if stop {
			results = appendNotRunResults(results, judgeCases[i+1:])
			scores = append(scores, make([]int, len(judgeCases)-i-1)...)
			break
		}
	}
	return verdict, "", results, scores, timeMs, memoryKb
}

// judgeTargetHackInBox 执行 Codeforces 风格的 Hack：选手提交的是一组输入数据，
// 评测机把它同时交给管理员参考解和待攻击程序。目标程序出现运行错误、超限或
// 输出与参考解不一致时 Hack 成功；目标程序通过校验时 Hack 为 WA。
func (r *Runner) judgeTargetHackInBox(ctx context.Context, sub model.Submission, problem model.Problem,
	judgeCases []judgeCase) (verdict, compileError string, results []model.CaseResult, scores []int, timeMs, memoryKb int) {
	boxDir := r.Sandbox.BoxDir(r.BoxID)
	if strings.TrimSpace(problem.HackReferenceSource) == "" {
		return model.StatusSystemError, "Hack 题缺少判题参考解源码", nil, nil, 0, 0
	}
	cpp, ok := langs.ByKey("cpp")
	if !ok || cpp.Compile == nil {
		return model.StatusSystemError, "评测机缺少 C++ 编译器", nil, nil, 0, 0
	}
	if err := os.WriteFile(filepath.Join(boxDir, hackTargetSourceFile), []byte(problem.HackTargetSource), 0o644); err != nil {
		return model.StatusSystemError, "写入待攻击程序失败", nil, nil, 0, 0
	}
	if stderr, ok := r.compileFile(ctx, cpp, hackTargetSourceFile, hackTargetBinary, true); !ok {
		return model.StatusSystemError, "待攻击程序编译失败: " + stderr, nil, nil, 0, 0
	}
	toolRunner := *r
	toolRunner.BoxID = r.BoxID + hackToolBoxOffset
	if err := toolRunner.Sandbox.InitBox(ctx, toolRunner.BoxID); err != nil {
		return model.StatusSystemError, "Hack 参考解沙箱初始化失败", nil, nil, 0, 0
	}
	defer func() { _ = toolRunner.Sandbox.Cleanup(context.Background(), toolRunner.BoxID) }()
	toolDir := toolRunner.Sandbox.BoxDir(toolRunner.BoxID)
	if err := os.WriteFile(filepath.Join(toolDir, hackReferenceSourceFile), []byte(problem.HackReferenceSource), 0o644); err != nil {
		return model.StatusSystemError, "写入 Hack 参考解失败", nil, nil, 0, 0
	}
	if stderr, ok := toolRunner.compileFile(ctx, cpp, hackReferenceSourceFile, hackReferenceBinary, true); !ok {
		return model.StatusSystemError, "Hack 参考解编译失败: " + stderr, nil, nil, 0, 0
	}
	input := []byte(sub.Code)
	referenceLimits := hackToolLimits(problem)
	referenceRun, err := toolRunner.runHackCommand(ctx, toolDir, input, []string{"./" + hackReferenceBinary},
		hackReferenceOutput, hackReferenceError, referenceLimits)
	if err != nil || referenceRun.Status == "SE" {
		return model.StatusSystemError, "Hack 参考解运行失败", nil, nil, 0, 0
	}
	if referenceVerdict, _ := verdictFromRunWithSource(referenceRun, referenceLimits); referenceVerdict != verdictOK {
		return model.StatusSystemError, "Hack 参考解运行超限或异常", nil, nil, 0, 0
	}
	expected, err := os.ReadFile(filepath.Join(toolDir, hackReferenceOutput))
	if err != nil {
		return model.StatusSystemError, "读取 Hack 参考答案失败", nil, nil, 0, 0
	}
	limits := hackContestantLimits(problem, cpp)
	run, err := r.runHackCommand(ctx, boxDir, input, []string{"./" + hackTargetBinary},
		hackTargetOutput, hackTargetError, limits)
	if err != nil || run.Status == "SE" {
		return model.StatusSystemError, "待攻击程序运行失败", nil, nil, 0, 0
	}
	timeMs, memoryKb = run.TimeMs, run.MemoryKb
	targetVerdict, source := verdictFromRunWithSource(run, limits)
	cr := model.CaseResult{CaseID: 1, TimeMs: run.TimeMs, WallTimeMs: run.WallTimeMs, MemoryKb: run.MemoryKb,
		HackStatus: targetVerdict, TimeoutSource: source}
	if targetVerdict != verdictOK {
		// Hack 成功的外部结果是 AC，原始目标程序状态保存在 hack_status 中。
		cr.Status = model.StatusAccepted
		verdict = model.StatusAccepted
	} else {
		actual, readErr := os.ReadFile(filepath.Join(boxDir, hackTargetOutput))
		if readErr != nil {
			return model.StatusSystemError, "读取待攻击程序输出失败", nil, nil, 0, 0
		}
		targetCheck := CompareOutput(problem.CheckerMode, string(expected), string(actual))
		cr.HackStatus = targetCheck
		if targetCheck != model.StatusAccepted {
			cr.Status = model.StatusAccepted
			verdict = model.StatusAccepted
		} else {
			cr.Status = model.StatusWrongAnswer
			verdict = model.StatusWrongAnswer
		}
	}
	results = []model.CaseResult{cr}
	score := 100
	if len(judgeCases) > 0 && judgeCases[0].Score > 0 {
		score = judgeCases[0].Score
	}
	scores = []int{score}
	return verdict, "", results, scores, timeMs, memoryKb
}

// runHackCase turns one administrator-provided seed into a generated test,
// then compares the contestant output with the trusted reference output.
func (r *Runner) runHackCase(ctx context.Context, tools *Runner, boxDir string, jc judgeCase,
	problem model.Problem, lang langs.Language) (model.CaseResult, int) {
	cr := model.CaseResult{CaseID: jc.Ordinal}
	seed, err := os.ReadFile(jc.InputPath)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}

	generatorLimits := hackToolLimits(problem)
	toolDir := tools.Sandbox.BoxDir(tools.BoxID)
	generatorRun, err := tools.runHackCommand(ctx, toolDir, seed, []string{"./" + hackGeneratorBinary},
		hackGeneratedInput, hackGeneratorError, generatorLimits)
	if err != nil || generatorRun.Status == "SE" {
		slog.Error("Hack 生成器运行失败", "case_id", jc.Ordinal, "err", err)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	if verdict, _ := verdictFromRunWithSource(generatorRun, generatorLimits); verdict != verdictOK {
		slog.Error("Hack 生成器资源超限", "case_id", jc.Ordinal, "status", verdict)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	generated, err := os.ReadFile(filepath.Join(toolDir, hackGeneratedInput))
	if err != nil || len(generated) == 0 || len(generated) > maxHackGeneratedBytes {
		cr.Status = model.StatusSystemError
		return cr, 0
	}

	referenceRun, err := tools.runHackCommand(ctx, toolDir, generated, []string{"./" + hackReferenceBinary},
		hackReferenceOutput, hackReferenceError, generatorLimits)
	if err != nil || referenceRun.Status == "SE" {
		slog.Error("Hack 参考解运行失败", "case_id", jc.Ordinal, "err", err)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	if verdict, _ := verdictFromRunWithSource(referenceRun, generatorLimits); verdict != verdictOK {
		slog.Error("Hack 参考解资源超限", "case_id", jc.Ordinal, "status", verdict)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	expected, err := os.ReadFile(filepath.Join(toolDir, hackReferenceOutput))
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}

	contestantRun, err := r.runHackCommand(ctx, boxDir, generated, lang.RunCommand,
		"stdout.txt", "stderr.txt", hackContestantLimits(problem, lang))
	if err != nil || contestantRun.Status == "SE" {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	cr.TimeMs, cr.WallTimeMs, cr.MemoryKb = contestantRun.TimeMs, contestantRun.WallTimeMs, contestantRun.MemoryKb
	if verdict, source := verdictFromRunWithSource(contestantRun, hackContestantLimits(problem, lang)); verdict != verdictOK {
		cr.Status, cr.TimeoutSource = verdict, source
		return cr, 0
	}
	actual, err := os.ReadFile(filepath.Join(boxDir, "stdout.txt"))
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	cr.Status = CompareOutput(model.CheckerModeToken, string(expected), string(actual))
	if cr.Status != model.StatusAccepted {
		return cr, 0
	}
	return cr, jc.Score
}

// runHackCommand executes a trusted helper or contestant command with a
// supplied stdin and explicit output files. The command is passed as argv and
// never through a shell.
func (r *Runner) runHackCommand(ctx context.Context, boxDir string, input []byte,
	args []string, outputFile, errorFile string, limits Limits) (RunResult, error) {
	if err := prepareRunFiles(boxDir, input); err != nil {
		return RunResult{Status: "SE"}, err
	}
	_ = os.Remove(filepath.Join(boxDir, outputFile))
	_ = os.Remove(filepath.Join(boxDir, errorFile))
	if len(args) == 0 {
		return RunResult{Status: "SE"}, fmt.Errorf("无效的 Hack 命令")
	}
	return r.Sandbox.Run(ctx, r.BoxID, limits, "stdin.txt", outputFile, errorFile, args...)
}

func hackToolLimits(problem model.Problem) Limits {
	return Limits{
		TimeMs:     max(problem.TimeLimitMs*2, 2000),
		WallTimeMs: max(problem.TimeLimitMs*4, 5000),
		MemoryKb:   max(problem.MemoryLimitKb, 256*1024),
		FileSizeKb: defaultOutputLimitKb,
		StackKb:    max(problem.MemoryLimitKb, 256*1024),
		Processes:  16,
	}
}

func hackContestantLimits(problem model.Problem, lang langs.Language) Limits {
	return Limits{
		TimeMs:     scaleInt(problem.TimeLimitMs, lang.TimeFactor),
		WallTimeMs: scaleInt(problem.TimeLimitMs, lang.TimeFactor) * 2,
		MemoryKb:   scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		FileSizeKb: defaultOutputLimitKb,
		StackKb:    scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		Processes:  max(1, lang.Processes),
	}
}
