package api

import (
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/yunoj/yunoj/internal/auth"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

type userAdminPayload struct {
	Role     string `json:"role"`
	Disabled bool   `json:"disabled"`
	Password string `json:"password"`
}

type groupPayload struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

type groupMemberPayload struct {
	UserID int64  `json:"user_id"`
	Role   string `json:"role"`
}

type assignmentPayload struct {
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Kind        string     `json:"kind"`
	StartAt     time.Time  `json:"start_at"`
	DueAt       *time.Time `json:"due_at"`
	Published   bool       `json:"published"`
}

type assignmentProblemPayload struct {
	ProblemID int64 `json:"problem_id"`
	SortOrder int   `json:"sort_order"`
	MaxScore  int   `json:"max_score"`
}

func (a *API) requireStaffUser(r *http.Request) (model.User, bool) {
	u, ok := userFromCtx(r.Context())
	return u, ok && model.IsStaff(u.Role)
}

func (a *API) canManageGroup(r *http.Request, g model.Group) bool {
	u, ok := userFromCtx(r.Context())
	return ok && (u.Role == model.RoleAdmin || (u.Role == model.RoleTeacher && g.OwnerID == u.ID))
}

func (a *API) canAccessGroup(r *http.Request, g model.Group) bool {
	u, ok := userFromCtx(r.Context())
	if !ok {
		return false
	}
	if u.Role == model.RoleAdmin || g.OwnerID == u.ID {
		return true
	}
	member, err := a.store.IsGroupMember(r.Context(), g.ID, u.ID)
	return err == nil && member
}

func (a *API) canManageAssignment(r *http.Request, assignment model.Assignment) bool {
	g, err := a.store.GetGroup(r.Context(), assignment.GroupID)
	return err == nil && a.canManageGroup(r, g)
}

// handleHome 返回平台首页数据。
func (a *API) handleHome(w http.ResponseWriter, r *http.Request) {
	h, err := a.store.HomeSummary(r.Context())
	if err != nil {
		slogError(r, "首页概览", err)
		writeError(w, http.StatusInternalServerError, "加载首页失败")
		return
	}
	resp := map[string]any{"summary": h}
	if u, ok := userFromCtx(r.Context()); ok {
		groups, groupErr := a.store.ListGroups(r.Context(), u.ID, model.IsStaff(u.Role))
		if groupErr == nil {
			resp["groups"] = groups
		}
		if total, accepted, problems, contests, statsErr := a.store.GetUserSubmissionStats(r.Context(), u.ID); statsErr == nil {
			resp["my_stats"] = map[string]int64{
				"total_submissions": total, "accepted_submissions": accepted,
				"attempted_problems": problems, "contests": contests,
			}
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleAdminListUsers 返回后台用户列表。
func (a *API) handleAdminListUsers(w http.ResponseWriter, r *http.Request) {
	page := clamp(queryInt(r, "page", 1), 1, 1<<20)
	size := clamp(queryInt(r, "size", defaultPageSize), 1, maxPageSize)
	role := strings.TrimSpace(r.URL.Query().Get("role"))
	if role == "user" {
		role = model.RoleStudent
	}
	if role != "" && role != model.RoleAdmin && role != model.RoleTeacher && role != model.RoleStudent {
		writeError(w, http.StatusBadRequest, "无效的角色")
		return
	}
	items, total, err := a.store.ListUsers(r.Context(), store.AdminUserFilter{
		Keyword: strings.TrimSpace(r.URL.Query().Get("keyword")), Role: role, Page: page, Size: size,
	})
	if err != nil {
		slogError(r, "用户列表", err)
		writeError(w, http.StatusInternalServerError, "查询用户失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items, "total": total})
}

// handleAdminUpdateUser 更新角色、禁用状态或密码。
func (a *API) handleAdminUpdateUser(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的用户 ID")
		return
	}
	current, ok := userFromCtx(r.Context())
	if !ok {
		writeError(w, http.StatusUnauthorized, "未登录")
		return
	}
	var req userAdminPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	role := req.Role
	if role == "user" || role == "" {
		role = model.RoleStudent
	}
	if role != model.RoleAdmin && role != model.RoleTeacher && role != model.RoleStudent {
		writeError(w, http.StatusBadRequest, "角色只能是 admin、teacher 或 student")
		return
	}
	if id == current.ID && (req.Disabled || role != model.RoleAdmin) {
		writeError(w, http.StatusBadRequest, "不能禁用或降级当前管理员")
		return
	}
	if req.Password != "" {
		if utf8.RuneCountInString(req.Password) < 6 || utf8.RuneCountInString(req.Password) > 72 {
			writeError(w, http.StatusBadRequest, "密码长度需在 6-72 位之间")
			return
		}
	}
	var hash *string
	if req.Password != "" {
		h, hashErr := auth.HashPassword(req.Password)
		if hashErr != nil {
			writeError(w, http.StatusInternalServerError, "密码处理失败")
			return
		}
		hash = &h
	}
	if err := a.store.UpdateUserAdmin(r.Context(), id, role, req.Disabled, hash); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			writeError(w, http.StatusNotFound, "用户不存在")
			return
		}
		slogError(r, "更新用户", err)
		writeError(w, http.StatusInternalServerError, "更新用户失败")
		return
	}
	u, err := a.store.GetUserByID(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "读取用户失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

// handleListGroups 返回当前用户可见的班级/团体。
func (a *API) handleListGroups(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	items, err := a.store.ListGroups(r.Context(), u.ID, model.IsStaff(u.Role))
	if err != nil {
		slogError(r, "班级列表", err)
		writeError(w, http.StatusInternalServerError, "查询班级失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// handleCreateGroup 创建班级/团体。
func (a *API) handleCreateGroup(w http.ResponseWriter, r *http.Request) {
	u, ok := a.requireStaffUser(r)
	if !ok {
		writeError(w, http.StatusForbidden, "需要教师或管理员权限")
		return
	}
	var req groupPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" || utf8.RuneCountInString(req.Name) > 128 {
		writeError(w, http.StatusBadRequest, "班级名称长度需在 1-128 字符之间")
		return
	}
	if len(req.Description) > 16<<10 {
		writeError(w, http.StatusBadRequest, "班级说明过长")
		return
	}
	g := model.Group{Name: strings.TrimSpace(req.Name), Description: req.Description, OwnerID: u.ID}
	if err := a.store.CreateGroup(r.Context(), &g); err != nil {
		slogError(r, "创建班级", err)
		writeError(w, http.StatusInternalServerError, "创建班级失败")
		return
	}
	g.OwnerName = u.Username
	g.MemberCount = 1
	writeJSON(w, http.StatusCreated, g)
}

// handleGetGroup 返回班级详情、成员和作业。
func (a *API) handleGetGroup(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的班级 ID")
		return
	}
	g, err := a.store.GetGroup(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "班级不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询班级失败")
		return
	}
	if !a.canAccessGroup(r, g) {
		writeError(w, http.StatusForbidden, "你不属于该班级")
		return
	}
	members, err := a.store.ListGroupMembers(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询成员失败")
		return
	}
	includeDraft := a.canManageGroup(r, g)
	assignments, err := a.store.ListAssignments(r.Context(), id, includeDraft)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询作业失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"group": g, "members": members, "assignments": assignments, "can_manage": includeDraft})
}

// handleUpdateGroup 更新班级资料。
func (a *API) handleUpdateGroup(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的班级 ID")
		return
	}
	g, err := a.store.GetGroup(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusNotFound, "班级不存在")
		return
	}
	if !a.canManageGroup(r, g) {
		writeError(w, http.StatusForbidden, "没有管理该班级的权限")
		return
	}
	var req groupPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if strings.TrimSpace(req.Name) == "" || utf8.RuneCountInString(req.Name) > 128 {
		writeError(w, http.StatusBadRequest, "班级名称长度需在 1-128 字符之间")
		return
	}
	if err := a.store.UpdateGroup(r.Context(), id, strings.TrimSpace(req.Name), req.Description); err != nil {
		writeError(w, http.StatusInternalServerError, "更新班级失败")
		return
	}
	g, _ = a.store.GetGroup(r.Context(), id)
	writeJSON(w, http.StatusOK, g)
}

// handleAddGroupMember 加入或更新班级成员。
func (a *API) handleAddGroupMember(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的班级 ID")
		return
	}
	g, err := a.store.GetGroup(r.Context(), id)
	if err != nil || !a.canManageGroup(r, g) {
		writeError(w, http.StatusForbidden, "没有管理该班级的权限")
		return
	}
	var req groupMemberPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.UserID <= 0 || (req.Role != "student" && req.Role != "teacher") {
		writeError(w, http.StatusBadRequest, "成员 ID 或角色无效")
		return
	}
	if _, err := a.store.GetUserByID(r.Context(), req.UserID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "用户不存在")
		return
	}
	if err := a.store.AddGroupMember(r.Context(), id, req.UserID, req.Role); err != nil {
		writeError(w, http.StatusInternalServerError, "添加成员失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRemoveGroupMember 移除班级成员。
func (a *API) handleRemoveGroupMember(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的班级 ID")
		return
	}
	g, err := a.store.GetGroup(r.Context(), id)
	if err != nil || !a.canManageGroup(r, g) {
		writeError(w, http.StatusForbidden, "没有管理该班级的权限")
		return
	}
	memberID, err := parsePathID(r, "user_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的用户 ID")
		return
	}
	if err := a.store.RemoveGroupMember(r.Context(), id, memberID); err != nil {
		writeError(w, http.StatusNotFound, "成员不存在或不能移除负责人")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleCreateAssignment 创建作业/测试。
func (a *API) handleCreateAssignment(w http.ResponseWriter, r *http.Request) {
	groupID, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的班级 ID")
		return
	}
	g, err := a.store.GetGroup(r.Context(), groupID)
	if err != nil || !a.canManageGroup(r, g) {
		writeError(w, http.StatusForbidden, "没有管理该班级的权限")
		return
	}
	var req assignmentPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := store.ValidateAssignmentText(req.Title, req.Description, req.Kind); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if req.StartAt.IsZero() {
		req.StartAt = time.Now()
	}
	if req.DueAt != nil && !req.DueAt.After(req.StartAt) {
		writeError(w, http.StatusBadRequest, "截止时间必须晚于开始时间")
		return
	}
	u, _ := userFromCtx(r.Context())
	item := model.Assignment{GroupID: groupID, CreatorID: u.ID, Title: strings.TrimSpace(req.Title), Description: req.Description,
		Kind: req.Kind, StartAt: req.StartAt, DueAt: req.DueAt, Published: req.Published}
	if err := a.store.CreateAssignment(r.Context(), &item); err != nil {
		writeError(w, http.StatusInternalServerError, "创建作业失败")
		return
	}
	item.CreatorName = u.Username
	writeJSON(w, http.StatusCreated, item)
}

// handleGetAssignment 返回作业内容和可见范围内的完成情况。
func (a *API) handleGetAssignment(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的作业 ID")
		return
	}
	item, err := a.store.GetAssignment(r.Context(), id)
	if errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "作业不存在")
		return
	}
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询作业失败")
		return
	}
	g, err := a.store.GetGroup(r.Context(), item.GroupID)
	if err != nil || !a.canAccessGroup(r, g) || (!item.Published && !a.canManageGroup(r, g)) {
		writeError(w, http.StatusNotFound, "作业不存在")
		return
	}
	problems, err := a.store.ListAssignmentProblems(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询作业题目失败")
		return
	}
	resp := map[string]any{"assignment": item, "group": g, "problems": problems, "can_manage": a.canManageGroup(r, g)}
	if a.canManageGroup(r, g) {
		progress, progressErr := a.store.ListAssignmentProgress(r.Context(), id)
		if progressErr == nil {
			resp["progress"] = progress
		}
	}
	writeJSON(w, http.StatusOK, resp)
}

