package judge

import (
	"context"
	"fmt"
	"log/slog"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"time"

	"github.com/yunoj/yunoj/internal/contest"
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
	linuxSignalXFSZ        = 25 // Linux SIGXFSZ：输出文件超过 --fsize 限制
	submissionLease        = 2 * time.Hour
)

// Runner 评测单个提交。每个评测 worker 独占一个 Runner 与沙箱编号，
// 因此无需并发控制。
type Runner struct {
	Store    *store.Store
	Sandbox  Sandbox
	BoxID    int
	DataDir  string
	NodeID   string
	WorkerID string
	// Queue 可选：用于比赛排行榜更新事件推送
	Queue *queue.Queue
}

// Judge 评测一条提交并把最终结果写回数据库。
func (r *Runner) Judge(ctx context.Context, submissionID int64) error {
	logger := slog.With("submission_id", submissionID)

	attempt, claimed, err := r.Store.ClaimForJudge(ctx, submissionID, r.NodeID, r.WorkerID, submissionLease)
	if err != nil {
		return err
	}
	if !claimed {
		logger.Info("提交已被其他 worker 领取，跳过重复队列消息")
		return nil
	}

	sub, err := r.Store.GetSubmission(ctx, submissionID)
	if err != nil {
		return err
	}

	// 被 Hack 成功的提交判定已作废（CF 规则），任何来源的重判都不得让它复活：
	// 保留原有结果写回，仅把状态/分数固定为「未通过、零分」。
	if sub.IsHacked {
		logger.Info("跳过被 Hack 提交的重判")
		if sub.ContestID != nil {
			return r.Store.SetJudgedFullClaimedWithWall(ctx, submissionID, r.NodeID, r.WorkerID, attempt,
				model.StatusWrongAnswer, sub.CompileError, sub.CaseResults, sub.CaseScores,
				sub.TimeMs, sub.WallTimeMs, sub.MemoryKb, 0, sub.IsFrozen)
		}
		return r.Store.SetJudgedClaimedWithWall(ctx, submissionID, r.NodeID, r.WorkerID, attempt,
			model.StatusWrongAnswer, sub.CompileError, sub.CaseResults, sub.CaseScores,
			sub.TimeMs, sub.WallTimeMs, sub.MemoryKb, 0)
	}

	problem, err := r.Store.GetProblem(ctx, sub.ProblemID)
	if err != nil {
		return err
	}
	lang, ok := langs.ByKey(sub.Language)
	if !ok {
		return r.Store.SetJudgedClaimed(ctx, submissionID, r.NodeID, r.WorkerID, attempt,
			model.StatusSystemError,
			"不支持的语言: "+sub.Language, nil, 0, 0)
	}
	first, err := r.Store.IsFirstJudge(ctx, submissionID)
	if err != nil {
		return err
	}
	verdict := model.StatusSystemError
	compileError := ""
	var results []model.CaseResult
	var scores []int
	timeMs, memoryKb := 0, 0
	// contestInfo 比赛上下文（无比赛时为 nil），写回阶段还要用它判断计分模式。
	var contestInfo *model.Contest

	if err := r.Sandbox.InitBox(ctx, r.BoxID); err != nil {
		compileError = "沙箱初始化失败"
		logger.Error("sandbox init", "err", err)
	} else {
		// Codeforces 风格 Hack 使用选手提交的数据作为唯一测试输入，不要求题目上传测试点。
		var judgeCases []judgeCase
		var errMsg string
		if problem.Type == model.ProblemTypeHack && problem.HackTargetSource != "" {
			judgeCases = []judgeCase{{Ordinal: 1, Score: 100}}
		} else {
			// 测试点与分值：权威来源为 manifest；比赛单题分值覆盖在此等比例缩放
			judgeCases, errMsg = r.loadJudgeCases(ctx, problem)
		}
		if errMsg != "" {
			compileError = errMsg
		} else {
			// 比赛上下文：单题分值覆盖 + CF 赛制的分值衰减都在这里应用到测试点满分上
			if sub.ContestID != nil {
				if c, err := r.Store.GetContest(ctx, *sub.ContestID); err == nil {
					contestInfo = &c
				}
				if cp, err := r.Store.GetContestProblem(ctx, *sub.ContestID, sub.ProblemID); err == nil &&
					cp.Score != nil && *cp.Score > 0 {
					judgeCases = scaleJudgeCases(judgeCases, *cp.Score)
				}
			}
			// Codeforces 风格：分值随比赛进行线性衰减，按「提交时刻」确定本次得分，
			// 因此这里把测试点满分整体缩放到该时刻的分值（AC 即得到当时的分数）。
			if contestInfo != nil && contestInfo.Mode == model.ContestModeCF {
				initial := 0
				for _, jc := range judgeCases {
					initial += jc.Score
				}
				if initial > 0 {
					decayed := contest.CFDecayScore(initial, sub.CreatedAt,
						contestInfo.StartTime, contestInfo.EndTime)
					judgeCases = scaleJudgeCases(judgeCases, decayed)
				}
			}
			// 预测试模式（Codeforces 两阶段判定）：比赛进行中的提交只跑预测试点；
			// 赛后系统测试重判（system_test_pending）才跑完整数据。
			pretestRun := false
			systemTestRun := false
			if contestInfo != nil && contestInfo.PretestOnly {
				systemPending, _ := r.Store.IsSystemTestPending(ctx, submissionID)
				switch {
				case systemPending:
					systemTestRun = true
				case sub.CreatedAt.Before(contestInfo.EndTime):
					if filtered, ok := r.filterPretestCases(ctx, problem.ID, judgeCases); ok {
						judgeCases = filtered
						pretestRun = true
					}
				}
			}
			// 函数题：把选手代码与题目的语言模板拼装成一个完整程序。
			// 拼装失败（模板没配/代码为空）按编译错误处理，不进入沙箱。
			source := sub.Code
			if problem.Type == model.ProblemTypeFunction {
				stitched, ok, reason := r.functionSource(ctx, problem, lang.Key, sub.Code)
				if !ok {
					compileError = reason
					verdict = model.StatusCompileError
				} else {
					source = stitched
				}
			}
			// 调度器：按题目类型分发到对应评测流水线
			switch problem.Type {
			case model.ProblemTypeSPJ:
				verdict, compileError, results, scores, timeMs, memoryKb = r.judgeSPJInBox(ctx, sub, problem, lang, judgeCases)
			case model.ProblemTypeInteractive:
				verdict, compileError, results, scores, timeMs, memoryKb = r.judgeInteractiveInBox(ctx, sub, problem, lang, judgeCases)
			case model.ProblemTypeHack:
				verdict, compileError, results, scores, timeMs, memoryKb = r.judgeHackInBox(ctx, sub, problem, lang, judgeCases)
			case model.ProblemTypeStandard, model.ProblemTypeFunction, "":
				if compileError == "" {
					verdict, compileError, results, timeMs, memoryKb = r.judgeInBox(ctx, sub, problem, lang, source, judgeCases)
					scores = computeStandardScores(judgeCases, results)
				}
			default:
				compileError = "暂不支持的题目类型: " + problem.Type
			}
			// 记录本次判定阶段（预测试 / 系统测试），供榜单与详情展示。
			if contestInfo != nil && contestInfo.PretestOnly {
				if err := r.Store.SetSubmissionJudgePhase(ctx, submissionID, pretestRun, systemTestRun); err != nil {
					logger.Error("写入判定阶段失败", "err", err)
				}
			}
		}
	}
	wallTimeMs := maxCaseWallTime(results)

	if sub.ContestID != nil {
		// 计分模式：整题通过才计分（ACM/CF 及显式选择该模式的 OI 比赛）时，
		// 未通过的提交不得留下部分分——否则「Wrong Answer 243 分」这类自相矛盾的结果
		// 会出现在提交列表与比赛提交页里（榜单本身不受影响，但分数列会误导选手）。
		applyAllOrNothing(scores, verdict, contestScoreMode(contestInfo))
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
		if err := r.Store.SetJudgedFullClaimedWithWall(ctx, submissionID, r.NodeID, r.WorkerID, attempt,
			verdict, compileError, results, scores,
			timeMs, wallTimeMs, memoryKb, total, frozen); err != nil {
			return err
		}
		if r.Queue != nil {
			_ = r.Queue.PublishContestUpdate(ctx, *sub.ContestID)
		}
	} else {
		// 练习提交：逐点分数与总分同样落库（题目页/详情要展示得分与部分分）。
		total := 0
		for _, s := range scores {
			total += s
		}
		if err := r.Store.SetJudgedClaimedWithWall(ctx, submissionID, r.NodeID, r.WorkerID, attempt,
			verdict, compileError, results, scores, timeMs, wallTimeMs, memoryKb, total); err != nil {
			return err
		}
	}
	// 只有持有当前租约并成功写回的首次评测才能更新题目计数。
	if first && model.IsFinal(verdict) {
		if err := r.Store.AddSubmission(ctx, sub.ProblemID, verdict == model.StatusAccepted); err != nil {
			logger.Error("update problem counters", "err", err)
		}
	}
	logger.Info("judged", "verdict", verdict, "score", sumInts(scores), "time_ms", timeMs, "wall_time_ms", wallTimeMs, "memory_kb", memoryKb)
	return nil
}

