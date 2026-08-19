// Package langs 定义支持的语言及其编译/运行配置。
package langs

// CompileConfig 编译配置。
type CompileConfig struct {
	// Command 编译命令（默认开启优化，如 -O2）
	Command []string
	// CommandNoO2 关闭优化时的编译命令（O2 开关勾选与否）
	CommandNoO2 []string
	// TimeMs 编译时间上限
	TimeMs int
	// MemoryKb 编译内存上限
	MemoryKb int
}

// Language 一种可提交的语言。
type Language struct {
	Key     string `json:"key"`
	Name    string `json:"name"`
	Version string `json:"version"`
	// SourceFile 源码文件名（写入沙箱时使用）
	SourceFile string
	// RunCommand 沙箱内运行命令
	RunCommand []string
	// Compile 为 nil 表示解释型语言，无需编译
	Compile *CompileConfig
	// TimeFactor/MemoryFactor 相对题目限制的倍率（解释型语言放宽）
	TimeFactor   float64
	MemoryFactor float64
}

// all 支持的语言列表。新增语言时在此添加并同步更新评测机镜像
// 中安装的编译器/解释器。
var all = []Language{
	{
		Key:        "cpp",
		Name:       "C++",
		Version:    "GCC 12 (C++17, -O2)",
		SourceFile: "main.cpp",
		RunCommand: []string{"./main"},
		Compile: &CompileConfig{
			// 沙箱内无环境变量，用 env 显式提供 PATH，否则 collect2 找不到 ld
			Command:     []string{"/usr/bin/env", "PATH=/usr/bin:/bin", "/usr/bin/g++", "-O2", "-std=c++17", "-static", "-o", "main", "main.cpp"},
			CommandNoO2: []string{"/usr/bin/env", "PATH=/usr/bin:/bin", "/usr/bin/g++", "-std=c++17", "-static", "-o", "main", "main.cpp"},
			TimeMs:      20000,
			MemoryKb:    1048576,
		},
		TimeFactor:   1,
		MemoryFactor: 1,
	},
	{
		Key:        "c",
		Name:       "C",
		Version:    "GCC 12 (C11, -O2)",
		SourceFile: "main.c",
		RunCommand: []string{"./main"},
		Compile: &CompileConfig{
			Command:     []string{"/usr/bin/env", "PATH=/usr/bin:/bin", "/usr/bin/gcc", "-O2", "-std=c11", "-static", "-o", "main", "main.c"},
			CommandNoO2: []string{"/usr/bin/env", "PATH=/usr/bin:/bin", "/usr/bin/gcc", "-std=c11", "-static", "-o", "main", "main.c"},
			TimeMs:      20000,
			MemoryKb:    1048576,
		},
		TimeFactor:   1,
		MemoryFactor: 1,
	},
	{
		Key:          "python",
		Name:         "Python 3",
		Version:      "CPython 3.11",
		SourceFile:   "main.py",
		RunCommand:   []string{"/usr/bin/env", "PATH=/usr/bin:/bin", "/usr/bin/python3", "-B", "main.py"},
		Compile:      nil,
		TimeFactor:   3,
		MemoryFactor: 2,
	},
}

// All 返回支持的语言列表（副本）。
func All() []Language {
	return append([]Language(nil), all...)
}

// ByKey 按 key 查找语言。
func ByKey(key string) (Language, bool) {
	for _, l := range all {
		if l.Key == key {
			return l, true
		}
	}
	return Language{}, false
}
