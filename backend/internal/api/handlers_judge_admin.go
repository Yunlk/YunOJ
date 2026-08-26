package api

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

const judgeNodeOnlineWindow = 12 * time.Second

type judgeNodeView struct {
	model.JudgeNode
	Online bool `json:"online"`
}

func (a *API) judgeOverview(r *http.Request) (map[string]any, error) {
	queueStats, err := a.queue.Stats(r.Context())
	if err != nil {
		return nil, err
	}
	counts, err := a.store.JudgeStatusCounts(r.Context())
	if err != nil {
		return nil, err
	}
	nodes, err := a.store.ListJudgeNodes(r.Context())
	if err != nil {
		return nil, err
	}
	languages, err := a.store.ListJudgeLanguages(r.Context())
	if err != nil {
		return nil, err
	}
	audits, err := a.store.ListJudgeAuditLogs(r.Context(), 30)
	if err != nil {
		return nil, err
	}

	now := time.Now()
	nodeViews := make([]judgeNodeView, 0, len(nodes))
	onlineNodes, actualConcurrency, desiredConcurrency := 0, 0, 0
	for _, node := range nodes {
		online := now.Sub(node.LastHeartbeat) <= judgeNodeOnlineWindow
		nodeViews = append(nodeViews, judgeNodeView{JudgeNode: node, Online: online})
		if online {
			onlineNodes++
			actualConcurrency += node.ActualConcurrency
		}
		if node.Enabled {
			desiredConcurrency += node.DesiredConcurrency
		}
	}
	processing := int64(0)
	for _, count := range queueStats.Processing {
		processing += count
	}
	return map[string]any{
		"queue": queueStats, "statuses": counts, "nodes": nodeViews,
		"languages": languages, "audit_logs": audits,
		"summary": map[string]any{
			"online_nodes": onlineNodes, "total_nodes": len(nodes),
			"actual_concurrency": actualConcurrency, "desired_concurrency": desiredConcurrency,
			"processing": processing,
		},
	}, nil
}

// handleJudgeHealth 保留轻量兼容接口。
func (a *API) handleJudgeHealth(w http.ResponseWriter, r *http.Request) {
	overview, err := a.judgeOverview(r)
	if err != nil {
		slogError(r, "评测集群状态", err)
		writeError(w, http.StatusInternalServerError, "读取评测集群失败")
		return
	}
	writeJSON(w, http.StatusOK, overview)
}

func (a *API) handleJudgeCluster(w http.ResponseWriter, r *http.Request) {
	a.handleJudgeHealth(w, r)
}

type updateJudgeNodeRequest struct {
	DisplayName        *string `json:"display_name"`
	Enabled            *bool   `json:"enabled"`
	DesiredConcurrency *int    `json:"desired_concurrency"`
}

func (a *API) handleUpdateJudgeNode(w http.ResponseWriter, r *http.Request) {
	nodeID := chi.URLParam(r, "node_id")
	if strings.TrimSpace(nodeID) == "" {
		writeError(w, http.StatusBadRequest, "节点 ID 不能为空")
		return
	}
	var req updateJudgeNodeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.DisplayName != nil {
		name := strings.TrimSpace(*req.DisplayName)
		if name == "" || len(name) > 80 {
			writeError(w, http.StatusBadRequest, "节点名称长度需在 1-80 字符之间")
			return
		}
		req.DisplayName = &name
	}
	if req.DesiredConcurrency != nil && (*req.DesiredConcurrency < 0 || *req.DesiredConcurrency > 256) {
		writeError(w, http.StatusBadRequest, "并发数需在 0-256 之间")
		return
	}
	if req.DisplayName == nil && req.Enabled == nil && req.DesiredConcurrency == nil {
		writeError(w, http.StatusBadRequest, "没有可更新的字段")
		return
	}
	if err := a.store.UpdateJudgeNode(r.Context(), nodeID, req.DisplayName, req.Enabled, req.DesiredConcurrency); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "节点不存在")
			return
		}
		slogError(r, "更新评测节点", err)
		writeError(w, http.StatusInternalServerError, "保存节点设置失败")
		return
	}
	detail, _ := json.Marshal(req)
	u, _ := userFromCtx(r.Context())
	_ = a.store.AddJudgeAuditLog(r.Context(), u.ID, "update_node", nodeID, string(detail))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

type updateJudgeLanguageRequest struct {
	Enabled *bool `json:"enabled"`
}

func (a *API) handleUpdateJudgeLanguage(w http.ResponseWriter, r *http.Request) {
	key := chi.URLParam(r, "key")
	var req updateJudgeLanguageRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.Enabled == nil {
		writeError(w, http.StatusBadRequest, "缺少 enabled")
		return
	}
	if err := a.store.SetJudgeLanguageEnabled(r.Context(), key, *req.Enabled); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "语言不存在")
			return
		}
		slogError(r, "更新评测语言", err)
		writeError(w, http.StatusInternalServerError, "保存语言设置失败")
		return
	}
	u, _ := userFromCtx(r.Context())
	_ = a.store.AddJudgeAuditLog(r.Context(), u.ID, "update_language", key,
		fmt.Sprintf(`{"enabled":%t}`, *req.Enabled))
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
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
		if err := a.queue.RemoveProcessingEverywhere(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, "清理旧评测任务失败")
			return
		}
		if err := a.queue.Push(r.Context(), id); err != nil {
			writeError(w, http.StatusInternalServerError, "重新入队失败")
			return
		}
	}
	u, _ := userFromCtx(r.Context())
	_ = a.store.AddJudgeAuditLog(r.Context(), u.ID, "recover_stale", "submissions",
		fmt.Sprintf(`{"age_seconds":%d,"count":%d}`, age, len(resetIDs)))
	writeJSON(w, http.StatusOK, map[string]any{"reset": len(resetIDs), "enqueued": len(resetIDs)})
}