// contestScoreMode 返回比赛的计分模式（无比赛时为空字符串）。
func contestScoreMode(c *model.Contest) string {
	if c == nil {
		return ""
	}
	return c.ScoreMode
}

// applyAllOrNothing 实现「整题通过才计分」：该模式下未通过的提交逐点得分清零。
// 其它模式（partial）保留逐点部分分，供 OI/IOI 赛制使用。
func applyAllOrNothing(scores []int, verdict, scoreMode string) {
	if scoreMode != model.ScoreModeAllOrNothing || verdict == model.StatusAccepted {
		return
	}
	for i := range scores {
		scores[i] = 0
	}
}

func maxCaseWallTime(results []model.CaseResult) int {
	maxWall := 0
	for _, result := range results {
		if result.WallTimeMs > maxWall {
			maxWall = result.WallTimeMs
		}
	}
	return maxWall
}

// filterPretestCases 从测试点集合中挑出预测试点（is_pretest 标记）。
// 管理员未标记任何预测试点时回退为「第一个测试点」，保证预测试模式可用。
// 返回 ok=false 表示无法构造预测试集合（此时按完整数据评测）。
func (r *Runner) filterPretestCases(ctx context.Context, problemID int64, cases []judgeCase) ([]judgeCase, bool) {
	if len(cases) == 0 {
		return cases, false
	}
	tcs, err := r.Store.ListTestcases(ctx, problemID)
	if err != nil {
		return cases, false
	}
	pretest := map[int]bool{}
	for _, t := range tcs {
		if t.IsPretest {
			pretest[t.Ordinal] = true
		}
	}
	if len(pretest) == 0 {
		return cases[:1], true // 回退：只用第一个测试点
	}
	out := make([]judgeCase, 0, len(pretest))
	for _, jc := range cases {
		if pretest[jc.Ordinal] {
			out = append(out, jc)
		}
	}
	if len(out) == 0 {
		return cases[:1], true
	}
	return out, true
}

