package api

import (
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"

	"github.com/yunoj/yunoj/internal/store"
)

// handleContestParticipants 返回比赛参赛者管理列表。
func (a *API) handleContestParticipants(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	if _, err := a.store.GetContest(r.Context(), cid); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	items, err := a.store.ListContestParticipants(r.Context(), cid)
	if err != nil {
		slogError(r, "比赛参赛者", err)
		writeError(w, http.StatusInternalServerError, "查询参赛者失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleRemoveContestParticipant 移除参赛者报名，历史提交不删除。
func (a *API) handleRemoveContestParticipant(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	tid, err := strconv.ParseInt(chiURLParam(r, "team_id"), 10, 64)
	if err != nil || tid <= 0 {
		writeError(w, http.StatusBadRequest, "无效的用户 ID")
		return
	}
	if err := a.store.RemoveContestTeam(r.Context(), cid, tid); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "参赛者不存在")
			return
		}
		writeError(w, http.StatusInternalServerError, "移除参赛者失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleExportContestParticipants 导出参赛者 CSV，供教师/管理员存档。
func (a *API) handleExportContestParticipants(w http.ResponseWriter, r *http.Request) {
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	items, err := a.store.ListContestParticipants(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "导出失败")
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="contest-participants.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"用户 ID", "用户名", "队伍名", "提交数", "AC 数", "最后提交时间"})
	for _, item := range items {
		last := ""
		if item.LastSubmittedAt != nil {
			last = item.LastSubmittedAt.Format("2006-01-02 15:04:05")
		}
		_ = writer.Write([]string{strconv.FormatInt(item.TeamID, 10), item.Username, item.TeamName,
			strconv.FormatInt(item.SubmissionCount, 10), strconv.FormatInt(item.AcceptedCount, 10), last})
	}
	writer.Flush()
}
