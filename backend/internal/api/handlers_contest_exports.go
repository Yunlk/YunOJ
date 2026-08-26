package api

import (
	"archive/zip"
	"bytes"
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/yunoj/yunoj/internal/contest"
	"github.com/yunoj/yunoj/internal/model"
)

type contestExportStandingRow struct {
	Rank       int
	TeamID     int64
	TeamName   string
	Solved     int
	Penalty    int
	TotalScore int
}

func (a *API) buildContestStandingsExport(ctx context.Context, c model.Contest) (map[string]any, []contestExportStandingRow, error) {
	cctx, problems, avatars, err := a.buildContestContext(ctx, c)
	if err != nil {
		return nil, nil, err
	}
	subs, err := a.store.ListContestSubmissions(ctx, c.ID)
	if err != nil {
		return nil, nil, err
	}
	resp := map[string]any{"contest": c, "problems": problems, "mode": c.Mode, "exported_at": time.Now()}
	rows := []contestExportStandingRow{}
	switch c.Mode {
	case model.ContestModeACM:
		standings, _ := contest.BuildACMStandings(cctx, subs, time.Time{})
		dtos := acmStandingsDTO(standings, problems, avatars)
		markFirstBlood(dtos)
		resp["standings"] = dtos
		for _, item := range standings {
			rows = append(rows, contestExportStandingRow{Rank: item.Rank, TeamID: item.TeamID, TeamName: item.TeamName, Solved: item.Solved, Penalty: item.Penalty})
		}
	case model.ContestModeOI, model.ContestModeIOI:
		scores := map[int64][]int{}
		for _, p := range problems {
			tcs, err := a.store.ListTestcases(ctx, p.ProblemID)
			if err != nil {
				return nil, nil, err
			}
			for _, tc := range tcs {
				scores[p.ProblemID] = append(scores[p.ProblemID], tc.Score)
			}
		}
		standings := contest.BuildOIStandings(cctx, subs, scores, c.Mode == model.ContestModeOI)
		dtos := oiStandingsDTO(standings, problems, avatars)
		resp["standings"] = dtos
		for _, item := range standings {
			rows = append(rows, contestExportStandingRow{Rank: item.Rank, TeamID: item.TeamID, TeamName: item.TeamName, TotalScore: item.TotalScore})
		}
	}
	return resp, rows, nil
}

func (a *API) handleExportContestStandings(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	data, rows, err := a.buildContestStandingsExport(r.Context(), c)
	if err != nil {
		slogError(r, "导出排行榜", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	if r.URL.Query().Get("format") != "csv" {
		writeJSON(w, http.StatusOK, data)
		return
	}
	var buf bytes.Buffer
	csvw := csv.NewWriter(&buf)
	_ = csvw.Write([]string{"rank", "team_id", "team_name", "solved", "penalty", "total_score"})
	for _, item := range rows {
		_ = csvw.Write([]string{strconv.Itoa(item.Rank), strconv.FormatInt(item.TeamID, 10), item.TeamName,
			strconv.Itoa(item.Solved), strconv.Itoa(item.Penalty), strconv.Itoa(item.TotalScore)})
	}
	csvw.Flush()
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=contest-%d-standings.csv", cid))
	_, _ = w.Write(buf.Bytes())
}

func writeZipEntry(z *zip.Writer, name string, value []byte) error {
	f, err := z.Create(name)
	if err != nil {
		return err
	}
	_, err = f.Write(value)
	return err
}

func (a *API) handleExportContestDataPackage(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	participants, err := a.store.ListContestParticipants(r.Context(), cid)
	if err != nil {
		slogError(r, "导出参赛者", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	subs, err := a.store.ListContestSubmissionsDetailed(r.Context(), cid)
	if err != nil {
		slogError(r, "导出比赛时间线", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	standings, _, err := a.buildContestStandingsExport(r.Context(), c)
	if err != nil {
		slogError(r, "导出比赛榜单", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	var buf bytes.Buffer
	z := zip.NewWriter(&buf)
	jsonBytes, _ := json.MarshalIndent(map[string]any{"contest": c, "problems": func() []contestProblemDTO { p, _ := a.contestProblemsDTO(r.Context(), cid); return p }()}, "", "  ")
	if err := writeZipEntry(z, "contest.json", jsonBytes); err != nil {
		slogError(r, "写入比赛数据包", err)
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	var participantBuf bytes.Buffer
	pw := csv.NewWriter(&participantBuf)
	_ = pw.Write([]string{"team_id", "team_name", "captain", "members", "submission_count", "accepted_count", "last_submitted_at"})
	for _, item := range participants {
		last := ""
		if item.LastSubmittedAt != nil {
			last = item.LastSubmittedAt.Format(time.RFC3339)
		}
		_ = pw.Write([]string{strconv.FormatInt(item.TeamID, 10), item.TeamName, item.Username,
			strings.Join(item.Members, ","), strconv.FormatInt(item.SubmissionCount, 10),
			strconv.FormatInt(item.AcceptedCount, 10), last})
	}
	pw.Flush()
	if err := writeZipEntry(z, "participants.csv", participantBuf.Bytes()); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	var submissionBuf bytes.Buffer
	sw := csv.NewWriter(&submissionBuf)
	_ = sw.Write([]string{"submission_id", "problem_id", "problem_title", "team_id", "user", "language", "status", "time_ms", "memory_kb", "score", "created_at", "judged_at"})
	var timeline bytes.Buffer
	for _, sub := range subs {
		judged := ""
		if sub.JudgedAt != nil {
			judged = sub.JudgedAt.Format(time.RFC3339)
		}
		_ = sw.Write([]string{strconv.FormatInt(sub.ID, 10), strconv.FormatInt(sub.ProblemID, 10), sub.ProblemTitle,
			strconv.FormatInt(sub.UserID, 10), sub.Username, sub.Language, sub.Status, strconv.Itoa(sub.TimeMs),
			strconv.Itoa(sub.MemoryKb), strconv.Itoa(sub.Score), sub.CreatedAt.Format(time.RFC3339), judged})
		writeTimelineEvent(&timeline, map[string]any{"type": "submission_created", "submission_id": sub.ID, "team_id": sub.UserID, "problem_id": sub.ProblemID, "status": "pending", "at": sub.CreatedAt})
		if sub.JudgedAt != nil {
			writeTimelineEvent(&timeline, map[string]any{"type": "judge_finished", "submission_id": sub.ID, "team_id": sub.UserID, "problem_id": sub.ProblemID, "status": sub.Status, "score": sub.Score, "at": sub.JudgedAt})
		}
		for _, result := range sub.CaseResults {
			writeTimelineEvent(&timeline, map[string]any{"type": "case_result", "submission_id": sub.ID, "case_id": result.CaseID, "status": result.Status, "time_ms": result.TimeMs, "memory_kb": result.MemoryKb})
		}
	}
	sw.Flush()
	if err := writeZipEntry(z, "submissions.csv", submissionBuf.Bytes()); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	if err := writeZipEntry(z, "timeline.jsonl", timeline.Bytes()); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	standingBytes, _ := json.MarshalIndent(standings, "", "  ")
	if err := writeZipEntry(z, "standings.json", standingBytes); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	if err := z.Close(); err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	w.Header().Set("Content-Type", "application/zip")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=contest-%d-data.zip", cid))
	_, _ = w.Write(buf.Bytes())
}

func writeTimelineEvent(buf *bytes.Buffer, value map[string]any) {
	b, _ := json.Marshal(value)
	buf.Write(b)
	buf.WriteByte('\n')
}