// judgeCase 单个待评测测试点（含分值）。
type judgeCase struct {
	Ordinal    int
	InputPath  string
	OutputPath string
	Score      int
}

// loadJudgeCases 加载评测用测试点：权威来源为 problem_testcases manifest。
// manifest 为空时回退到文件列表 + 均分（旧数据未回填的兼容路径）。
func (r *Runner) loadJudgeCases(ctx context.Context, problem model.Problem) ([]judgeCase, string) {
	tcs, err := r.Store.ListTestcases(ctx, problem.ID)
	if err != nil {
		return nil, "读取测试点配置失败"
	}
	if len(tcs) == 0 {
		cases, err := data.ListTests(r.DataDir, problem.ID)
		if err != nil {
			return nil, "读取测试数据失败"
		}
		if len(cases) == 0 {
			return nil, "该题目没有测试数据，请联系管理员"
		}
		fulls := caseFullScores(problem, len(cases))
		out := make([]judgeCase, 0, len(cases))
		for i, c := range cases {
			ordinal, convErr := strconv.Atoi(c.Name)
			if convErr != nil {
				ordinal = i + 1
			}
			out = append(out, judgeCase{
				Ordinal: ordinal, InputPath: c.InputPath, OutputPath: c.OutputPath, Score: fulls[i],
			})
		}
		return out, ""
	}
	out := make([]judgeCase, 0, len(tcs))
	for _, t := range tcs {
		inPath := store.TestcaseFilePath(r.DataDir, problem.ID, t.Ordinal, "in")
		outPath := store.TestcaseFilePath(r.DataDir, problem.ID, t.Ordinal, "out")
		if _, err := os.Stat(inPath); err != nil {
			return nil, fmt.Sprintf("测试点 %d 数据文件缺失", t.Ordinal)
		}
		if _, err := os.Stat(outPath); err != nil {
			return nil, fmt.Sprintf("测试点 %d 数据文件缺失", t.Ordinal)
		}
		out = append(out, judgeCase{
			Ordinal: t.Ordinal, InputPath: inPath, OutputPath: outPath, Score: t.Score,
		})
	}
	return out, ""
}

