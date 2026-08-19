package store

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strconv"

	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/data"
	"github.com/yunoj/yunoj/internal/model"
)

// ---------- 测试点 manifest ----------
//
// problem_testcases 是测试点编号/分值的权威来源：
//   - ordinal 为稳定编号（删除后留空档不重排），分值永远跟随 ordinal；
//   - 数据文件位于 {DataDir}/problems/{id}/tests/{ordinal}.in/.out；
//   - problems.testcase_scores 自迁移 5 起弃用，仅在 BackfillTestcases 中读取。

// ListTestcases 列出题目的全部测试点（按 ordinal 升序）。
func (s *Store) ListTestcases(ctx context.Context, problemID int64) ([]model.ProblemTestCase, error) {
	rows, err := s.pool.Query(ctx,
		`SELECT problem_id, ordinal, score, size_bytes, input_sha, output_sha, updated_at
		 FROM problem_testcases WHERE problem_id = $1 ORDER BY ordinal`, problemID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []model.ProblemTestCase{}
	for rows.Next() {
		var t model.ProblemTestCase
		if err := rows.Scan(&t.ProblemID, &t.Ordinal, &t.Score, &t.SizeBytes,
			&t.InputSHA, &t.OutputSHA, &t.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, t)
	}
	return items, rows.Err()
}

// HasTestcases 判断题目是否已有 manifest 记录。
func (s *Store) HasTestcases(ctx context.Context, problemID int64) (bool, error) {
	var exists bool
	err := s.pool.QueryRow(ctx,
		`SELECT EXISTS (SELECT 1 FROM problem_testcases WHERE problem_id = $1)`,
		problemID).Scan(&exists)
	return exists, err
}

// UpsertTestcase 插入或更新单个测试点（分值/大小/摘要，以 ordinal 为键）。
func (s *Store) UpsertTestcase(ctx context.Context, t model.ProblemTestCase) error {
	_, err := s.pool.Exec(ctx,
		`INSERT INTO problem_testcases (problem_id, ordinal, score, size_bytes, input_sha, output_sha)
		 VALUES ($1, $2, $3, $4, $5, $6)
		 ON CONFLICT (problem_id, ordinal) DO UPDATE SET
			score = $3, size_bytes = $4, input_sha = $5, output_sha = $6, updated_at = now()`,
		t.ProblemID, t.Ordinal, t.Score, t.SizeBytes, t.InputSHA, t.OutputSHA)
	return err
}

// DeleteTestcase 删除单个测试点记录（文件删除由调用方负责）。
func (s *Store) DeleteTestcase(ctx context.Context, problemID int64, ordinal int) error {
	_, err := s.pool.Exec(ctx,
		`DELETE FROM problem_testcases WHERE problem_id = $1 AND ordinal = $2`,
		problemID, ordinal)
	return err
}

// ReplaceAllTestcases 全量替换测试点（事务内先清空再插入，用于 ZIP 导入）。
func (s *Store) ReplaceAllTestcases(ctx context.Context, problemID int64, tcs []model.ProblemTestCase) error {
	tx, err := s.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()
	if _, err := tx.Exec(ctx,
		`DELETE FROM problem_testcases WHERE problem_id = $1`, problemID); err != nil {
		return err
	}
	for i := range tcs {
		tcs[i].ProblemID = problemID
		if _, err := tx.Exec(ctx,
			`INSERT INTO problem_testcases (problem_id, ordinal, score, size_bytes, input_sha, output_sha)
			 VALUES ($1, $2, $3, $4, $5, $6)`,
			tcs[i].ProblemID, tcs[i].Ordinal, tcs[i].Score,
			tcs[i].SizeBytes, tcs[i].InputSHA, tcs[i].OutputSHA); err != nil {
			return err
		}
	}
	return tx.Commit(ctx)
}

// BackfillTestcases 为「有数据文件但 manifest 为空」的旧题目回填测试点记录。
// 分值语义与旧实现一致：按文件序号对齐 problems.testcase_scores，空/不足时均分。
// 幂等：manifest 已有记录（含空）的题目跳过；多实例并发时靠 ON CONFLICT 保证不重复。
// 返回回填的题目数。
func (s *Store) BackfillTestcases(ctx context.Context, dataDir string) (int, error) {
	rows, err := s.pool.Query(ctx, `SELECT id, testcase_scores FROM problems ORDER BY id`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()

	type pending struct {
		id     int64
		scores []byte
	}
	pend := []pending{}
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.scores); err != nil {
			return 0, err
		}
		pend = append(pend, p)
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}

	backfilled := 0
	for _, p := range pend {
		exists, err := s.HasTestcases(ctx, p.id)
		if err != nil {
			return backfilled, err
		}
		if exists {
			continue
		}
		cases, err := data.ListTests(dataDir, p.id)
		if err != nil {
			return backfilled, err
		}
		if len(cases) == 0 {
			continue // 没有数据文件的题目：保持 manifest 为空
		}
		// 解析旧分值列，与排序后的文件对齐（与旧评测行为一致）
		var legacy []int
		if len(p.scores) > 0 {
			_ = json.Unmarshal(p.scores, &legacy)
		}
		full := contest.CaseFullScores(legacy, len(cases))
		tcs := make([]model.ProblemTestCase, 0, len(cases))
		for i, c := range cases {
			ordinal, convErr := strconv.Atoi(c.Name)
			if convErr != nil {
				continue // 非数字文件名不进入 manifest
			}
			inSHA, inSize, err1 := fileSHA(c.InputPath)
			outSHA, outSize, err2 := fileSHA(c.OutputPath)
			if err1 != nil {
				return backfilled, err1
			}
			if err2 != nil {
				return backfilled, err2
			}
			tcs = append(tcs, model.ProblemTestCase{
				Ordinal:   ordinal,
				Score:     full[i],
				SizeBytes: inSize + outSize,
				InputSHA:  inSHA,
				OutputSHA: outSHA,
			})
		}
		if err := s.ReplaceAllTestcases(ctx, p.id, tcs); err != nil {
			return backfilled, err
		}
		backfilled++
		slog.Info("测试点 manifest 已回填", "problem_id", p.id, "cases", len(tcs))
	}
	return backfilled, nil
}

// fileSHA 计算文件 SHA-256 与大小。
func fileSHA(path string) (string, int64, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", 0, err
	}
	defer f.Close()
	h := sha256.New()
	n, err := io.Copy(h, f)
	if err != nil {
		return "", 0, err
	}
	return hex.EncodeToString(h.Sum(nil)), n, nil
}

// SortedTestcaseOrdinals 返回按 ordinal 升序的编号列表（测试点重排/校验用）。
func SortedTestcaseOrdinals(tcs []model.ProblemTestCase) []int {
	out := make([]int, 0, len(tcs))
	for _, t := range tcs {
		out = append(out, t.Ordinal)
	}
	sort.Ints(out)
	return out
}

// TestcaseFilePath 测试点数据文件路径（输入/输出）。
func TestcaseFilePath(dataDir string, problemID int64, ordinal int, ext string) string {
	return filepath.Join(dataDir, "problems", strconv.FormatInt(problemID, 10),
		"tests", strconv.Itoa(ordinal)+"."+ext)
}
