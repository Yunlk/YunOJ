package api

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path"
	"sort"
	"strconv"
	"strings"

	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// problemPackageManifest 是跨实例迁移题目的稳定格式。测试数据正文单独放在
// tests/ 目录，避免把大文件编码进 JSON；导入后统一创建为草稿。
type problemPackageManifest struct {
	Version   int                          `json:"version"`
	Problem   problemPayload               `json:"problem"`
	Testcases []problemPackageTestcaseMeta `json:"testcases,omitempty"`
}

type problemPackageTestcaseMeta struct {
	Ordinal int `json:"ordinal"`
	Score   int `json:"score"`
}

type problemPackageCase struct {
	Input     []byte
	Output    []byte
	InputSet  bool
	OutputSet bool
}

const (
	maxProblemPackageEntries = 2048
	maxProblemPackageFile    = 64 << 20
	maxProblemPackageTotal   = 512 << 20
	maxProblemPackageUpload  = 512 << 20
)

func problemPackagePayload(p model.Problem) problemPayload {
	return problemPayload{
		Title: p.Title, Statement: p.Statement, InputFormat: p.InputFormat,
		OutputFormat: p.OutputFormat, Hint: p.Hint, Samples: p.Samples,
		TimeLimitMs: p.TimeLimitMs, MemoryLimitKb: p.MemoryLimitKb,
		Difficulty: p.Difficulty, Tags: p.Tags, Type: p.Type,
		CheckerMode: p.CheckerMode, SPJSource: p.SPJSource,
		InteractorSource: p.InteractorSource, HackGeneratorSource: p.HackGeneratorSource,
		HackReferenceSource: p.HackReferenceSource, HackTargetSource: p.HackTargetSource, TestcaseScores: p.TestcaseScores,
		SubmissionLimit: p.SubmissionLimit, Status: p.Status,
		Provider: p.Provider, ShowScore: &p.ShowScore,
	}
}

// problemPackagePayloadWithHarnesses 打包时带上函数题的语言模板。
func problemPackagePayloadWithHarnesses(p model.Problem, harnesses []model.ProblemHarness) problemPayload {
	payload := problemPackagePayload(p)
	if len(harnesses) == 0 {
		return payload
	}
	payload.Harnesses = make(map[string]harnessPayload, len(harnesses))
	for _, h := range harnesses {
		payload.Harnesses[h.Language] = harnessPayload{Template: h.Template, InitialCode: h.InitialCode}
	}
	return payload
}

func readProblemPackageEntry(f *zip.File) ([]byte, error) {
	if f.UncompressedSize64 > maxProblemPackageFile {
		return nil, fmt.Errorf("文件过大（单文件最大 64MB）: %s", f.Name)
	}
	rc, err := f.Open()
	if err != nil {
		return nil, err
	}
	defer rc.Close()
	b, err := io.ReadAll(io.LimitReader(rc, maxProblemPackageFile+1))
	if err != nil {
		return nil, err
	}
	if len(b) > maxProblemPackageFile {
		return nil, fmt.Errorf("文件实际大小超过 64MB: %s", f.Name)
	}
	return b, nil
}

func readProblemPackageUpload(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxProblemPackageUpload+(1<<20))
	if err := r.ParseMultipartForm(maxUploadMemory); err != nil {
		writeError(w, http.StatusBadRequest, "上传失败：文件过大或格式错误")
		return nil, false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少题目迁移包（multipart 字段名 file）")
		return nil, false
	}
	defer file.Close()
	b, err := io.ReadAll(io.LimitReader(file, maxProblemPackageUpload+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取迁移包失败")
		return nil, false
	}
	if len(b) > maxProblemPackageUpload {
		writeError(w, http.StatusRequestEntityTooLarge, "迁移包过大（最大 512MB）")
		return nil, false
	}
	return b, true
}

