package langs

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestBuiltinLanguagesStayFocused(t *testing.T) {
	if err := LoadExternal(""); err != nil {
		t.Fatal(err)
	}
	got := make([]string, 0, len(All()))
	for _, language := range All() {
		got = append(got, language.Key)
	}
	want := []string{"cpp", "c", "python"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("默认语言应只包含 C/C++/Python: got %v, want %v", got, want)
	}
}

func TestExpandCompileCommand(t *testing.T) {
	got, err := ExpandCompileCommand([]string{"cc", "-o", "{output}", "{source}"}, "main.c", "main")
	if err != nil {
		t.Fatal(err)
	}
	if got[2] != "main" || got[3] != "main.c" {
		t.Fatalf("占位符展开错误: %#v", got)
	}
}

func TestLoadExternalLanguage(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "languages.json")
	content := `{"languages":[{"key":"rust_custom","name":"Rust","version":"local","monaco":"rust","source_file":"main.rs","run_command":["./main"],"compile":{"command":["rustc","-o","{output}","{source}"],"time_ms":10000,"memory_kb":262144},"time_factor":1,"memory_factor":1}]}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = LoadExternal(filepath.Join(dir, "missing.json")) })
	if err := LoadExternal(path); err != nil {
		t.Fatal(err)
	}
	if language, ok := ByKey("rust_custom"); !ok || language.Monaco != "rust" {
		t.Fatalf("未加载自定义语言: %#v, %v", language, ok)
	}
}

func TestLoadExternalRejectsDuplicateBuiltin(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "languages.json")
	content := `{"languages":[{"key":"cpp","name":"other","version":"1","source_file":"x.cpp","run_command":["./main"],"time_factor":1,"memory_factor":1}]}`
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = LoadExternal(filepath.Join(dir, "missing.json")) })
	if err := LoadExternal(path); err == nil {
		t.Fatal("重复内置键名应被拒绝")
	}
}
