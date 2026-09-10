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

// ---------- Open Hacking：选手间 Hack 评测 ----------
//
// 流程（与 Codeforces 一致）：hacker 锁定已通过的题目后，取他人提交作为目标，
// 提交一组输入数据发起 Hack。评测机用该输入运行目标提交：
//   - 目标程序超时/超内存/超输出/崩溃 → Hack 成功
//   - 目标程序正常结束但输出与期望答案不一致 → Hack 成功
//   - 目标程序输出与期望一致 → Hack 失败
// 期望答案来源：hacker 提供的期望输出；未提供时用题目的参考解（hack_reference_source）现算。

const (
	hackTargetSubSource = "hack_target_sub.cpp"
	hackTargetSubBinary = "hack_target_sub"
	hackExpectedOutput  = "hack_expected.out"
	hackActualOutput    = "hack_actual.out"
	hackRunError        = "hack_run.err"
)

// JudgeHack 评测一条 Hack 记录并写回结果；成功时让目标提交失去分数。
func (r *Runner) JudgeHack(ctx context.Context, hackID int64) error {
	logger := slog.With("hack_id", hackID)

	hack, err := r.Store.GetHack(ctx, hackID)
	if err != nil {
		return err
	}
	if hack.Verdict != model.HackPending {
		return nil // 已处理（重复消费）
	}
	target, err := r.Store.GetSubmission(ctx, hack.TargetSubmissionID)
	if err != nil {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "找不到目标提交")
		return err
	}
	problem, err := r.Store.GetProblem(ctx, hack.ProblemID)
	if err != nil {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "找不到题目")
		return err
	}
	lang, ok := langs.ByKey(target.Language)
	if !ok {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "目标提交使用了不支持的语言")
		return nil
	}
	if strings.TrimSpace(hack.Input) == "" {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "Hack 数据为空")
		return nil
	}

	if err := r.Sandbox.InitBox(ctx, r.BoxID); err != nil {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "沙箱初始化失败")
		return err
	}
	defer func() { _ = r.Sandbox.Cleanup(context.Background(), r.BoxID) }()

	boxDir := r.Sandbox.BoxDir(r.BoxID)

	// 1. 编译目标提交
	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(target.Code), 0o644); err != nil {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "写入目标源码失败")
		return err
	}
	if lang.Compile != nil {
		if _, ok := r.compile(ctx, lang, target.Optimize); !ok {
			// 目标程序本身编译失败：对 hacker 而言等同成功（该提交本来就不该得分）
			_ = r.Store.MarkSubmissionHacked(ctx, target.ID, model.StatusCompileError)
			_ = r.Store.SetHackResult(ctx, hackID, model.HackSuccess, model.StatusCompileError,
				"目标程序编译失败")
			r.publishContestUpdate(ctx, hack.ContestID)
			return nil
		}
	}

	// 2. 期望答案：优先用 hacker 提供的，否则用题目参考解现算
	expected := hack.ExpectedOutput
	if strings.TrimSpace(expected) == "" {
		computed, err := r.hackExpectedFromReference(ctx, problem, hack.Input)
		if err != nil {
			_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", err.Error())
			return nil
		}
		expected = computed
	}

	// 3. 用 Hack 数据运行目标程序
	limits := hackContestantLimits(problem, lang)
	run, err := r.runHackCommand(ctx, boxDir, []byte(hack.Input),
		append([]string(nil), lang.RunCommand...), hackActualOutput, hackRunError, limits)
	if err != nil {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "沙箱运行失败")
		return err
	}
	if run.Status == "SE" {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "沙箱运行异常")
		return nil
	}

	targetVerdict, source := verdictFromRunWithSource(run, limits)
	if targetVerdict != verdictOK {
		// 超时/超内存/超输出/运行时错误 → Hack 成功
		note := "目标程序：" + targetVerdict
		if source != "" {
			note += "（" + source + "）"
		}
		r.finishHack(ctx, logger, hack, target.ID, model.HackSuccess, targetVerdict, note)
		return nil
	}

	actual, err := os.ReadFile(filepath.Join(boxDir, hackActualOutput))
	if err != nil {
		_ = r.Store.SetHackResult(ctx, hackID, model.HackError, "", "读取目标输出失败")
		return nil
	}
	if got := CompareOutput(problem.CheckerMode, expected, string(actual)); got != model.StatusAccepted {
		r.finishHack(ctx, logger, hack, target.ID, model.HackSuccess, got,
			"目标输出与该输入的期望答案不一致")
		return nil
	}
	r.finishHack(ctx, logger, hack, target.ID, model.HackFail, model.StatusAccepted,
		"目标程序在该数据上输出正确，Hack 失败")
	return nil
}