func parseProblemPackage(raw []byte) (problemPackageManifest, map[int]problemPackageCase, error) {
	zr, err := zip.NewReader(bytes.NewReader(raw), int64(len(raw)))
	if err != nil {
		return problemPackageManifest{}, nil, fmt.Errorf("无效的题目迁移包: %w", err)
	}
	if len(zr.File) > maxProblemPackageEntries {
		return problemPackageManifest{}, nil, fmt.Errorf("迁移包文件过多（最多 %d 个）", maxProblemPackageEntries)
	}
	var total int64
	var manifestBytes []byte
	cases := map[int]problemPackageCase{}
	seen := map[string]bool{}
	for _, f := range zr.File {
		clean := path.Clean(f.Name)
		if f.FileInfo().IsDir() {
			continue
		}
		if clean != f.Name || path.IsAbs(clean) || clean == ".." || strings.HasPrefix(clean, "../") {
			return problemPackageManifest{}, nil, fmt.Errorf("非法文件路径: %q", f.Name)
		}
		if seen[clean] {
			return problemPackageManifest{}, nil, fmt.Errorf("迁移包包含重复文件: %s", clean)
		}
		seen[clean] = true
		if f.UncompressedSize64 > maxProblemPackageFile {
			return problemPackageManifest{}, nil, fmt.Errorf("文件过大（单文件最大 64MB）: %s", clean)
		}
		total += int64(f.UncompressedSize64)
		if total > maxProblemPackageTotal {
			return problemPackageManifest{}, nil, fmt.Errorf("迁移包总大小超过 512MB")
		}
		b, err := readProblemPackageEntry(f)
		if err != nil {
			return problemPackageManifest{}, nil, err
		}
		switch {
		case clean == "problem.json":
			if manifestBytes != nil {
				return problemPackageManifest{}, nil, errors.New("迁移包包含多个 problem.json")
			}
			manifestBytes = b
		case strings.HasPrefix(clean, "tests/"):
			parts := strings.Split(clean, "/")
			if len(parts) != 2 {
				return problemPackageManifest{}, nil, fmt.Errorf("测试点路径必须为 tests/N.in 或 tests/N.out: %s", clean)
			}
			name := parts[1]
			ext := ""
			switch {
			case strings.HasSuffix(name, ".in"):
				ext = ".in"
			case strings.HasSuffix(name, ".out"):
				ext = ".out"
			default:
				return problemPackageManifest{}, nil, fmt.Errorf("测试点文件扩展名必须为 .in/.out: %s", clean)
			}
			ordinal, err := strconv.Atoi(strings.TrimSuffix(name, ext))
			if err != nil || ordinal <= 0 || ordinal > 1_000_000 {
				return problemPackageManifest{}, nil, fmt.Errorf("无效的测试点编号: %s", name)
			}
			item := cases[ordinal]
			if ext == ".in" {
				item.Input = b
				item.InputSet = true
			} else {
				item.Output = b
				item.OutputSet = true
			}
			cases[ordinal] = item
		default:
			return problemPackageManifest{}, nil, fmt.Errorf("迁移包包含未知文件: %s", clean)
		}
	}
	if len(manifestBytes) == 0 {
		return problemPackageManifest{}, nil, errors.New("迁移包缺少 problem.json")
	}
	var manifest problemPackageManifest
	if err := json.Unmarshal(manifestBytes, &manifest); err != nil {
		return problemPackageManifest{}, nil, fmt.Errorf("problem.json 格式错误: %w", err)
	}
	if manifest.Version != 1 {
		return problemPackageManifest{}, nil, fmt.Errorf("不支持的迁移包版本: %d", manifest.Version)
	}
	if manifest.Problem.Type == model.ProblemTypeOutputOnly && (len(cases) > 0 || len(manifest.Testcases) > 0) {
		return problemPackageManifest{}, nil, errors.New("输出题迁移包不应包含测试点")
	}
	if len(manifest.Testcases) > 0 && len(cases) != len(manifest.Testcases) && manifest.Problem.Type != model.ProblemTypeOutputOnly {
		return problemPackageManifest{}, nil, errors.New("problem.json 中的测试点清单与文件数量不一致")
	}
	return manifest, cases, nil
}

