package judge

import "testing"

func TestTokenCompare(t *testing.T) {
	cases := []struct {
		name     string
		expected string
		actual   string
		want     bool
	}{
		{"完全相同", "1 2 3\n", "1 2 3\n", true},
		{"行尾多余空格", "1 2 3\n", "1 2 3  \n", true},
		{"文末多余空行", "1 2\n", "1 2\n\n\n", true},
		{"CRLF 与 LF", "1 2\r\n", "1 2\n", true},
		{"BOM 前缀", "\uFEFF1 2\n", "1 2\n", true},
		{"数字不同", "1 2\n", "1 3\n", false},
		{"token 数量不同", "1 2\n", "1 2 3\n", false},
		{"空输出", "", "", true},
		{"空白等价", "  \n\t", "", true},
		{"大小写敏感", "Hello\n", "hello\n", false},
		{"长输出一致", "1\n2\n3\n4\n5\n", "1\n2\n3\n4\n5\n", true},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := TokenCompare(tc.expected, tc.actual); got != tc.want {
				t.Errorf("TokenCompare(%q, %q) = %v, want %v", tc.expected, tc.actual, got, tc.want)
			}
		})
	}
}

func TestCompareOutput(t *testing.T) {
	cases := []struct {
		name     string
		mode     string
		expected string
		actual   string
		want     string
	}{
		{"token 忽略空白", "token", "1 2\n", "1\n2  \n", "accepted"},
		{"token 内容不同", "token", "1 2\n", "1 3\n", "wrong_answer"},
		{"空模式兼容 token", "", "1 2\n", "1  2", "accepted"},
		{"exact 完全相同", "exact", "1 2\n", "1 2\n", "accepted"},
		{"exact 兼容平台换行", "exact", "1 2\r\n", "1 2\n", "accepted"},
		{"exact 行尾空格为 PE", "exact", "1 2\n", "1 2  \n", "presentation_error"},
		{"exact 文末换行为 PE", "exact", "1 2", "1 2\n", "presentation_error"},
		{"exact 空输出格式差异", "exact", "", "\n", "presentation_error"},
		{"exact 内容不同为 WA", "exact", "1 2\n", "1 3\n", "wrong_answer"},
		{"exact 大小写不同为 WA", "exact", "Hello\n", "hello\n", "wrong_answer"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := CompareOutput(tc.mode, tc.expected, tc.actual); got != tc.want {
				t.Errorf("CompareOutput(%q, %q, %q) = %q, want %q", tc.mode, tc.expected, tc.actual, got, tc.want)
			}
		})
	}
}