// finishHack 写回 Hack 结果；成功时让目标提交失去分数。
func (r *Runner) finishHack(ctx context.Context, logger *slog.Logger, hack model.ContestHack,
	targetSubmissionID int64, verdict, targetStatus, note string) {

	if verdict == model.HackSuccess {
		if err := r.Store.MarkSubmissionHacked(ctx, targetSubmissionID, model.StatusWrongAnswer); err != nil {
			logger.Error("标记被 Hack 提交失败", "err", err)
		}
		_ = r.Store.SetHackResult(ctx, hack.ID, model.HackSuccess, targetStatus, note)
	} else {
		_ = r.Store.SetHackResult(ctx, hack.ID, verdict, targetStatus, note)
	}
	r.publishContestUpdate(ctx, hack.ContestID)
	logger.Info("hack judged", "verdict", verdict, "target_status", targetStatus,
		"target_submission", targetSubmissionID)
}

// hackExpectedFromReference 用题目参考解现算期望答案。
func (r *Runner) hackExpectedFromReference(ctx context.Context, problem model.Problem, input string) (string, error) {
	if strings.TrimSpace(problem.HackReferenceSource) == "" {
		return "", fmt.Errorf("该题目未配置参考解，Hack 需要同时提供期望输出")
	}
	cpp, ok := langs.ByKey("cpp")
	if !ok || cpp.Compile == nil {
		return "", fmt.Errorf("评测机缺少 C++ 编译器")
	}
	toolRunner := *r
	toolRunner.BoxID = r.BoxID + hackToolBoxOffset
	if err := toolRunner.Sandbox.InitBox(ctx, toolRunner.BoxID); err != nil {
		return "", fmt.Errorf("参考解沙箱初始化失败")
	}
	defer func() { _ = toolRunner.Sandbox.Cleanup(context.Background(), toolRunner.BoxID) }()

	toolDir := toolRunner.Sandbox.BoxDir(toolRunner.BoxID)
	if err := os.WriteFile(filepath.Join(toolDir, hackReferenceSourceFile), []byte(problem.HackReferenceSource), 0o644); err != nil {
		return "", fmt.Errorf("写入参考解失败")
	}
	if stderr, ok := toolRunner.compileFile(ctx, cpp, hackReferenceSourceFile, hackReferenceBinary, true); !ok {
		return "", fmt.Errorf("参考解编译失败：%s", stderr)
	}
	limits := hackToolLimits(problem)
	run, err := toolRunner.runHackCommand(ctx, toolDir, []byte(input),
		[]string{"./" + hackReferenceBinary}, hackReferenceOutput, hackReferenceError, limits)
	if err != nil || run.Status == "SE" {
		return "", fmt.Errorf("参考解运行失败")
	}
	if v, _ := verdictFromRunWithSource(run, limits); v != verdictOK {
		return "", fmt.Errorf("参考解在该数据上超限或异常")
	}
	out, err := os.ReadFile(filepath.Join(toolDir, hackReferenceOutput))
	if err != nil {
		return "", fmt.Errorf("读取参考答案失败")
	}
	return string(out), nil
}

// publishContestUpdate 通知榜单刷新（Hack 结果会影响排名与分数）。
func (r *Runner) publishContestUpdate(ctx context.Context, contestID int64) {
	if r.Queue == nil || contestID <= 0 {
		return
	}
	_ = r.Queue.PublishContestUpdate(ctx, contestID)
}
