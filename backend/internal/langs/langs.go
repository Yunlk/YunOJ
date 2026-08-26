// Package langs 定义内置语言，并支持从受信任的服务器配置文件扩展语言。
package langs

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
)

var languageKeyPattern = regexp.MustCompile(`^[a-z][a-z0-9_]{0,31}$`)

// CompileConfig 编译配置。Command 支持 {source} 与 {output} 占位符。
type CompileConfig struct {
	Command     []string `json:"command"`
	CommandNoO2 []string `json:"command_no_o2,omitempty"`
	TimeMs      int      `json:"time_ms"`
	MemoryKb    int      `json:"memory_kb"`
}

// Language 一种可提交的语言。命令配置只在 API/Judge 进程内使用。
type Language struct {
	Key              string         `json:"key"`
	Name             string         `json:"name"`
	Version          string         `json:"version"`
	Monaco           string         `json:"monaco"`
	SourceFile       string         `json:"source_file"`
	RunCommand       []string       `json:"run_command"`
	Compile          *CompileConfig `json:"compile,omitempty"`
	TimeFactor       float64        `json:"time_factor"`
	MemoryFactor     float64        `json:"memory_factor"`
	Processes        int            `json:"processes,omitempty"`
	SupportsOptimize bool           `json:"supports_optimize,omitempty"`
}

// PublicLanguage 是前端所需的安全子集，不暴露服务器命令和路径。
type PublicLanguage struct {
	Key              string `json:"key"`
	Name             string `json:"name"`
	Version          string `json:"version"`
	Monaco           string `json:"monaco"`
	SupportsOptimize bool   `json:"supports_optimize"`
}

type languageManifest struct {
	Languages []Language `json:"languages"`
}

var builtins = []Language{
	nativeLanguage("cpp", "C++", "GCC 12 (C++17)", "main.cpp", "/usr/bin/g++", "-std=c++17"),
	nativeLanguage("c", "C", "GCC 12 (C11)", "main.c", "/usr/bin/gcc", "-std=c11"),
	{
		Key: "python", Name: "Python 3", Version: "CPython 3.11", Monaco: "python",
		SourceFile: "main.py",
		RunCommand: []string{"/usr/bin/env", "PATH=/usr/bin:/bin", "/usr/bin/python3", "-B", "main.py"},
		TimeFactor: 3, MemoryFactor: 2, Processes: 16,
	},
}

var (
	registryMu sync.RWMutex
	registry   = cloneLanguages(builtins)
)

func nativeLanguage(key, name, version, sourceFile, compiler, standard string) Language {
	base := []string{"/usr/bin/env", "PATH=/usr/bin:/bin", compiler}
	monaco := "c"
	if strings.HasPrefix(name, "C++") {
		monaco = "cpp"
	}
	return Language{
		Key: key, Name: name, Version: version, Monaco: monaco,
		SourceFile: sourceFile, RunCommand: []string{"./main"},
		Compile: &CompileConfig{
			Command:     append(append([]string{}, base...), "-O2", standard, "-static", "-o", "{output}", "{source}"),
			CommandNoO2: append(append([]string{}, base...), standard, "-static", "-o", "{output}", "{source}"),
			TimeMs:      20000, MemoryKb: 1048576,
		},
		TimeFactor: 1, MemoryFactor: 1, Processes: 16, SupportsOptimize: true,
	}
}

// LoadExternal 重置为内置语言并合并配置文件中的自定义语言。
// 文件不存在表示只使用内置语言。
func LoadExternal(path string) error {
	next := cloneLanguages(builtins)
	if path == "" {
		setRegistry(next)
		return nil
	}
	b, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		setRegistry(next)
		return nil
	}
	if err != nil {
		return fmt.Errorf("读取语言配置: %w", err)
	}
	var manifest languageManifest
	if err := json.Unmarshal(b, &manifest); err != nil {
		return fmt.Errorf("解析语言配置: %w", err)
	}
	seen := make(map[string]bool, len(next)+len(manifest.Languages))
	for _, language := range next {
		seen[language.Key] = true
	}
	for i := range manifest.Languages {
		language := normalize(manifest.Languages[i])
		if seen[language.Key] {
			return fmt.Errorf("语言配置第 %d 项键名重复: %s", i+1, language.Key)
		}
		if err := validate(language); err != nil {
			return fmt.Errorf("语言配置第 %d 项: %w", i+1, err)
		}
		seen[language.Key] = true
		next = append(next, language)
	}
	setRegistry(next)
	return nil
}