// handleUpdateAssignment 更新作业。
func (a *API) handleUpdateAssignment(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的作业 ID")
		return
	}
	item, err := a.store.GetAssignment(r.Context(), id)
	if err != nil || !a.canManageAssignment(r, item) {
		writeError(w, http.StatusForbidden, "没有管理该作业的权限")
		return
	}
	var req assignmentPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if msg := store.ValidateAssignmentText(req.Title, req.Description, req.Kind); msg != "" {
		writeError(w, http.StatusBadRequest, msg)
		return
	}
	if req.StartAt.IsZero() {
		writeError(w, http.StatusBadRequest, "请填写开始时间")
		return
	}
	if req.DueAt != nil && !req.DueAt.After(req.StartAt) {
		writeError(w, http.StatusBadRequest, "截止时间必须晚于开始时间")
		return
	}
	item.Title, item.Description, item.Kind, item.StartAt, item.DueAt, item.Published = strings.TrimSpace(req.Title), req.Description, req.Kind, req.StartAt, req.DueAt, req.Published
	if err := a.store.UpdateAssignment(r.Context(), &item); err != nil {
		writeError(w, http.StatusInternalServerError, "更新作业失败")
		return
	}
	writeJSON(w, http.StatusOK, item)
}

// handleAddAssignmentProblem 添加作业内题目。
func (a *API) handleAddAssignmentProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的作业 ID")
		return
	}
	item, err := a.store.GetAssignment(r.Context(), id)
	if err != nil || !a.canManageAssignment(r, item) {
		writeError(w, http.StatusForbidden, "没有管理该作业的权限")
		return
	}
	var req assignmentProblemPayload
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.ProblemID <= 0 || req.MaxScore < 0 || req.MaxScore > 100 {
		writeError(w, http.StatusBadRequest, "题目或分值无效")
		return
	}
	if _, err := a.store.GetProblem(r.Context(), req.ProblemID); errors.Is(err, store.ErrNotFound) {
		writeError(w, http.StatusNotFound, "题目不存在")
		return
	}
	if req.MaxScore == 0 {
		req.MaxScore = 100
	}
	if err := a.store.AddAssignmentProblem(r.Context(), id, req.ProblemID, req.SortOrder, req.MaxScore); err != nil {
		writeError(w, http.StatusInternalServerError, "添加作业题目失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// handleRemoveAssignmentProblem 移除作业内题目。
func (a *API) handleRemoveAssignmentProblem(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的作业 ID")
		return
	}
	item, err := a.store.GetAssignment(r.Context(), id)
	if err != nil || !a.canManageAssignment(r, item) {
		writeError(w, http.StatusForbidden, "没有管理该作业的权限")
		return
	}
	problemID, err := parsePathID(r, "problem_id")
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的题目 ID")
		return
	}
	if err := a.store.RemoveAssignmentProblem(r.Context(), id, problemID); err != nil {
		writeError(w, http.StatusNotFound, "作业题目不存在")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// handleAssignmentProgress 返回教师查看用的作业进度。
func (a *API) handleAssignmentProgress(w http.ResponseWriter, r *http.Request) {
	id, err := idParam(r)
	if err != nil {
		writeError(w, http.StatusBadRequest, "无效的作业 ID")
		return
	}
	item, err := a.store.GetAssignment(r.Context(), id)
	if err != nil || !a.canManageAssignment(r, item) {
		writeError(w, http.StatusForbidden, "没有查看作业进度的权限")
		return
	}
	items, err := a.store.ListAssignmentProgress(r.Context(), id)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "查询作业进度失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"items": items})
}

// parsePathID 解析带名称的路径参数。
func parsePathID(r *http.Request, name string) (int64, error) {
	return parseInt64(chi.URLParam(r, name))
}

func parseInt64(value string) (int64, error) {
	var n int64
	if value == "" {
		return 0, fmt.Errorf("empty id")
	}
	for _, r := range value {
		if r < '0' || r > '9' {
			return 0, fmt.Errorf("invalid id")
		}
		n = n*10 + int64(r-'0')
		if n < 0 {
			return 0, fmt.Errorf("overflow")
		}
	}
	return n, nil
}
