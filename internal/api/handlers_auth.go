package api

import (
	"errors"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/yunoj/yunoj/internal/auth"
	"github.com/yunoj/yunoj/internal/model"
	"github.com/yunoj/yunoj/internal/store"
)

var usernamePattern = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)

type credentialsRequest struct {
	Username string `json:"username"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

// handleRegister 注册（注册即登录）。第一个注册的用户自动成为管理员。
func (a *API) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	username := strings.TrimSpace(req.Username)
	email := strings.TrimSpace(req.Email)

	if !usernamePattern.MatchString(username) {
		writeError(w, http.StatusBadRequest, "用户名需为 3-20 位字母、数字或下划线")
		return
	}
	if addr, err := mail.ParseAddress(email); err != nil || addr.Address != email {
		writeError(w, http.StatusBadRequest, "邮箱格式不正确")
		return
	}
	if len(req.Password) < 6 || utf8.RuneCountInString(req.Password) > 72 {
		writeError(w, http.StatusBadRequest, "密码长度需在 6-72 位之间")
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "注册失败")
		return
	}

	role := model.RoleUser
	if n, err := a.store.CountUsers(r.Context()); err == nil && n == 0 {
		role = model.RoleAdmin
	}
	u, err := a.store.CreateUser(r.Context(), username, email, hash, role)
	if errors.Is(err, store.ErrConflict) {
		writeError(w, http.StatusConflict, "用户名或邮箱已被使用")
		return
	}
	if err != nil {
		slogError(r, "注册", err)
		writeError(w, http.StatusInternalServerError, "注册失败")
		return
	}
	a.issueToken(w, r, u, http.StatusCreated)
}

// handleLogin 用户名 + 密码登录。
func (a *API) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req credentialsRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	u, hash, err := a.store.GetUserByUsername(r.Context(), strings.TrimSpace(req.Username))
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		slogError(r, "登录", err)
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	a.issueToken(w, r, u, http.StatusOK)
}

// handleMe 返回当前登录用户信息。
func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

// issueToken 签发令牌并返回 {token, user}。
func (a *API) issueToken(w http.ResponseWriter, r *http.Request, u model.User, status int) {
	token, err := auth.SignToken(a.cfg.JWTSecret, u.ID, u.Role, a.cfg.TokenTTL)
	if err != nil {
		slogError(r, "签发令牌", err)
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	writeJSON(w, status, map[string]any{"token": token, "user": u})
}
