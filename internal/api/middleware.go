package api

import (
	"context"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/yunoj/yunoj/internal/auth"
	"github.com/yunoj/yunoj/internal/model"
)

type ctxKey int

const ctxUserKey ctxKey = iota

// cors 跨域中间件。前后端同源部署时无副作用；本地前后端分离开发需要。
func (a *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Access-Control-Allow-Origin", "*")
		w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
		w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
		if r.Method == http.MethodOptions {
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// statusWriter 记录响应状态码供日志使用。
type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// requestLog 请求日志中间件。
func (a *API) requestLog(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		next.ServeHTTP(sw, r)
		slog.Info("http",
			"method", r.Method,
			"path", r.URL.Path,
			"status", sw.status,
			"dur", time.Since(start).String(),
		)
	})
}

// recoverer 兜底捕获 panic，避免单个请求拖垮进程。
func (a *API) recoverer(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		defer func() {
			if rec := recover(); rec != nil {
				slog.Error("请求 panic", "path", r.URL.Path, "err", rec)
				writeError(w, http.StatusInternalServerError, "服务器内部错误")
			}
		}()
		next.ServeHTTP(w, r)
	})
}

// requireAuth 校验 Bearer 令牌并把用户放入请求上下文。
// 每次请求都从数据库重新加载用户，保证角色变更/删除立即生效。
func (a *API) requireAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		token, ok := bearerToken(r)
		if !ok {
			writeError(w, http.StatusUnauthorized, "未登录")
			return
		}
		userID, _, err := auth.ParseToken(a.cfg.JWTSecret, token)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "登录已过期，请重新登录")
			return
		}
		u, err := a.store.GetUserByID(r.Context(), userID)
		if err != nil {
			writeError(w, http.StatusUnauthorized, "用户不存在")
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxUserKey, u)))
	})
}

// optionalAuth 尝试解析 Bearer 令牌：有效则注入用户，缺失/无效则以匿名身份继续。
// 用于「匿名可访问，但登录后可见更多内容」的接口（如提交详情）。
func (a *API) optionalAuth(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if token, ok := bearerToken(r); ok {
			if userID, _, err := auth.ParseToken(a.cfg.JWTSecret, token); err == nil {
				if u, err := a.store.GetUserByID(r.Context(), userID); err == nil {
					next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), ctxUserKey, u)))
					return
				}
			}
		}
		next.ServeHTTP(w, r)
	})
}

// requireAdmin 要求管理员角色（需配合 requireAuth 使用）。
func (a *API) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromCtx(r.Context())
		if !ok || u.Role != model.RoleAdmin {
			writeError(w, http.StatusForbidden, "需要管理员权限")
			return
		}
		next.ServeHTTP(w, r)
	})
}

// bearerToken 从 Authorization 头提取令牌。
func bearerToken(r *http.Request) (string, bool) {
	h := r.Header.Get("Authorization")
	if !strings.HasPrefix(h, "Bearer ") {
		return "", false
	}
	t := strings.TrimSpace(strings.TrimPrefix(h, "Bearer "))
	return t, t != ""
}

// userFromCtx 从上下文取出当前登录用户。
func userFromCtx(ctx context.Context) (model.User, bool) {
	u, ok := ctx.Value(ctxUserKey).(model.User)
	return u, ok
}
