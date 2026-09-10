package api

import (
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/mail"
	"regexp"
	"strings"
	"time"
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

type changePasswordRequest struct {
	CurrentPassword string `json:"current_password"`
	NewPassword     string `json:"new_password"`
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
	if !a.allowAuthAttempt(w, r, "register", username, 30, 10*time.Minute, 6) {
		return
	}

	hash, err := auth.HashPassword(req.Password)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "注册失败")
		return
	}

	u, err := a.store.CreateRegisteredUser(r.Context(), username, email, hash)
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
	username := strings.TrimSpace(req.Username)
	if !a.allowAuthAttempt(w, r, "login", username, 60, 5*time.Minute, 12) {
		return
	}
	u, hash, err := a.store.GetUserByUsername(r.Context(), username)
	if err != nil && !errors.Is(err, store.ErrNotFound) {
		slogError(r, "登录", err)
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	if err != nil || !auth.CheckPassword(hash, req.Password) {
		writeError(w, http.StatusUnauthorized, "用户名或密码错误")
		return
	}
	if u.Disabled {
		writeError(w, http.StatusForbidden, "账号已被禁用，请联系管理员")
		return
	}
	a.issueToken(w, r, u, http.StatusOK)
}

// handleMe 返回当前登录用户信息。
func (a *API) handleMe(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	u = a.decorateUserRanking(r, u)
	writeJSON(w, http.StatusOK, map[string]any{"user": u})
}

// handleChangePassword 修改当前用户密码。
func (a *API) handleChangePassword(w http.ResponseWriter, r *http.Request) {
	u, _ := userFromCtx(r.Context())
	var req changePasswordRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if utf8.RuneCountInString(req.NewPassword) < 6 || utf8.RuneCountInString(req.NewPassword) > 72 {
		writeError(w, http.StatusBadRequest, "新密码长度需在 6-72 位之间")
		return
	}
	if !a.allowAuthAttempt(w, r, "change-password", u.Username, 30, 10*time.Minute, 10) {
		return
	}
	_, hash, err := a.store.GetUserByUsername(r.Context(), u.Username)
	if err != nil || !auth.CheckPassword(hash, req.CurrentPassword) {
		writeError(w, http.StatusUnauthorized, "当前密码不正确")
		return
	}
	newHash, err := auth.HashPassword(req.NewPassword)
	if err != nil {
		writeError(w, http.StatusInternalServerError, "密码处理失败")
		return
	}
	if err := a.store.UpdateUserPassword(r.Context(), u.ID, newHash); err != nil {
		writeError(w, http.StatusInternalServerError, "修改密码失败")
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true})
}

// issueToken 签发令牌并返回 {token, user}。
func (a *API) issueToken(w http.ResponseWriter, r *http.Request, u model.User, status int) {
	token, err := auth.SignToken(a.cfg.JWTSecret, u.ID, u.Role, a.cfg.TokenTTL)
	if err != nil {
		slogError(r, "签发令牌", err)
		writeError(w, http.StatusInternalServerError, "登录失败")
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, status, map[string]any{"token": token, "user": a.decorateUserRanking(r, u)})
}

// allowAuthAttempt 同时限制单一来源的总请求量与来源+账号组合的请求量。
// 键只保存摘要，避免在 Redis 中留下用户名或 IP 明文。
func (a *API) allowAuthAttempt(w http.ResponseWriter, r *http.Request, action, identity string,
	sourceLimit int64, window time.Duration, identityLimit int64,
) bool {
	source := a.clientIP(r)
	keys := []struct {
		value string
		limit int64
	}{
		{value: action + ":source:" + source, limit: sourceLimit},
		{value: action + ":identity:" + source + ":" + strings.ToLower(identity), limit: identityLimit},
	}
	for _, item := range keys {
		sum := sha256.Sum256([]byte(item.value))
		key := "oj:ratelimit:auth:" + hex.EncodeToString(sum[:16])
		allowed, err := a.queue.AllowRate(r.Context(), key, item.limit, window)
		if err != nil {
			slogError(r, "认证限流", err)
			writeError(w, http.StatusServiceUnavailable, "认证服务暂不可用，请稍后重试")
			return false
		}
		if !allowed {
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(window.Seconds())))
			writeError(w, http.StatusTooManyRequests, "请求过于频繁，请稍后再试")
			return false
		}
	}
	return true
}
