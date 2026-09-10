package api

import (
	"archive/zip"
	"bytes"
	"testing"
)

func buildProblemPackageZip(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	for name, content := range files {
		w, err := z.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := w.Write([]byte(content)); err != nil {
			t.Fatal(err)
		}
	}
	if err := z.Close(); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestParseProblemPackage(t *testing.T) {
	raw := buildProblemPackageZip(t, map[string]string{
		"problem.json": `{"version":1,"problem":{"title":"迁移题","type":"standard"},"testcases":[{"ordinal":1,"score":100}]}`,
		"tests/1.in":   "1 2\n",
		"tests/1.out":  "3\n",
	})
	manifest, cases, err := parseProblemPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	if manifest.Version != 1 || manifest.Problem.Title != "迁移题" {
		t.Fatalf("manifest 解析错误: %+v", manifest)
	}
	if len(cases) != 1 || string(cases[1].Input) != "1 2\n" || string(cases[1].Output) != "3\n" {
		t.Fatalf("测试点解析错误: %+v", cases)
	}
	if !cases[1].InputSet || !cases[1].OutputSet {
		t.Fatal("测试点文件存在标记未设置")
	}
}

func TestParseProblemPackageKeepsEmptyFiles(t *testing.T) {
	raw := buildProblemPackageZip(t, map[string]string{
		"problem.json": `{"version":1,"problem":{"title":"空样例","type":"standard"},"testcases":[{"ordinal":1,"score":100}]}`,
		"tests/1.in":   "",
		"tests/1.out":  "",
	})
	_, cases, err := parseProblemPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	if !cases[1].InputSet || !cases[1].OutputSet || len(cases[1].Input) != 0 || len(cases[1].Output) != 0 {
		t.Fatalf("空文件未被正确保留: %+v", cases[1])
	}
}

func TestParseProblemPackageAllowsImplicitEqualScores(t *testing.T) {
	raw := buildProblemPackageZip(t, map[string]string{
		"problem.json": `{"version":1,"problem":{"title":"均分题","type":"standard"}}`,
		"tests/1.in":   "1",
		"tests/1.out":  "1",
	})
	manifest, cases, err := parseProblemPackage(raw)
	if err != nil {
		t.Fatal(err)
	}
	if len(manifest.Testcases) != 0 || len(cases) != 1 {
		t.Fatalf("未保留隐式均分语义: manifest=%+v cases=%d", manifest, len(cases))
	}
}

func TestParseProblemPackageRejectsUnsafeOrUnknownFiles(t *testing.T) {
	tests := []struct {
		name  string
		files map[string]string
	}{
		{
			name: "路径穿越",
			files: map[string]string{
				"problem.json": `{"version":1,"problem":{"title":"x","type":"output_only"}}`,
				"../escape":    "bad",
			},
		},
		{
			name: "未知文件",
			files: map[string]string{
				"problem.json": `{"version":1,"problem":{"title":"x","type":"output_only"}}`,
				"README.md":    "bad",
			},
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, _, err := parseProblemPackage(buildProblemPackageZip(t, tt.files)); err == nil {
				t.Fatal("应拒绝不安全或未知文件")
			}
		})
	}
}
