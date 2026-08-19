package judge

import (
	"context"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/langs"
	"github.com/yunoj/yunoj/internal/model"
)

// SPJ 运行协议（special judge）：
//   - SPJ 源码在沙箱内编译为 ./spj
//   - 每个测试点运行一次：./spj <输入文件> <用户输出文件> <答案文件>
//   - 通过退出码给出结论：0 = AC，1 = WA，2 = PE（按 WA 处理），其他 = SE
//   - 可选：stdout 第一行输出 0~100 的分数（部分分）；不输出时 AC 得满分

// spjLimits SPJ 自身运行的资源限制（应远快于选手程序）。
func spjLimits() Limits {
	return Limits{
		TimeMs:     5000,
		WallTimeMs: 10000,
		MemoryKb:   512 * 1024,
		FileSizeKb: 64 * 1024,
		StackKb:    256 * 1024,
		Processes:  16,
	}
}

// judgeSPJInBox 执行 SPJ 型题目的评测流水线：
// 编译选手代码与 SPJ → 逐点运行选手程序 → 运行 SPJ 判定。
func (r *Runner) judgeSPJInBox(ctx context.Context, sub model.Submission, problem model.Problem,
	lang langs.Language, judgeCases []judgeCase) (
	verdict, compileError string, results []model.CaseResult, scores []int, timeMs, memoryKb int) {

	boxDir := r.Sandbox.BoxDir(r.BoxID)

	// 1. 写选手源码并编译
	if err := os.WriteFile(filepath.Join(boxDir, lang.SourceFile), []byte(sub.Code), 0o644); err != nil {
		return model.StatusSystemError, "写入源码失败", nil, nil, 0, 0
	}
	if lang.Compile != nil {
		if stderr, ok := r.compile(ctx, lang, sub.Optimize); !ok {
			return model.StatusCompileError, stderr, nil, nil, 0, 0
		}
	}

	// 2. 编译 SPJ（固定使用 C++ 工具链）
	if problem.SPJSource == "" {
		return model.StatusSystemError, "该题目缺少 SPJ 源码", nil, nil, 0, 0
	}
	spjLang, _ := langs.ByKey("cpp")
	if err := os.WriteFile(filepath.Join(boxDir, "spj.cpp"), []byte(problem.SPJSource), 0o644); err != nil {
		return model.StatusSystemError, "写入 SPJ 源码失败", nil, nil, 0, 0
	}
	if stderr, ok := r.compileFile(ctx, spjLang, "spj.cpp", "spj", true); !ok {
		return model.StatusSystemError, "SPJ 编译失败: " + stderr, nil, nil, 0, 0
	}

	// 3. 逐点运行
	verdict = model.StatusAccepted
	for _, jc := range judgeCases {
		tc := data.TestCase{
			Name:       strconv.Itoa(jc.Ordinal),
			InputPath:  jc.InputPath,
			OutputPath: jc.OutputPath,
		}
		cr, score := r.runSPJCase(ctx, boxDir, tc, jc.Ordinal, problem, lang, jc.Score)
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

// runSPJCase 运行一个测试点：先跑选手程序，再跑 SPJ 判定。
// 返回判定结果与该点得分。
func (r *Runner) runSPJCase(ctx context.Context, boxDir string, tc data.TestCase, caseID int,
	problem model.Problem, lang langs.Language, full int) (model.CaseResult, int) {

	cr := model.CaseResult{CaseID: caseID}

	// 1. 选手程序运行
	inData, err := os.ReadFile(tc.InputPath)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	if err := prepareRunFiles(boxDir, inData); err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	runLimits := Limits{
		TimeMs:     scaleInt(problem.TimeLimitMs, lang.TimeFactor),
		WallTimeMs: scaleInt(problem.TimeLimitMs, lang.TimeFactor) * 2,
		MemoryKb:   scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		FileSizeKb: defaultOutputLimitKb,
		StackKb:    scaleInt(problem.MemoryLimitKb, lang.MemoryFactor),
		Processes:  16,
	}
	res, err := r.Sandbox.Run(ctx, r.BoxID, runLimits,
		"stdin.txt", "stdout.txt", "stderr.txt", lang.RunCommand...)
	if err != nil || res.Status == "SE" {
		slog.Error("SPJ 用例选手程序运行失败", "case_id", caseID, "err", err)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	cr.TimeMs, cr.MemoryKb = res.TimeMs, res.MemoryKb
	if v := verdictFromRun(res, runLimits); v != verdictOK {
		cr.Status = v
		return cr, 0
	}

	// 2. 准备 SPJ 输入文件（输入/答案拷入沙箱）
	if err := os.WriteFile(filepath.Join(boxDir, "case.in"), inData, 0o644); err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	ansData, err := os.ReadFile(tc.OutputPath)
	if err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	if err := os.WriteFile(filepath.Join(boxDir, "case.ans"), ansData, 0o644); err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}

	// 3. 运行 SPJ：argv = [输入, 用户输出, 答案]
	// 注意：不可用 prepareRunFiles——它会删除选手输出 stdout.txt。
	// SPJ 使用独立的 stdin/out/err 文件名，避免与选手文件冲突。
	if err := os.WriteFile(filepath.Join(boxDir, "spj_in.txt"), []byte{}, 0o644); err != nil {
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	_ = os.Remove(filepath.Join(boxDir, "spj_out.txt"))
	_ = os.Remove(filepath.Join(boxDir, "spj_err.txt"))
	spjRes, err := r.Sandbox.Run(ctx, r.BoxID, spjLimits(),
		"spj_in.txt", "spj_out.txt", "spj_err.txt", "./spj", "case.in", "stdout.txt", "case.ans")
	if err != nil || spjRes.Status == "SE" {
		slog.Error("SPJ 运行失败", "case_id", caseID, "err", err)
		cr.Status = model.StatusSystemError
		return cr, 0
	}
	out, _ := os.ReadFile(filepath.Join(boxDir, "spj_out.txt"))
	status, score := parseSPJOutput(string(out), spjRes.ExitCode, full)
	cr.Status = status
	return cr, score
}

// parseSPJOutput 解析 SPJ 的退出码与可选分数输出。
// 协议：0=AC 1=WA 2=PE(按 WA) 其他=SE；stdout 首行可为 0~100 的分数。
func parseSPJOutput(stdout string, exitCode, full int) (string, int) {
	switch exitCode {
	case 0:
		score := full
		if line := strings.TrimSpace(stdout); line != "" {
			if f, err := strconv.ParseFloat(strings.Fields(line)[0], 64); err == nil && f >= 0 && f <= 100 {
				score = int(f * float64(full) / 100)
			}
		}
		return model.StatusAccepted, score
	case 1:
		return model.StatusWrongAnswer, 0
	case 2:
		// 格式错误按 WA 处理
		return model.StatusWrongAnswer, 0
	default:
		return model.StatusSystemError, 0
	}
}

// caseFullScores 返回各测试点满分：优先用题目配置；未配置时平均分配 100 分。
func caseFullScores(problem model.Problem, n int) []int {
	return contest.CaseFullScores(problem.TestcaseScores, n)
}
