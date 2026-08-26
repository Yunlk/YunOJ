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
