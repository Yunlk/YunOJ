package judge

import (
	"context"
	"log/slog"
	"os"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
)

// 交互题运行协议：
//   - 选手程序与交互器各占一个独立沙箱（boxID 与 boxID+100），通过宿主上的
//     两个 FIFO 双向通信：f1: 交互器 stdout → 选手 stdin；f2: 选手 stdout → 交互器 stdin
//     （isolate 的沙箱视图不呈现 FIFO，因此 FIFO 放在宿主目录，由 isolate
//     在宿主侧以相对路径打开；judge 以 O_RDWR 预先持有两端，避免双方
//     同时打开读端造成 FIFO 死锁）
//   - 交互器 argv[1] 为测试输入文件（场景数据），从 stdin 读选手输出，
//     向 stdout 写发给选手的数据
//   - 判定由交互器退出码给出：0 = AC，1 = WA，2 = SE
//   - 选手程序每次输出后必须 flush stdout（否则交互器读不到，会超时）
//   - 超时（wall time）→ TLE；交互器崩溃/异常退出 → SE

// interactorBoxOffset 交互器沙箱相对 worker 沙箱的编号偏移。
const interactorBoxOffset = 100

// interactiveCommand 组装单箱模式下的启动命令（保留用于单元测试）。
func interactiveCommand(userCmd, interactorCmd []string) []string {
	u := strings.Join(append([]string{"exec"}, userCmd...), " ")
	i := strings.Join(interactorCmd, " ")
	return []string{"/bin/sh", "-c", u + " < f1 > f2 & " + i + " > f1 < f2"}
}

// judgeInteractiveInBox 执行交互题的评测流水线。
func (r *Runner) judgeInteractiveInBox(ctx context.Context, sub model.Submission, problem model.Problem, lang langs.Language) (
	verdict, compileError string, results []model.CaseResult, scores []int, timeMs, memoryKb int) {

	boxDir := r.Sandbox.BoxDir(r.BoxID)
	interBoxID := r.BoxID + interactorBoxOffset

	// 1. 写选手源码并编译
	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(sub.Code), 0o644); err != nil {
		return model.StatusSystemError, "写入源码失败", nil, nil, 0, 0
	}
	if lang.Compile != nil {
		if stderr, ok := r.compile(ctx, lang, sub.Optimize); !ok {
			return model.StatusCompileError, stderr, nil, nil, 0, 0
		}
	}

	// 2. 编译交互器（固定使用 C++ 工具链）
	if problem.InteractorSource == "" {
		return model.StatusSystemError, "该题目缺少交互器源码", nil, nil, 0, 0
	}
	spjLang, _ := langs.ByKey("cpp")
	if err := os.WriteFile(filepath.Join(boxDir, "interactor.cpp"), []byte(problem.InteractorSource), 0o644); err != nil {
		return model.StatusSystemError, "写入交互器源码失败", nil, nil, 0, 0
	}
	if stderr, ok := r.compileFile(ctx, spjLang, "interactor.cpp", "interactor", true); !ok {
		return model.StatusSystemError, "交互器编译失败: " + stderr, nil, nil, 0, 0
	}

	// 3. 初始化交互器沙箱，拷入静态链接的交互器二进制
	if err := r.Sandbox.InitBox(ctx, interBoxID); err != nil {
		return model.StatusSystemError, "交互器沙箱初始化失败", nil, nil, 0, 0
	}
	bin, err := os.ReadFile(filepath.Join(boxDir, "interactor"))
	if err != nil {
		return model.StatusSystemError, "读取交互器二进制失败", nil, nil, 0, 0
	}
	if err := os.WriteFile(filepath.Join(r.Sandbox.BoxDir(interBoxID), "interactor"), bin, 0o755); err != nil {
		return model.StatusSystemError, "写入交互器二进制失败", nil, nil, 0, 0
	}

	// 4. 读取测试数据
	cases, err := data.ListTests(r.DataDir, sub.ProblemID)
	if err != nil {
		return model.StatusSystemError, "读取测试数据失败", nil, nil, 0, 0
	}
	if len(cases) == 0 {
		return model.StatusSystemError, "该题目没有测试数据，请联系管理员", nil, nil, 0, 0
	}

	// 5. 逐点运行（每个测试点是一次完整的选手-交互器对话）
	verdict = model.StatusAccepted
	fulls := caseFullScores(problem, len(cases))
	for i, tc := range cases {
		cr, score := r.runInteractiveCase(ctx, boxDir, interBoxID, tc, i+1, problem, lang, fulls[i])
		results = append(results, cr)
		scores = append(scores, score)
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
	return verdict, "", results, scores, timeMs, memoryKb
}

