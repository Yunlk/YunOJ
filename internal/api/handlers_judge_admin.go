package api

import "net/http"

// handleJudgeHealth 返回评测队列和数据库状态概览。
func (a *API) handleJudgeHealth(w http.ResponseWriter, r *http.Request) {
	queueStats, err := a.queue.Stats(r.Context(), a.cfg.JudgeWorkers)
	if err != nil {
		slogError(r, "评测队列状态", err)
		writeError(w, http.StatusInternalServerError, "读取评测队列失败")
		return
	}
	counts, err := a.store.JudgeStatusCounts(r.Context())
	if err != nil {
		slogError(r, "评测状态统计", err)
		writeError(w, http.StatusInternalServerError, "读取评测状态失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"queue":    queueStats,
		"statuses": counts,
		"workers":  a.cfg.JudgeWorkers,
	})
}

// handleResetStaleJudgeTasks 将卡住任务恢复为 pending 并重新入队。
func (a *API) handleResetStaleJudgeTasks(w http.ResponseWriter, r *http.Request) {
	age := clamp(queryInt(r, "age_seconds", 600), 60, 86400)
	resetIDs, err := a.store.ResetStaleRunning(r.Context(), age)
	if err != nil {
		slogError(r, "恢复卡住评测", err)
		writeError(w, http.StatusInternalServerError, "恢复评测任务失败")
		return
	}
	for _, id := range resetIDs {
		if err := a.queue.Push(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, "重新入队失败")
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]any{"reset": len(resetIDs), "enqueued": len(resetIDs)})
}
