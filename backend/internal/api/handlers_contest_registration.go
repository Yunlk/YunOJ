package api

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

// handleGetContestRegistration 返回独立报名页所需的报名和队伍信息。
func (a *API) handleGetContestRegistration(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	if err != nil {
		slogError(r, "查询比赛报名", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if visible, msg := a.contestVisibleTo(r, c); !visible {
		writeError(w, http.StatusNotFound, msg)
		return
	}
	resp := map[string]any{
		"contest": c, "registration_mode": c.RegistrationMode,
		"max_team_size": c.MaxTeamSize, "allow_team_edit": c.AllowTeamEdit,
		"is_registered": false, "team": nil, "members": []model.ContestTeamMember{},
	}
	team, teamErr := a.store.FindContestTeamForUser(r.Context(), cid, u.ID)
	if teamErr == nil {
		members, memberErr := a.store.ListContestTeamMembers(r.Context(), cid, team.TeamID)
		if memberErr != nil {
			slogError(r, "查询比赛成员", memberErr)
			writeError(w, http.StatusInternalServerError, "查询失败")
			return
		}
		isCaptain := team.TeamID == u.ID
		for _, member := range members {
			if member.UserID == u.ID {
				isCaptain = member.IsCaptain
				break
			}
		}
		resp["is_registered"] = true
		resp["team"] = map[string]any{
			"team_id": team.TeamID, "team_name": team.TeamName, "avatar": team.Avatar,
			"is_captain": isCaptain,
		}
		resp["members"] = members
	}
	writeJSON(w, http.StatusOK, resp)
}

type contestMemberPayload struct {
	UserID   *int64 `json:"user_id"`
	Username string `json:"username"`
}

// handleAddContestMember 由队长按用户名或用户 ID 添加成员。
func (a *API) handleAddContestMember(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	teamID, err := parsePathID(r, "team_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的队伍 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	team, err := a.store.GetContestTeam(r.Context(), cid, u.ID)
	if err != nil || team.TeamID != teamID {
		writeError(w, http.StatusForbidden, "只有队长可以管理成员")
		return
	}
	if c.RegistrationMode == model.ContestRegistrationIndividual || !c.AllowTeamEdit {
		writeError(w, http.StatusBadRequest, "当前比赛不允许添加成员")
		return
	}
	if msg := contestRegWindowError(c, time.Now()); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	var req contestMemberPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	var member model.User
	if req.UserID != nil {
		member, err = a.store.GetUserByID(r.Context(), *req.UserID)
	} else if username := strings.TrimSpace(req.Username); username != "" {
		member, _, err = a.store.GetUserByUsername(r.Context(), username)
	} else {
		writeError(w, http.StatusBadRequest, "请填写用户名或用户 ID")
		return
	}
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err != nil {
		slogError(r, "查询参赛成员", err)
		writeError(w, http.StatusInternalServerError, "查询用户失败")
		return
	}
	if member.Disabled {
		writeError(w, http.StatusBadRequest, "该用户已被禁用")
		return
	}
	if member.ID == teamID {
		writeError(w, http.StatusBadRequest, "队长已经在队伍中")
		return
	}
	members, err := a.store.ListContestTeamMembers(r.Context(), cid, teamID)
	if err != nil {
		slogError(r, "统计队伍成员", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if c.MaxTeamSize > 0 && len(members) >= c.MaxTeamSize {
		writeError(w, http.StatusBadRequest, "队伍人数已达到上限")
		return
	}
	registered, err := a.store.IsContestTeam(r.Context(), cid, member.ID)
	if err != nil {
		slogError(r, "检查成员报名", err)
		writeError(w, http.StatusInternalServerError, "查询失败")
		return
	}
	if registered {
		writeError(w, http.StatusConflict, "该用户已经报名本场比赛")
		return
	}
	if err := a.store.AddContestTeamMember(r.Context(), cid, teamID, member.ID); err != nil {
		slogError(r, "添加比赛成员", err)
		writeError(w, http.StatusConflict, "添加成员失败，用户可能已加入其他队伍")
		return
	}
	writeJSON(w, http.StatusCreated, model.ContestTeamMember{
		ContestID: cid, TeamID: teamID, UserID: member.ID, Username: member.Username,
		IsCaptain: false,
	})
}

func (a *API) handleRemoveContestMember(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	cid, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的比赛 ID")
		return
	}
	teamID, err := parsePathID(r, "team_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的队伍 ID")
		return
	}
	memberID, err := parsePathID(r, "user_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的用户 ID")
		return
	}
	c, err := a.store.GetContest(r.Context(), cid)
	if err != nil {
		writeError(w, http.StatusNotFound, "比赛不存在")
		return
	}
	team, err := a.store.GetContestTeam(r.Context(), cid, u.ID)
	if err != nil || team.TeamID != teamID || !c.AllowTeamEdit {
		writeError(w, http.StatusForbidden, "只有队长可以管理成员")
		return
	}
	if msg := contestRegWindowError(c, time.Now()); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if err := a.store.RemoveContestTeamMember(r.Context(), cid, teamID, memberID); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusBadRequest, "队长不可移除或成员不存在")
			return
		}
		slogError(r, "移除比赛成员", err)
		writeError(w, http.StatusInternalServerError, "移除失败")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
