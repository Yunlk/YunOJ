package judge

import (
	"strings"
	"testing"

	"github.com/yunoj/yunoj/internal/model"
)

func TestHarnessSourceStitchesFunctionBody(t *testing.T) {
	harness := model.ProblemHarness{
		Language: "cpp",
		Template: "#include <bits/stdc++.h>\nint add(int a, int b);\n{{code}}\nint main(){int a,b;std::cin>>a>>b;std::cout<<add(a,b);}",
	}
	code := "int add(int a, int b) { return a + b; }"
	got, ok, reason := harnessSource(harness, "cpp", code)
	if !ok {
		t.Fatalf("拼装失败: %s", reason)
	}
	if !strings.Contains(got, code) {
		t.Errorf("拼装结果缺少选手代码: %s", got)
	}
	if !strings.Contains(got, "int main()") {
		t.Errorf("拼装结果缺少模板的 main: %s", got)
	}
	if strings.Contains(got, model.HarnessPlaceholder) {
		t.Errorf("占位符没有被替换: %s", got)
	}
}

// 选手直接写完整程序时必须原样提交，否则会出现「重复定义 main」。
func TestHarnessSourceKeepsFullProgram(t *testing.T) {
	harness := model.ProblemHarness{
		Language: "cpp",
		Template: "#include <bits/stdc++.h>\n{{code}}\nint main(){/*模板 main*/}",
	}
	code := "#include <iostream>\nint main(){int a,b;std::cin>>a>>b;std::cout<<a+b;}"
	got, ok, reason := harnessSource(harness, "cpp", code)
	if !ok {
		t.Fatalf("拼装失败: %s", reason)
	}
	if got != code {
		t.Errorf("完整程序不应被改写，得到: %s", got)
	}
	if strings.Count(got, "main") != 1 {
		t.Errorf("不应出现两个 main: %s", got)
	}
}

func TestHarnessSourcePythonEntry(t *testing.T) {
	harness := model.ProblemHarness{
		Language: "python",
		Template: "import sys\n{{code}}\ndef main():\n    a, b = map(int, sys.stdin.read().split())\n    print(add(a, b))\nmain()",
	}
	// 只写函数体 → 套模板
	if got, ok, reason := harnessSource(harness, "python", "def add(a, b):\n    return a + b"); !ok {
		t.Fatalf("只写函数体应被套模板: %s", reason)
	} else if !strings.Contains(got, "def main():") {
		t.Errorf("拼装结果缺少模板 main: %s", got)
	}
	// 自带 __main__ → 原样
	full := "import sys\ndef main():\n    print(1)\nif __name__ == '__main__':\n    main()"
	if got, ok, _ := harnessSource(harness, "python", full); !ok || got != full {
		t.Errorf("自带入口的 Python 代码应原样提交，得到: %s", got)
	}
}

func TestHarnessSourceRejectsEmptyCode(t *testing.T) {
	harness := model.ProblemHarness{Language: "cpp", Template: "{{code}}"}
	if _, ok, reason := harnessSource(harness, "cpp", "   \n\t "); ok || reason == "" {
		t.Errorf("空代码应被拒绝并给出原因")
	}
}

func TestHarnessSourceRejectsMissingPlaceholder(t *testing.T) {
	harness := model.ProblemHarness{Language: "cpp", Template: "int main(){}"}
	if _, ok, reason := harnessSource(harness, "cpp", "int add(int a,int b){return a+b;}"); ok {
		t.Errorf("缺少占位符应被拒绝")
	} else if !strings.Contains(reason, model.HarnessPlaceholder) {
		t.Errorf("原因里应提到占位符，得到: %s", reason)
	}
}

func TestHarnessTemplateReady(t *testing.T) {
	cases := []struct {
		name     string
		template string
		want     bool
	}{
		{"正常模板", "int main(){\n{{code}}\n}", true},
		{"空模板", "   ", false},
		{"缺少占位符", "int main(){}", false},
	}
	for _, tc := range cases {
		got := harnessTemplateReady(model.ProblemHarness{Language: "cpp", Template: tc.template})
		if got != tc.want {
			t.Errorf("%s: 期望 %v，得到 %v", tc.name, tc.want, got)
		}
	}
}
