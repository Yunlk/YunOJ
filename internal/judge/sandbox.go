// Package judge 实现评测核心：isolate 沙箱封装、编译、运行与判定。
package judge

import (
	"bufio"
	"context"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// Limits 单次运行的资源限制。
type Limits struct {
	TimeMs     int // CPU 时间
	WallTimeMs int // 墙钟时间
	MemoryKb   int // 内存（cgroup 计量）
	FileSizeKb int // 单文件大小（用于限制输出）
	StackKb    int // 栈大小
	Processes  int // 进程数上限
}

// RunResult 一次运行的结果（解析自 isolate 的 meta 文件）。
type RunResult struct {
	Status     string // OK / RE / SG / TO / XX（isolate 语义）
	ExitCode   int
	Signal     int
	TimeMs     int // CPU 时间
	WallTimeMs int // 墙钟时间
	MemoryKb   int // 峰值内存
}

// Sandbox 沙箱抽象。定义接口是为了便于替换实现与单元测试；
// 生产实现为 IsolateSandbox。
type Sandbox interface {
	// InitBox 清理并初始化指定编号的沙箱
	InitBox(ctx context.Context, boxID int) error
	// Run 在沙箱内运行命令。stdin/stdout/stderr 为相对宿主 cwd（沙箱目录）的路径。
	Run(ctx context.Context, boxID int, limits Limits,
		stdinFile, stdoutFile, stderrFile string, args ...string) (RunResult, error)
	// RunAt 同 Run，但指定 isolate 的宿主工作目录（相对文件路径基于该目录解析）。
	// 交互题中两个沙箱需要访问同一个宿主 FIFO 目录时使用。
	RunAt(ctx context.Context, boxID int, limits Limits, hostDir,
		stdinFile, stdoutFile, stderrFile string, args ...string) (RunResult, error)
	// BoxDir 沙箱可写目录的宿主路径（评测机写源码/读输出用）
	BoxDir(boxID int) string
}

// IsolateSandbox 基于 IOI 官方 isolate 的沙箱实现。
// 评测进程必须以 root 运行（isolate 需要创建 namespace）。
type IsolateSandbox struct {
	isolatePath string
	baseDir     string
	// useCG 是否启用 cgroup 计量（--cg）。仅当宿主允许向子 cgroup 委派
	// memory/cpu 控制器时才可开启；关闭时 isolate 用 rlimit + max-rss 兜底。
	useCG bool
}

// NewIsolateSandbox 创建 isolate 沙箱。
// baseDir 为 isolate 的沙箱根目录（默认 /var/local/lib/isolate）。
func NewIsolateSandbox(isolatePath, baseDir string, useCG bool) *IsolateSandbox {
	return &IsolateSandbox{isolatePath: isolatePath, baseDir: baseDir, useCG: useCG}
}

// BoxDir 返回沙箱可写目录（isolate 的 box 子目录）。
func (s *IsolateSandbox) BoxDir(boxID int) string {
	return filepath.Join(s.baseDir, strconv.Itoa(boxID), "box")
}

// cgArgs 返回 cgroup 相关参数（未启用时为空）。
func (s *IsolateSandbox) cgArgs() []string {
	if s.useCG {
		return []string{"--cg"}
	}
	return nil
}

// InitBox 清理旧沙箱并初始化新沙箱。
func (s *IsolateSandbox) InitBox(ctx context.Context, boxID int) error {
	id := strconv.Itoa(boxID)
	// 清理上次残留（不存在时 isolate 会报错，忽略即可）
	cleanupArgs := append([]string{"--cleanup", "-b", id}, s.cgArgs()...)
	cleanup := exec.CommandContext(ctx, s.isolatePath, cleanupArgs...)
	_ = cleanup.Run()

	initArgs := append([]string{"--init", "-b", id}, s.cgArgs()...)
	init := exec.CommandContext(ctx, s.isolatePath, initArgs...)
	if out, err := init.CombinedOutput(); err != nil {
		return fmt.Errorf("isolate init: %w: %s", err, out)
	}
	// 沙箱进程以 isolate 用户运行，目录放开写权限以便双方共享文件
	if err := os.Chmod(s.BoxDir(boxID), 0o777); err != nil {
		return fmt.Errorf("chmod box dir: %w", err)
	}
	// 交互题 FIFO 目录：位于 box 的兄弟目录（baseDir/{id}/pipes）。
	// 注意：不能放在 box 目录内——isolate 对 box 目录有特殊处理，
	// 其子目录的内容不会出现在 dir 规则的 bind 挂载视图中。
	if err := os.MkdirAll(filepath.Join(s.baseDir, id, "pipes"), 0o755); err != nil {
		return fmt.Errorf("创建 pipes 目录: %w", err)
	}
	return nil
}

// sandboxDirs 以只读方式挂载进沙箱的宿主目录。
// isolate 默认的沙箱几乎为空（只有 /box、/dev 等），必须显式挂载
// 编译工具链（/usr 下的 gcc/g++/python3 及头文件）与动态链接器
// （/lib、/lib64、/etc 的 ld.so 缓存）才能编译与运行程序。
var sandboxDirs = []string{"/usr", "/bin", "/sbin", "/lib", "/lib64", "/etc"}

// Run 在沙箱内执行命令并解析 meta 结果。
func (s *IsolateSandbox) Run(ctx context.Context, boxID int, limits Limits,
	stdinFile, stdoutFile, stderrFile string, args ...string) (RunResult, error) {
	return s.RunAt(ctx, boxID, limits, s.BoxDir(boxID), stdinFile, stdoutFile, stderrFile, args...)
}

// RunAt 同 Run，但指定 isolate 的宿主工作目录（相对文件路径基于该目录解析）。
func (s *IsolateSandbox) RunAt(ctx context.Context, boxID int, limits Limits, hostDir,
	stdinFile, stdoutFile, stderrFile string, args ...string) (RunResult, error) {

	// 无 cgroup 时 isolate 用 RLIMIT_AS（虚拟内存）实现 --mem，虚存通常
	// 远高于实际占用，放宽一倍防止误杀；MLE 判定仍按原限制用 max-rss 计量。
	if !s.useCG {
		limits.MemoryKb *= 2
	}

	id := strconv.Itoa(boxID)
	// meta 文件名带沙箱编号：交互题中两个沙箱并发运行时互不覆盖
	metaName := "meta-" + id + ".txt"
	metaFile := filepath.Join(hostDir, metaName)
	_ = os.Remove(metaFile)

	// 注意：isolate 的部分长选项（如 --processes）是 getopt 的
	// optional_argument，必须用 --opt=value 形式，空格形式会把值
	// 误当作要执行的命令（报 execve 127）。这里统一使用 = 形式。
	cmdArgs := []string{
		"--run", "-b", id,
		"--time=" + fmt.Sprintf("%.3f", float64(limits.TimeMs)/1000),
		"--wall-time=" + fmt.Sprintf("%.3f", float64(limits.WallTimeMs)/1000),
		"--mem=" + strconv.Itoa(limits.MemoryKb),
		"--stack=" + strconv.Itoa(limits.StackKb),
		"--fsize=" + strconv.Itoa(limits.FileSizeKb),
		"--processes=" + strconv.Itoa(limits.Processes),
		"--stdin=" + stdinFile,
		"--stdout=" + stdoutFile,
		"--stderr=" + stderrFile,
		"--meta=" + metaName,
	}
	for _, d := range sandboxDirs {
		cmdArgs = append(cmdArgs, "--dir="+d)
	}
	// 交互题 FIFO 目录：沙箱内 /pipes → 宿主 baseDir/{boxID}/pipes（rw）。
	// isolate 的 --dir 语法为 沙箱内路径=宿主路径（右侧以 / 开头表示绝对路径）。
	// 交互器沙箱共享选手沙箱的 pipes 目录：hostDir 指向选手箱目录时，
	// 其父目录即选手沙箱编号目录。
	pipeDir := filepath.Join(filepath.Dir(hostDir), "pipes")
	cmdArgs = append(cmdArgs, "--dir=pipes="+pipeDir+":rw")
	cmdArgs = append(cmdArgs, s.cgArgs()...)
	cmdArgs = append(cmdArgs, "--")
	cmdArgs = append(cmdArgs, args...)

	cmd := exec.CommandContext(ctx, s.isolatePath, cmdArgs...)
	// isolate 的 --stdin/--stdout/--stderr/--meta 相对路径按宿主 cwd 解析
	cmd.Dir = hostDir
	out, err := cmd.CombinedOutput()
	// 注意：isolate 的退出码继承 box 内程序的退出码（编译失败、超时、
	// 被信号杀死等都会非零），这些属于正常评测路径。只有 meta 文件
	// 未生成（isolate 自身故障：沙箱缺失、参数错误等）才视为系统错误。
	if err != nil {
		if _, statErr := os.Stat(metaFile); statErr != nil {
			return RunResult{Status: "SE"}, fmt.Errorf("isolate run: %w: %s (args: %v)", err, out, cmdArgs)
		}
	}

	res, err := parseMeta(metaFile)
	if err != nil {
		return RunResult{Status: "SE"}, err
	}
	return res, nil
}

// parseMeta 解析 isolate 的 meta 文件（key:value 行）。
func parseMeta(path string) (RunResult, error) {
	f, err := os.Open(path)
	if err != nil {
		return RunResult{Status: "SE"}, fmt.Errorf("读取 meta 文件: %w", err)
	}
	defer f.Close()

	// isolate 只在程序异常时输出 status 行（TO/RE/SG/XX），正常完成为 OK
	res := RunResult{Status: "OK"}
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		key, value, ok := strings.Cut(sc.Text(), ":")
		if !ok {
			continue
		}
		switch key {
		case "status":
			res.Status = value
		case "exitcode":
			res.ExitCode, _ = strconv.Atoi(value)
		case "exitsig":
			res.Signal, _ = strconv.Atoi(value)
		case "time":
			if v, err := strconv.ParseFloat(value, 64); err == nil {
				res.TimeMs = int(math.Round(v * 1000))
			}
		case "time-wall":
			if v, err := strconv.ParseFloat(value, 64); err == nil {
				res.WallTimeMs = int(math.Round(v * 1000))
			}
		case "cg-mem":
			res.MemoryKb, _ = strconv.Atoi(value)
		case "max-rss":
			if res.MemoryKb == 0 {
				res.MemoryKb, _ = strconv.Atoi(value)
			}
		}
	}
	return res, sc.Err()
}
