package judge

import (
	"strings"

	"github.com/yunoj/yunoj/internal/model"
)

// TokenCompare 按主流 OJ 的「忽略空白布局」语义比较输出：
// 将两侧输出按空白字符切分为 token 序列后逐一比较。
// 这样 Windows 换行（\r\n）、行尾多余空格都不会造成误判。
func TokenCompare(expected, actual string) bool {
	e := tokenize(expected)
	a := tokenize(actual)
	if len(e) != len(a) {
		return false
	}
	for i := range e {
		if e[i] != a[i] {
			return false
		}
	}
	return true
}

// CompareOutput 按题目配置比较标准输出并返回最终状态。
// exact 模式保留空格和换行差异；若 token 相同但格式不同，返回 PE。
// 未知或空模式按 token 处理，以兼容迁移前创建的题目。
func CompareOutput(mode, expected, actual string) string {
	if mode == model.CheckerModeExact {
		if normalizeLineEndings(expected) == normalizeLineEndings(actual) {
			return model.StatusAccepted
		}
		if TokenCompare(expected, actual) {
			return model.StatusPresentationError
		}
		return model.StatusWrongAnswer
	}
	if TokenCompare(expected, actual) {
		return model.StatusAccepted
	}
	return model.StatusWrongAnswer
}

func normalizeLineEndings(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	return strings.ReplaceAll(s, "\r", "\n")
}

func tokenize(s string) []string {
	// strings.Fields 按任意空白（含 \r）切分并丢弃空串。
	// 去掉可能存在的 UTF-8 BOM，避免首行误判。
	return strings.Fields(strings.TrimPrefix(s, "\uFEFF"))
}