// runInteractiveCase 运行一个交互测试点（双沙箱 + 宿主 FIFO）。
func (r *Runner) runInteractiveCase(ctx context.Context, boxDir string, interBoxID int,
	tc data.TestCase, caseID int, problem model.Problem, lang langs.Language, full int) (model.CaseResult, int) {

	cr := model.CaseResult{CaseID: caseID}
	interBoxDir := r.Sandbox.BoxDir(interBoxID)

	// 1. 场景输入拷入两个沙箱
	inData, err := os.ReadFile(tc.InputPath)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	if err := os.WriteFile(filepath.Join(boxDir, "case.in"), inData, 0o644); err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	if err := os.WriteFile(filepath.Join(interBoxDir, "case.in"), inData, 0o644); err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}

	// 2. 创建 FIFO 并由 judge 以 O_RDWR 持有两端（防止双方同时 open 读端死锁）
	// FIFO 位于选手沙箱的兄弟目录 baseDir/{id}/pipes（isolate 对 box
	// 目录内内容有特殊处理，FIFO 必须放 box 之外），经 --dir 挂载到沙箱 /pipes
	pipeDir := filepath.Join(filepath.Dir(boxDir), "pipes")
	f1 := filepath.Join(pipeDir, "f1")
	f2 := filepath.Join(pipeDir, "f2")
	_ = os.Remove(f1)
	_ = os.Remove(f2)
	if out, err := exec.CommandContext(ctx, "mkfifo", f1, f2).CombinedOutput(); err != nil {
		slog.Error("创建 FIFO 失败", "case_id", caseID, "err", err, "out", string(out))
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	// 沙箱内进程以 isolate 用户运行，FIFO 需对任意用户可读写
	_ = os.Chmod(f1, 0o666)
	_ = os.Chmod(f2, 0o666)
	h1, err := os.OpenFile(f1, os.O_RDWR, 0) // O_RDWR 打开 FIFO 不阻塞
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	defer h1.Close()
	h2, err := os.OpenFile(f2, os.O_RDWR, 0)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	defer h2.Close()

	// 3. 并发启动选手与交互器（stdin/stdout 使用沙箱内 /pipes 路径）
	limits := Limits{
		TimeMs:     scaleInt(problem.TimeLimitMs, lang.TimeFactor) * 2,
		WallTimeMs: scaleInt(problem.TimeLimitMs, lang.TimeFactor) * 2,
		MemoryKb:   scaleInt(problem.MemoryLimitKb, lang.MemoryFactor) * 2,
		FileSizeKb: defaultOutputLimitKb,
		StackKb:    scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		Processes:  16,
	}
	type outcome struct {
		res RunResult
		err error
	}
	userCtx, cancelUser := context.WithCancel(ctx)
	defer cancelUser()
	userCh := make(chan outcome, 1)
	go func() {
		res, err := r.Sandbox.Run(userCtx, r.BoxID, limits,
			"/pipes/f1", "/pipes/f2", "/box/user_err.txt", lang.RunCommand...)
		userCh <- outcome{res, err}
	}()
	interRes, interErr := r.Sandbox.RunAt(ctx, interBoxID, limits, boxDir,
		"/pipes/f2", "/pipes/f1", "/box/inter_err.txt", "./interactor", "case.in")
	cancelUser() // 交互器结束即终止选手
	userOutcome := <-userCh

	if interErr != nil || interRes.Status == "SE" {
		slog.Error("交互器运行失败", "case_id", caseID, "err", interErr)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	cr.TimeMs, cr.MemoryKb = userOutcome.res.TimeMs, userOutcome.res.MemoryKb

	// 4. 判定：交互器退出码为主；选手超时优先判 TLE
	if userOutcome.res.Status == "TO" {
		cr.Status = model.StatusTimeLimitExceeded
		return cr, 0
	}
	cr.Status = verdictInteractive(interRes)
	if cr.Status == model.StatusAccepted {
		return cr, full
	}
	return cr, 0
}

// verdictInteractive 把交互器运行结果映射为判题状态。
// 注意：isolate 会把 exit 1 标为 status:RE（RE 的典型退出码），
// 而 exit 1 在交互协议中是正常的 WA 信号，需优先按退出码映射。
func verdictInteractive(res RunResult) string {
	switch res.Status {
	case "TO":
		return model.StatusTimeLimitExceeded
	case "XX":
		return model.StatusOutputLimitExceeded
	}
	// 被信号杀死（SIGSEGV 等）→ 交互器崩溃
	if res.Signal > 0 {
		return model.StatusSystemError
	}
	switch res.ExitCode {
	case 0:
		return model.StatusAccepted
	case 1:
		return model.StatusWrongAnswer
	case 2:
		return model.StatusSystemError
	}
	// 非 0/1/2 退出 → 交互器异常
	return model.StatusSystemError
}
