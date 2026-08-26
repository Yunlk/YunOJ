package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"sort"
	"strconv"
	"strings"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// ---------- 测试点管理（管理员） ----------

// testcaseDTO 单个测试点视图（含文件存在性校验状态）。
type testcaseDTO struct {
	Ordinal      int    `json:"ordinal"`
	Score        int    `json:"score"`
	SizeBytes    int64  `json:"size_bytes"`
	InputSHA     string `json:"input_sha"`
	OutputSHA    string `json:"output_sha"`
	InputExists  bool   `json:"input_exists"`
	OutputExists bool   `json:"output_exists"`
	Valid        bool   `json:"valid"` // .in/.out 成对存在
}

// handleListTestcases 测试点列表（编号/分值/大小/摘要/校验状态 + 总分）。
func (a *API) handleListTestcases(w http.ResponseWriter, r *http.Request) {
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
		slogError(r, "测试点列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	tcs, err := a.store.ListTestcases(r.Context(), id)
	if err != nil {
		slogError(r, "测试点列表", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	dtos := make([]testcaseDTO, 0, len(tcs))
	total := 0
	for _, t := range tcs {
		inPath := store.TestcaseFilePath(a.cfg.DataDir, id, t.Ordinal, "in")
		outPath := store.TestcaseFilePath(a.cfg.DataDir, id, t.Ordinal, "out")
		inExists := fileExists(inPath)
		outExists := fileExists(outPath)
		total += t.Score
		dtos = append(dtos, testcaseDTO{
			Ordinal: t.Ordinal, Score: t.Score, SizeBytes: t.SizeBytes,
			InputSHA: t.InputSHA, OutputSHA: t.OutputSHA,
			InputExists: inExists, OutputExists: outExists,
			Valid: inExists && outExists,
		})
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items":        dtos,
		"count":        len(dtos),
		"total_score":  total,
		"problem_type": p.Type,
		// 完整性：output_only 不要求；其余需 ≥1 个测试点且总分 100
		"score_valid": p.Type == model.ProblemTypeOutputOnly ||
			(len(dtos) > 0 && total == 100),
	})
}

// ---------- ZIP 预览与导入 ----------

// zipPreviewDTO ZIP 解析预览结果。
type zipPreviewDTO struct {
	Entries   []zipEntryDTO `json:"entries"`
	Pairs     []zipPairDTO  `json:"pairs"`
	Unpaired  []string      `json:"unpaired"`
	TotalSize int64         `json:"total_size"`
	Valid     bool          `json:"valid"`
}

type zipEntryDTO struct {
	Name string `json:"name"`
	Size int64  `json:"size"`
}

type zipPairDTO struct {
	Name    string `json:"name"`
	InSize  int64  `json:"in_size"`
	OutSize int64  `json:"out_size"`
}

// analyzeZip 解析 zip 并做成对分析（与导入一致的安全检查）。
func analyzeZip(zipData []byte) (*zipPreviewDTO, error) {
	entries, err := data.ParseZip(zipData)
	if err != nil {
		return nil, err
	}
	preview := &zipPreviewDTO{
		Entries: make([]zipEntryDTO, 0, len(entries)),
		Pairs:   []zipPairDTO{},
	}
	inSizes := map[string]int64{}
	outSizes := map[string]int64{}
	for _, e := range entries {
		preview.Entries = append(preview.Entries, zipEntryDTO{Name: e.Name, Size: e.Size})
		preview.TotalSize += e.Size
		if e.IsDir {
			continue
		}
		switch {
		case strings.HasSuffix(e.Name, ".in"):
			inSizes[strings.TrimSuffix(e.Name, ".in")] = e.Size
		case strings.HasSuffix(e.Name, ".out"):
			outSizes[strings.TrimSuffix(e.Name, ".out")] = e.Size
		default:
			preview.Unpaired = append(preview.Unpaired, e.Name)
		}
	}
	bases := make([]string, 0, len(inSizes))
	for b := range inSizes {
		bases = append(bases, b)
	}
	sort.Strings(bases)
	for _, b := range bases {
		outSize, ok := outSizes[b]
		if !ok {
			preview.Unpaired = append(preview.Unpaired, b+".in")
			continue
		}
		preview.Pairs = append(preview.Pairs, zipPairDTO{
			Name: b, InSize: inSizes[b], OutSize: outSize,
		})
	}
	for b := range outSizes {
		if _, ok := inSizes[b]; !ok {
			preview.Unpaired = append(preview.Unpaired, b+".out")
		}
	}
	sort.Strings(preview.Unpaired)
	preview.Valid = len(preview.Pairs) > 0 && len(preview.Unpaired) == 0
	return preview, nil
}

// handlePreviewTestsZIP ZIP 上传前预览：解析结果、成对情况，不落盘。
func (a *API) handlePreviewTestsZIP(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	zipData, ok := readZIPUpload(w, r)
	if !ok {
		return
	}
	preview, err := analyzeZip(zipData)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, preview)
}

// handleImportTestsZIP 确认导入 ZIP：replace=整体替换（文件+manifest），append=追加。
// 校验：.in/.out 成对、编号可解析且不重复、分值合法、总分=100（standard/spj/interactive）。
func (a *API) handleImportTestsZIP(w http.ResponseWriter, r *http.Request) {
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
		slogError(r, "导入测试点", err)
		writeError(w, http.StatusInternalServerError, "导入失败")
		return
	}
	if msg := checkTestcaseAllowed(p.Type); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	zipData, ok := readZIPUpload(w, r)
	if !ok {
		return
	}
	preview, err := analyzeZip(zipData)
	if err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	if !preview.Valid {
		writeError(w, http.StatusBadRequest,
			fmt.Sprintf("测试数据不成对，问题文件：%s", strings.Join(preview.Unpaired, "、")))
		return
	}
	// 编号必须为数字且互不重复
	ordinals := make([]int, 0, len(preview.Pairs))
	seen := map[int]bool{}
	for _, pair := range preview.Pairs {
		n, convErr := strconv.Atoi(pair.Name)
		if convErr != nil {
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("测试点名称必须为数字（如 1.in/1.out），发现 %q", pair.Name))
			return
		}
		if n <= 0 || seen[n] {
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("测试点编号必须为正整数且互不重复，发现 %q", pair.Name))
			return
		}
		seen[n] = true
		ordinals = append(ordinals, n)
	}

	mode := strings.TrimSpace(r.FormValue("mode"))
	if mode == "" {
		mode = "replace"
	}
	scores, hasScores, err := parseScoreList(r.FormValue("scores"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "分值列表格式错误："+err.Error())
		return
	}
	switch mode {
	case "replace":
		if hasScores && len(scores) != len(ordinals) {
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("分值数量（%d）与测试点数量（%d）不一致", len(scores), len(ordinals)))
			return
		}
		if !hasScores {
			scores = contest.CaseFullScores(nil, len(ordinals))
		}
		if _, err := data.WriteTests(a.cfg.DataDir, id, zipData); err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		tcs := make([]model.ProblemTestCase, 0, len(ordinals))
		for i, ord := range ordinals {
			tc, err := a.store.TestcaseFromFiles(a.cfg.DataDir, id, ord, scores[i])
			if err != nil {
				slogError(r, "读取测试点文件", err)
				writeError(w, http.StatusInternalServerError, "导入失败")
				return
			}
			tcs = append(tcs, tc)
		}
		if msg := validateTotalScore(tcs, p.Type); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		if err := a.store.ReplaceAllTestcases(r.Context(), id, tcs); err != nil {
			slogError(r, "写入测试点 manifest", err)
			writeError(w, http.StatusInternalServerError, "导入失败")
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"count": len(tcs), "ordinals": ordinals})
	case "append":
		if !hasScores {
			writeError(w, http.StatusBadRequest, "追加模式必须为每个新测试点提供分值（scores）")
			return
		}
		if len(scores) != len(ordinals) {
			writeError(w, http.StatusBadRequest,
				fmt.Sprintf("分值数量（%d）与新增测试点数量（%d）不一致", len(scores), len(ordinals)))
			return
		}
		existing, err := a.store.ListTestcases(r.Context(), id)
		if err != nil {
			slogError(r, "查询测试点", err)
			writeError(w, http.StatusInternalServerError, "导入失败")
			return
		}
		maxOrd := 0
		for _, t := range existing {
			if t.Ordinal > maxOrd {
				maxOrd = t.Ordinal
			}
		}
		n, err := data.AppendTests(a.cfg.DataDir, id, zipData, maxOrd)
		if err != nil {
			writeError(w, http.StatusBadRequest, err.Error())
			return
		}
		tcs := make([]model.ProblemTestCase, 0, n)
		for i := 0; i < n; i++ {
			tc, err := a.store.TestcaseFromFiles(a.cfg.DataDir, id, maxOrd+i+1, scores[i])
			if err != nil {
				slogError(r, "读取测试点文件", err)
				writeError(w, http.StatusInternalServerError, "导入失败")
				return
			}
			tcs = append(tcs, tc)
			if err := a.store.UpsertTestcase(r.Context(), tc); err != nil {
				slogError(r, "写入测试点 manifest", err)
				writeError(w, http.StatusInternalServerError, "导入失败")
				return
			}
		}
		// 追加后整体校验总分
		all, err := a.store.ListTestcases(r.Context(), id)
		if err != nil {
			slogError(r, "查询测试点", err)
			writeError(w, http.StatusInternalServerError, "导入失败")
			return
		}
		if msg := validateTotalScore(all, p.Type); msg != "" {
			writeError(w, http.StatusBadRequest, msg)
			return
		}
		writeJSON(w, http.StatusOK, map[string]any{"count": n, "start_ordinal": maxOrd + 1})
	default:
		writeError(w, http.StatusBadRequest, "无效的导入模式（replace/append）")
	}
}

