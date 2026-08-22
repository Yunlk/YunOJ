package api

import (
	"errors"
	"net/http"

	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// handleRankings 返回公开的全站训练排名。
func (a *API) handleRankings(w http.ResponseWriter, r *http.Request) {
	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)
	entries, err := a.store.ListRankingEntries(r.Context())
	if err != nil {
		slogError(r, "全站排名", err)
		writeError(w, http.StatusInternalServerError, "查询排名失败")
		return
	}
	total := len(entries)
	start := (page - 1) * size
	if start > total {
		start = total
	}
	end := start + size
	if end > total {
		end = total
	}
	writeJSON(w, http.StatusOK, map[string]any{
		"items": entries[start:end],
		"total": total,
	})
}

func (a *API) decorateUserRanking(r *http.Request, u model.User) model.User {
	if !model.IsStudent(u.Role) {
		return u
	}
	u.Rating = 1000
	item, err := a.store.GetUserRankingEntry(r.Context(), u.ID)
	if err == nil {
		u.Rating = item.Rating
		u.Rank = item.Rank
	} else if !errors.Is(err, store.ErrNotFound) {
		slogError(r, "用户排名", err)
	}
	return u
}