func (a *API) handleExportProblemPackage(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err != nil {
		slogError(r, "导出题目迁移包", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	// 函数题的语言模板随迁移包一起走，否则导入后无法评测。
	harnesses, err := a.store.ListProblemHarnesses(r.Context(), id)
	if err != nil {
		slogError(r, "读取函数题模板", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	manifest := problemPackageManifest{Version: 1, Problem: problemPackagePayloadWithHarnesses(p, harnesses)}
	var cases []model.ProblemTestCase
	if p.Type != model.ProblemTypeOutputOnly {
		cases, err = a.store.ListTestcases(r.Context(), id)
		if err != nil {
			slogError(r, "读取题目测试点", err)
			writeError(w, http.StatusInternalServerError, "导出失败")
			return
		}
	}
	for _, tc := range cases {
		manifest.Testcases = append(manifest.Testcases, problemPackageTestcaseMeta{Ordinal: tc.Ordinal, Score: tc.Score})
	}

	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	jsonBytes, _ := json.MarshalIndent(manifest, "", "  ")
	if err := writeZipEntry(z, "problem.json", jsonBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	totalSize := int64(len(jsonBytes))
	for _, tc := range cases {
		for _, ext := range []string{"in", "out"} {
			filePath := store.TestcaseFilePath(a.cfg.DataDir, id, tc.Ordinal, ext)
			content, readErr := os.ReadFile(filePath)
			if readErr != nil {
				slogError(r, "读取题目测试数据", readErr)
				writeError(w, http.StatusInternalServerError, "导出失败：测试数据文件缺失")
				return
			}
			if len(content) > maxProblemPackageFile {
				writeError(w, http.StatusRequestEntityTooLarge, "测试数据文件超过 64MB")
				return
			}
			totalSize += int64(len(content))
			if totalSize > maxProblemPackageTotal {
				writeError(w, http.StatusRequestEntityTooLarge, "迁移包总大小超过 512MB")
				return
			}
			if err := writeZipEntry(z, fmt.Sprintf("tests/%d.%s", tc.Ordinal, ext), content); err != nil {
				writeError(w, http.StatusInternalServerError, "导出失败")
				return
			}
		}
	}
	if err := z.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=problem-%d-package.zip", id))
	_, _ = w.Write(buf.Bytes())
}

func (a *API) handleImportProblemPackage(w http.ResponseWriter, r *http.Request) {
	raw, ok := readProblemPackageUpload(w, r)
	if !ok {
		return
	}
	manifest, cases, err := parseProblemPackage(raw)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	// 外部包永远先落为草稿，管理员检查题面和测试点后再手动发布。
	manifest.Problem.Status = model.ProblemStatusDraft
	if msg := validateProblem(manifest.Problem); msg != "" {
		writeError(w, http.StatusBadRequest, "题目字段校验失败："+msg)
		return
	}
	p := payloadToProblem(manifest.Problem)
	if p.Type != model.ProblemTypeOutputOnly {
		if len(cases) == 0 {
			writeError(w, http.StatusBadRequest, "迁移包至少需要一个测试点")
			return
		}
		for ordinal, item := range cases {
			if !item.InputSet && !item.OutputSet {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("测试点 %d 为空", ordinal))
				return
			}
			if !item.InputSet || !item.OutputSet {
				writeError(w, http.StatusBadRequest, fmt.Sprintf("测试点 %d 缺少输入或输出文件", ordinal))
				return
			}
		}
	}
	scores := map[int]int{}
	scoreSeen := map[int]bool{}
	for _, tc := range manifest.Testcases {
		if tc.Ordinal <= 0 || tc.Score < 0 || tc.Score > 100 || scoreSeen[tc.Ordinal] {
			writeError(w, http.StatusBadRequest, "测试点编号或分值无效")
			return
		}
		scores[tc.Ordinal] = tc.Score
		scoreSeen[tc.Ordinal] = true
	}
	ordinals := make([]int, 0, len(cases))
	for ordinal := range cases {
		ordinals = append(ordinals, ordinal)
	}
	sort.Ints(ordinals)
	if p.Type != model.ProblemTypeOutputOnly {
		if len(scores) == 0 {
			full := contest.CaseFullScores(nil, len(ordinals))
			for i, ordinal := range ordinals {
				scores[ordinal] = full[i]
			}
		}
		if len(scores) != len(ordinals) {
			writeError(w, http.StatusBadRequest, "测试点清单与文件编号不一致")
			return
		}
		for _, ordinal := range ordinals {
			if !scoreSeen[ordinal] {
				writeError(w, http.StatusBadRequest, "测试点清单与文件编号不一致")
				return
			}
		}
		totalScore := 0
		for _, ordinal := range ordinals {
			totalScore += scores[ordinal]
		}
		if totalScore != 100 {
			writeError(w, http.StatusBadRequest, fmt.Sprintf("测试点总分必须为 100（当前 %d）", totalScore))
			return
		}
	}

	if err := a.store.CreateProblem(r.Context(), &p); err != nil {
		slogError(r, "导入题目", err)
		writeError(w, http.StatusInternalServerError, "导入失败")
		return
	}
	cleanup := func() {
		_ = a.store.DeleteProblem(r.Context(), p.ID)
		_ = data.RemoveTests(a.cfg.DataDir, p.ID)
	}
	if err := a.saveHarnesses(r.Context(), p.ID, payloadHarnesses(manifest.Problem)); err != nil {
		slogError(r, "导入函数题模板", err)
		cleanup()
		writeError(w, http.StatusInternalServerError, "导入失败：函数题模板保存失败")
		return
	}
	if p.Type != model.ProblemTypeOutputOnly {
		var tests bytes.Buffer
		z := zip.NewWriter(&tests)
		for _, ordinal := range ordinals {
			if err := writeZipEntry(z, fmt.Sprintf("%d.in", ordinal), cases[ordinal].Input); err != nil {
				_ = z.Close()
				cleanup()
				writeError(w, http.StatusInternalServerError, "导入失败")
				return
			}
			if err := writeZipEntry(z, fmt.Sprintf("%d.out", ordinal), cases[ordinal].Output); err != nil {
				_ = z.Close()
				cleanup()
				writeError(w, http.StatusInternalServerError, "导入失败")
				return
			}
		}
		if err := z.Close(); err != nil {
			cleanup()
			writeError(w, http.StatusInternalServerError, "导入失败")
			return
		}
		if _, err := data.WriteTests(a.cfg.DataDir, p.ID, tests.Bytes()); err != nil {
			cleanup()
			writeError(w, http.StatusBadRequest, "测试数据导入失败："+err.Error())
			return
		}
		manifestCases := make([]model.ProblemTestCase, 0, len(ordinals))
		for _, ordinal := range ordinals {
			tc, err := a.store.TestcaseFromFiles(a.cfg.DataDir, p.ID, ordinal, scores[ordinal])
			if err != nil {
				cleanup()
				writeError(w, http.StatusInternalServerError, "测试点清单生成失败")
				return
			}
			manifestCases = append(manifestCases, tc)
		}
		if err := a.store.ReplaceAllTestcases(r.Context(), p.ID, manifestCases); err != nil {
			cleanup()
			writeError(w, http.StatusInternalServerError, "测试点清单保存失败")
			return
		}
	}
	p, err = a.store.GetProblem(r.Context(), p.ID)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "导入失败")
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"problem": p, "testcase_count": len(cases)})
}