// ---------- 单点增删改 ----------

// handleAddTestcase 追加单个测试点（multipart: in / out 文件 + score 表单字段）。
func (a *API) handleAddTestcase(w http.ResponseWriter, r *http.Request) {
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
		slogError(r, "添加测试点", err)
		writeError(w, http.StatusInternalServerError, "添加失败")
		return
	}
	if msg := checkTestcaseAllowed(p.Type); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := r.ParseMultipartForm(16 << 20); err != nil {
		writeError(w, http.StatusBadRequest, "解析上传内容失败")
		return
	}
	inFile, _, err := r.FormFile("in")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少输入文件（multipart 字段名 in）")
		return
	}
	defer inFile.Close()
	outFile, _, err := r.FormFile("out")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少输出文件（multipart 字段名 out）")
		return
	}
	defer outFile.Close()
	inData, err := io.ReadAll(io.LimitReader(inFile, 64<<20+1))
	if err != nil || len(inData) > 64<<20 {
		writeError(w, http.StatusBadRequest, "输入文件过大（最大 64MB）")
		return
	}
	outData, err := io.ReadAll(io.LimitReader(outFile, 64<<20+1))
	if err != nil || len(outData) > 64<<20 {
		writeError(w, http.StatusBadRequest, "输出文件过大（最大 64MB）")
		return
	}
	score, err := strconv.Atoi(strings.TrimSpace(r.FormValue("score")))
	if err != nil || score < 0 || score > 100 {
		writeError(w, http.StatusBadRequest, "分值需为 0-100 的整数")
		return
	}

	existing, err := a.store.ListTestcases(r.Context(), id)
	if err != nil {
		slogError(r, "查询测试点", err)
		writeError(w, http.StatusInternalServerError, "添加失败")
		return
	}
	maxOrd := 0
	for _, t := range existing {
		if t.Ordinal > maxOrd {
			maxOrd = t.Ordinal
		}
	}
	ordinal := maxOrd + 1
	if err := data.WriteTestFiles(a.cfg.DataDir, id, ordinal, inData, outData); err != nil {
		writeError(w, http.StatusBadRequest, err.Error())
		return
	}
	tc, err := a.store.TestcaseFromFiles(a.cfg.DataDir, id, ordinal, score)
	if err != nil {
		slogError(r, "读取测试点文件", err)
		writeError(w, http.StatusInternalServerError, "添加失败")
		return
	}
	if err := a.store.UpsertTestcase(r.Context(), tc); err != nil {
		slogError(r, "写入测试点", err)
		writeError(w, http.StatusInternalServerError, "添加失败")
		return
	}
	all, _ := a.store.ListTestcases(r.Context(), id)
	if msg := enforceScoreInvariant(p, all); msg != "" {
		// 回滚本次添加，避免线上题目被改坏
		_ = a.store.DeleteTestcase(r.Context(), id, ordinal)
		_ = data.RemoveTestFiles(a.cfg.DataDir, id, ordinal)
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"ordinal": ordinal, "score": score})
}

