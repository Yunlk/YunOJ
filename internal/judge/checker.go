package judge

import "strings"

// TokenCompare 按主流 OJ 的「忽略行末空格与文末换行」语义比较输出：
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

func tokenize(s string) []string {
	// strings.Fields 按任意空白（含 \r）切分并丢弃空串。
	// 去掉可能存在的 UTF-8 BOM，避免首行误判。
	return strings.Fields(strings.TrimPrefix(s, "\uFEFF"))
}
