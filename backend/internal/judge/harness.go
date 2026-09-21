package judge

import (
	"regexp"
	"strings"

	"github.com/yunoj/yunoj/internal/model"
)

// 函数题（type=function）的源码准备。
//
// 选手在编辑器里看到的是题目给的初始代码（函数签名 + 注释），通常只补函数体。
// 但很多人会习惯性地写一个完整程序（#include + main），如果直接套模板
// 就会出现「重复定义 main」的编译错误。因此这里分两种情况：
//
//  1. 只写函数体（没有 main）→ 套上题目的驱动模板，由模板负责 IO 与调用；
//  2. 写了完整程序（含 main / if __name__）→ 直接按完整程序评测。
//
// 两条路最终都产出「一个完整源文件」，后续编译、逐点运行、比对、
// 分值缩放、预测试、比赛计分等流程与标准题完全一致。

// mainDefinitionPatterns 判断选手代码是否自带程序入口。
// 按语言族给不同规则；未列出的语言一律视为「需要套模板」。
var mainDefinitionPatterns = map[string]*regexp.Regexp{
	// int main() {、int main(int argc, char** argv) {、void main(){ ...
	"c":   regexp.MustCompile(`(?s)\bmain\s*\([^;{)]*\)\s*\{`),
	"cpp": regexp.MustCompile(`(?s)\bmain\s*\([^;{)]*\)\s*\{`),
	// Python：显式入口或顶层直接读输入的习惯写法。
	"python": regexp.MustCompile(`(?m)^\s*(?:if\s+__name__\s*==|def\s+main\s*\()`),
}

// harnessSource 计算函数题实际提交给编译器的源码。
//
// 返回值：
//   - source 拼装后的完整源码；
//   - ok=false 时 reason 说明为什么不能评测（配置问题或选手代码问题）。
//
// 注意：这里的失败都是「编译错误」级别的用户可见原因，
// 只有模板缺少占位符属于管理员配置错误。
func harnessSource(harness model.ProblemHarness, languageKey, code string) (string, bool, string) {
	if strings.TrimSpace(code) == "" {
		return "", false, "代码为空"
	}
	// 自带入口的程序直接放行，不做任何改写。
	if hasProgramEntry(languageKey, code) {
		return code, true, ""
	}
	if !strings.Contains(harness.Template, model.HarnessPlaceholder) {
		return "", false, "题目模板缺少 " + model.HarnessPlaceholder + " 占位符，请联系管理员"
	}
	return strings.Replace(harness.Template, model.HarnessPlaceholder, code, 1), true, ""
}

// hasProgramEntry 判断选手代码是否自带程序入口。
func hasProgramEntry(languageKey, code string) bool {
	pattern, ok := mainDefinitionPatterns[languageKey]
	if !ok {
		return false
	}
	return pattern.MatchString(code)
}

// harnessTemplateReady 判断某语言模板是否可用于判题。
func harnessTemplateReady(harness model.ProblemHarness) bool {
	return strings.TrimSpace(harness.Template) != "" &&
		strings.Contains(harness.Template, model.HarnessPlaceholder)
}