// handleUpdateTestcase 修改单个测试点分值（JSON: {score}）。校验总分=100。
func (a *API) handleUpdateTestcase(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	ordinal, err := strconv.Atoi(chiURLParam(r, "ordinal"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的测试点编号")
		return
	}
	p, err := a.store.GetProblem(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if err != nil {
		slogError(r, "更新测试点", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	var req struct {
		Score int `json:"score"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Score < 0 || req.Score > 100 {
		writeError(w, http.StatusBadRequest, "分值需为 0-100 的整数")
		return
	}
	tcs, err := a.store.ListTestcases(r.Context(), id)
	if err != nil {
		slogError(r, "查询测试点", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	idx := -1
	for i, t := range tcs {
		if t.Ordinal == ordinal {
			idx = i
			break
		}
	}
	if idx < 0 {
		writeError(w, http.StatusNotFound, "测试点不存在")
		return
	}
	tcs[idx].Score = req.Score
	if msg := enforceScoreInvariant(p, tcs); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := a.store.UpsertTestcase(r.Context(), tcs[idx]); err != nil {
		slogError(r, "更新测试点", err)
		writeError(w, http.StatusInternalServerError, "更新失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ordinal": ordinal, "score": req.Score})
}

// handleDeleteTestcase 删除单个测试点（manifest 行 + 文件）。其余编号保持不变。
func (a *API) handleDeleteTestcase(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	ordinal, err := strconv.Atoi(chiURLParam(r, "ordinal"))
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的测试点编号")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	// 已发布题目删除后仍须满足完整性约束（防止删坏线上题）
	p, _ := a.store.GetProblem(r.Context(), id)
	tcs, err := a.store.ListTestcases(r.Context(), id)
	if err != nil {
		slogError(r, "删除测试点", err)
		writeError(w, http.StatusInternalServerError, "删除失败")
		return
	}
	remaining := make([]model.ProblemTestCase, 0, len(tcs))
	for _, t := range tcs {
		if t.Ordinal != ordinal {
			remaining = append(remaining, t)
		}
	}
	if msg := enforceScoreInvariant(p, remaining); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := a.store.DeleteTestcase(r.Context(), id, ordinal); err != nil {
		slogError(r, "删除测试点", err)
		writeError(w, http.StatusInternalServerError, "删除失败")
		return
	}
	_ = data.RemoveTestFiles(a.cfg.DataDir, id, ordinal)
	w.WriteHeader(http.StatusNoContent)
}

// handleReorderTestcases 重排测试点：{ordinals: [按新顺序排列的现有编号]}。
// 分值跟随测试点移动；重排后编号规范化为 1..N。
func (a *API) handleReorderTestcases(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), id); err != nil {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	var req struct {
		Ordinals []int `json:"ordinals"`
	}
	if !decodeJSON(w, r, &req) {
		return
	}
	tcs, err := a.store.ListTestcases(r.Context(), id)
	if err != nil {
		slogError(r, "重排测试点", err)
		writeError(w, http.StatusInternalServerError, "重排失败")
		return
	}
	existing := map[int]model.ProblemTestCase{}
	for _, t := range tcs {
		existing[t.Ordinal] = t
	}
	if len(req.Ordinals) != len(existing) {
		writeError(w, http.StatusBadRequest, "必须提供全部现有测试点的完整排列")
		return
	}
	seen := map[int]bool{}
	for _, o := range req.Ordinals {
		if _, ok := existing[o]; !ok || seen[o] {
			writeError(w, http.StatusBadRequest, "测试点编号排列与现有编号不一致")
			return
		}
		seen[o] = true
	}

	// 两步重命名避免新旧编号冲突
	type rename struct{ from, to int }
	renames := make([]rename, 0, len(req.Ordinals))
	for i, oldOrd := range req.Ordinals {
		renames = append(renames, rename{from: oldOrd, to: i + 1})
	}
	for _, rn := range renames {
		if rn.from == rn.to {
			continue
		}
		for _, ext := range []string{"in", "out"} {
			oldPath := store.TestcaseFilePath(a.cfg.DataDir, id, rn.from, ext)
			tmpPath := store.TestcaseFilePath(a.cfg.DataDir, id, rn.from, ext) + ".reorder.tmp"
			if err := os.Rename(oldPath, tmpPath); err != nil {
				writeError(w, http.StatusInternalServerError, "重排文件失败")
				return
			}
		}
	}
	for _, rn := range renames {
		if rn.from == rn.to {
			continue
		}
		for _, ext := range []string{"in", "out"} {
			tmpPath := store.TestcaseFilePath(a.cfg.DataDir, id, rn.from, ext) + ".reorder.tmp"
			newPath := store.TestcaseFilePath(a.cfg.DataDir, id, rn.to, ext)
			if err := os.Rename(tmpPath, newPath); err != nil {
				writeError(w, http.StatusInternalServerError, "重排文件失败")
				return
			}
		}
	}

	// 重建 manifest：分值跟随原 ordinal
	newRows := make([]model.ProblemTestCase, 0, len(req.Ordinals))
	for i, oldOrd := range req.Ordinals {
		row := existing[oldOrd]
		row.Ordinal = i + 1
		newRows = append(newRows, row)
	}
	if err := a.store.ReplaceAllTestcases(r.Context(), id, newRows); err != nil {
		slogError(r, "重排测试点 manifest", err)
		writeError(w, http.StatusInternalServerError, "重排失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ordinals": req.Ordinals})
}

// ---------- 工具函数 ----------

// enforceScoreInvariant 分值完整性约束：
//   - 草稿/停用题目：允许任意中间状态（总分不要求 100）；
//   - 已发布题目：standard/spj/interactive 必须 ≥1 个测试点且总分恰好 100
//     （防止线上题目被改坏；发布校验见 handleUpdateProblemStatus）。
func enforceScoreInvariant(p model.Problem, tcs []model.ProblemTestCase) string {
	if p.Status != model.ProblemStatusPublished {
		return ""
	}
	if p.Type == model.ProblemTypeOutputOnly {
		return ""
	}
	if len(tcs) == 0 {
		return "已发布的题目至少需要 1 个测试点（可先转为草稿再编辑）"
	}
	return validateTotalScore(tcs, p.Type)
}

// chiURLParam 读取 chi 路由参数。
func chiURLParam(r *http.Request, name string) string {
	return chi.URLParam(r, name)
}

func fileExists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

// readZIPUpload 读取 multipart 上传的 zip（字段名 file），做大小限制。
func readZIPUpload(w http.ResponseWriter, r *http.Request) ([]byte, bool) {
	r.Body = http.MaxBytesReader(w, r.Body, maxUploadBytes+1<<20)
	if err := r.ParseMultipartForm(maxUploadMemory); err != nil {
		writeError(w, http.StatusBadRequest, "上传失败：文件过大或格式错误")
		return nil, false
	}
	file, _, err := r.FormFile("file")
	if err != nil {
		writeError(w, http.StatusBadRequest, "缺少 zip 文件（multipart 字段名 file）")
		return nil, false
	}
	defer file.Close()
	zipBytes, err := io.ReadAll(io.LimitReader(file, maxUploadBytes+1))
	if err != nil {
		writeError(w, http.StatusBadRequest, "读取上传文件失败")
		return nil, false
	}
	if len(zipBytes) > maxUploadBytes {
		writeError(w, http.StatusRequestEntityTooLarge, "zip 文件过大（最大 256MB）")
		return nil, false
	}
	return zipBytes, true
}

// parseScoreList 解析 JSON 整数数组字符串；空串返回 hasScores=false。
func parseScoreList(s string) ([]int, bool, error) {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil, false, nil
	}
	var scores []int
	if err := json.Unmarshal([]byte(s), &scores); err != nil {
		return nil, false, err
	}
	for _, v := range scores {
		if v < 0 || v > 100 {
			return nil, false, fmt.Errorf("分值需在 0-100 之间")
		}
	}
	return scores, true, nil
}

// checkTestcaseAllowed 输出题不支持测试点。
func checkTestcaseAllowed(ptype string) string {
	if ptype == model.ProblemTypeOutputOnly {
		return "输出题（output_only）不支持测试点"
	}
	return ""
}

// validateTotalScore 校验总分恰好 100（standard/spj/interactive）。
func validateTotalScore(tcs []model.ProblemTestCase, ptype string) string {
	if msg := checkTestcaseAllowed(ptype); msg != "" {
		return msg
	}
	sum := 0
	for _, t := range tcs {
		sum += t.Score
	}
	if sum != 100 {
		return fmt.Sprintf("测试点总分必须为 100（当前 %d）", sum)
	}
	return ""
}