func normalize(language Language) Language {
	if language.Monaco == "" {
		language.Monaco = "plaintext"
	}
	if language.TimeFactor <= 0 {
		language.TimeFactor = 1
	}
	if language.MemoryFactor <= 0 {
		language.MemoryFactor = 1
	}
	if language.Processes <= 0 {
		language.Processes = 16
	}
	return language
}

func validate(language Language) error {
	if !languageKeyPattern.MatchString(language.Key) {
		return fmt.Errorf("无效键名 %q", language.Key)
	}
	if strings.TrimSpace(language.Name) == "" || strings.TrimSpace(language.Version) == "" {
		return errors.New("名称和版本不能为空")
	}
	if language.SourceFile == "" || filepath.Base(language.SourceFile) != language.SourceFile {
		return errors.New("source_file 必须是不含路径的文件名")
	}
	if len(language.RunCommand) == 0 || strings.TrimSpace(language.RunCommand[0]) == "" {
		return errors.New("run_command 不能为空")
	}
	if language.Compile != nil {
		if language.Compile.TimeMs <= 0 || language.Compile.MemoryKb <= 0 {
			return errors.New("编译时间和内存限制必须大于 0")
		}
		if _, err := ExpandCompileCommand(language.Compile.Command, language.SourceFile, "main"); err != nil {
			return err
		}
		if len(language.Compile.CommandNoO2) > 0 {
			if _, err := ExpandCompileCommand(language.Compile.CommandNoO2, language.SourceFile, "main"); err != nil {
				return err
			}
		}
	}
	return nil
}

// ExpandCompileCommand 展开编译命令占位符，不经过 shell。
func ExpandCompileCommand(command []string, sourceFile, outputFile string) ([]string, error) {
	if len(command) == 0 {
		return nil, errors.New("编译命令不能为空")
	}
	out := make([]string, len(command))
	sourceSeen := false
	for i, arg := range command {
		if strings.Contains(arg, "{source}") {
			sourceSeen = true
		}
		arg = strings.ReplaceAll(arg, "{source}", sourceFile)
		arg = strings.ReplaceAll(arg, "{output}", outputFile)
		out[i] = arg
	}
	if !sourceSeen {
		return nil, errors.New("编译命令必须包含 {source} 占位符")
	}
	return out, nil
}

// All 返回完整的内部语言配置副本。
func All() []Language {
	registryMu.RLock()
	defer registryMu.RUnlock()
	return cloneLanguages(registry)
}

// PublicAll 返回可安全暴露给前端的语言信息。
func PublicAll() []PublicLanguage {
	all := All()
	out := make([]PublicLanguage, 0, len(all))
	for _, language := range all {
		out = append(out, PublicLanguage{
			Key: language.Key, Name: language.Name, Version: language.Version,
			Monaco: language.Monaco, SupportsOptimize: language.SupportsOptimize,
		})
	}
	return out
}

// ByKey 按 key 查找语言。
func ByKey(key string) (Language, bool) {
	registryMu.RLock()
	defer registryMu.RUnlock()
	for _, language := range registry {
		if language.Key == key {
			return cloneLanguage(language), true
		}
	}
	return Language{}, false
}

func setRegistry(languages []Language) {
	registryMu.Lock()
	registry = cloneLanguages(languages)
	registryMu.Unlock()
}

func cloneLanguages(in []Language) []Language {
	out := make([]Language, len(in))
	for i := range in {
		out[i] = cloneLanguage(in[i])
	}
	return out
}

func cloneLanguage(language Language) Language {
	language.RunCommand = append([]string(nil), language.RunCommand...)
	if language.Compile != nil {
		compile := *language.Compile
		compile.Command = append([]string(nil), compile.Command...)
		compile.CommandNoO2 = append([]string(nil), compile.CommandNoO2...)
		language.Compile = &compile
	}
	return language
}