// scaleJudgeCases 按比赛单题分值覆盖等比例缩放各测试点满分。
// 除不尽的余数补给最后一个测试点，保证总分精确等于 target。
func scaleJudgeCases(cases []judgeCase, target int) []judgeCase {
	// Keep intermediate arithmetic wide enough for large custom contest scores.
	var sum int64
	for _, c := range cases {
		sum += int64(c.Score)
	}
	if sum <= 0 || sum == int64(target) || len(cases) == 0 {
		return cases
	}
	out := make([]judgeCase, len(cases))
	copy(out, cases)
	acc := 0
	for i := 0; i < len(out)-1; i++ {
		scaled := int(int64(out[i].Score) * int64(target) / sum) // 向下取整
		out[i].Score = scaled
		acc += scaled
	}
	out[len(out)-1].Score = target - acc
	return out
}

// computeStandardScores 按逐点结果与测试点满分计算普通题目的各点得分。
func computeStandardScores(cases []judgeCase, results []model.CaseResult) []int {
	scores := make([]int, len(results))
	for i, res := range results {
		if i < len(cases) && res.Status == model.StatusAccepted {
			scores[i] = cases[i].Score
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

func appendNotRunResults(results []model.CaseResult, cases []judgeCase) []model.CaseResult {
	for _, jc := range cases {
		results = append(results, model.CaseResult{CaseID: jc.Ordinal, Status: model.StatusNotRun})
	}
	return results
}

// applyCaseVerdict 保留首个选手侧错误；SE 表示评测环境不可信，覆盖已有结果并停止。
func applyCaseVerdict(verdict, caseStatus string) (next string, stop bool) {
	if caseStatus == model.StatusSystemError {
		return model.StatusSystemError, true
	}
	if verdict == model.StatusAccepted && caseStatus != model.StatusAccepted {
		return caseStatus, false
	}
	return verdict, false
}

// judgeInBox 在沙箱内完成「写源码 → 编译 → 逐点运行比较」全流程。
func (r *Runner) judgeInBox(ctx context.Context, sub model.Submission, problem model.Problem,
	lang langs.Language, source string, judgeCases []judgeCase) (
	verdict, compileError string, results []model.CaseResult, timeMs, memoryKb int) {

	boxDir := r.Sandbox.BoxDir(r.BoxID)

	// 1. 写入源码（函数题的 source 已由调用方拼装完成）
	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(source), 0o644); err != nil {
		return model.StatusSystemError, "写入源码失败", nil, 0, 0
	}

	// 2. 编译（如需要）
	if lang.Compile != nil {
		if stderr, ok := r.compile(ctx, lang, sub.Optimize); !ok {
			return model.StatusCompileError, stderr, nil, 0, 0
		}
	}

	// 3. 逐点运行。选手侧错误不影响后续点；系统错误中止并标记剩余点未运行。
	verdict = model.StatusAccepted
	for i, jc := range judgeCases {
		tc := data.TestCase{
			Name:       strconv.Itoa(jc.Ordinal),
			InputPath:  jc.InputPath,
			OutputPath: jc.OutputPath,
		}
		cr := r.runCase(ctx, boxDir, tc, jc.Ordinal, problem, lang)
		results = append(results, cr)
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
			break
		}
	}
	return verdict, "", results, timeMs, memoryKb
}

// functionSource 取函数题该语言的驱动模板并拼装源码。
// 失败时返回用户可见的原因（按编译错误展示）。
func (r *Runner) functionSource(ctx context.Context, problem model.Problem, languageKey, code string) (string, bool, string) {
	harness, err := r.Store.GetProblemHarness(ctx, problem.ID, languageKey)
	if err != nil {
		// 该语言没配模板：明确告知而不是给出莫名其妙的编译错误。
		return "", false, "本题暂不支持该语言的函数题提交（题目未配置 " + languageKey + " 模板）"
	}
	if !harnessTemplateReady(harness) {
		return "", false, "题目模板缺少 " + model.HarnessPlaceholder + " 占位符，请联系管理员"
	}
	return harnessSource(harness, languageKey, code)
}

// compile 在沙箱内编译，失败时返回截断后的编译错误信息。
// optimize 控制是否使用开启优化（-O2）的编译命令。
func (r *Runner) compile(ctx context.Context, lang langs.Language, optimize bool) (string, bool) {
	return r.compileFile(ctx, lang, lang.SourceFile, "main", optimize)
}

// compileFile 在沙箱内编译任意源码文件（SPJ/交互器也走这里）。
// 编译命令使用 {source}/{output} 占位符，因此同时支持 GCC 的 -o
// 模式和 javac 这类不显式指定输出文件的编译器。
func (r *Runner) compileFile(ctx context.Context, lang langs.Language, sourceFileName, outputName string, optimize bool) (string, bool) {
	cc := lang.Compile
	command := cc.Command
	if !optimize && cc.CommandNoO2 != nil {
		command = cc.CommandNoO2
	}
	cmd, err := langs.ExpandCompileCommand(command, sourceFileName, outputName)
	if err != nil {
		return err.Error(), false
	}
	limits := Limits{
		TimeMs:     cc.TimeMs,
		WallTimeMs: cc.TimeMs + compileExtraWallTimeMs,
		MemoryKb:   cc.MemoryKb,
		FileSizeKb: 64 * 1024,
		StackKb:    256 * 1024,
		Processes:  max(64, lang.Processes),
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
		Processes:  max(1, lang.Processes),
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
	cr.TimeMs, cr.WallTimeMs, cr.MemoryKb = res.TimeMs, res.WallTimeMs, res.MemoryKb

	if v, source := verdictFromRunWithSource(res, limits); v != verdictOK {
		cr.Status, cr.TimeoutSource = v, source
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
	cr.Status = CompareOutput(problem.CheckerMode, string(expData), string(outData))
	return cr
}

// verdictFromRun 把 isolate 运行结果映射为判题状态。
// 返回 verdictOK 表示运行正常，可继续比较输出。
func verdictFromRun(res RunResult, limits Limits) string {
	// cgroup OOM 是区分 MLE 与普通 SIGSEGV/RE 的权威信号。
	if res.OOMKilled {
		return model.StatusMemoryLimitExceeded
	}
	// 无 cgroup 时 max-rss 是可用的最强信号。若时间和内存同时超限，
	// 先报告 MLE，避免死循环把已经发生的内存超限覆盖为 TLE。
	if res.MemoryKb > limits.MemoryKb {
		return model.StatusMemoryLimitExceeded
	}
	if res.Signal == linuxSignalXFSZ {
		return model.StatusOutputLimitExceeded
	}
	switch res.Status {
	case "TO":
		return model.StatusTimeLimitExceeded
	case "XX":
		return model.StatusOutputLimitExceeded
	case "SG":
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
	return verdictOK
}

// verdictFromRunWithSource 在 TLE 时补充 CPU/墙钟来源。
// isolate 仅返回统一的 TO 状态，因此按 CPU 是否接近软限制推断来源。
func verdictFromRunWithSource(res RunResult, limits Limits) (string, string) {
	verdict := verdictFromRun(res, limits)
	if verdict != model.StatusTimeLimitExceeded {
		return verdict, ""
	}
	if limits.TimeMs > 0 && res.TimeMs >= int(float64(limits.TimeMs)*0.95) {
		return verdict, "cpu"
	}
	return verdict, "wall"
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
