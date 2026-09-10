package api

import (
	"context"
	"log/slog"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/yunoj/yunoj/internal/auth"
	"github.com/yunoj/yunoj/internal/model"
)

type ctxKey int

const ctxUserKey ctxKey = iota

// securityHeaders 为 API 与公开文件响应设置不依赖页面内容的安全头。
func (a *API) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
		w.Header().Set("Permissions-Policy", "camera=(), microphone=(), geolocation=()")
		next.ServeHTTP(w, r)
	})
}

// cors 仅向配置白名单内的来源开放直接跨域 API 访问。
// 同源前端经反向代理访问时不依赖这些响应头。
func (a *API) cors(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		origin := strings.TrimRight(strings.TrimSpace(r.Header.Get("Origin")), "/")
		allowed := origin == ""
		for _, candidate := range a.cfg.CORSAllowedOrigins {
			if origin == candidate {
				allowed = true
				break
			}
		}
		if origin != "" {
			w.Header().Add("Vary", "Origin")
		}
		if allowed && origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
			w.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
			w.Header().Set("Access-Control-Max-Age", "600")
		}
		if r.Method == http.MethodOptions {
			if !allowed {
				writeError(w, http.StatusForbidden, "不允许的跨域来源")
				return
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// clientIP 返回用于安全审计与限流的客户端地址。只有显式信任反向代理时
// 才读取代理头，避免直连部署被伪造的 X-Forwarded-For 绕过。
func (a *API) clientIP(r *http.Request) string {
	if a.cfg.TrustProxy {
		if raw := strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-For"), ",")[0]); net.ParseIP(raw) != nil {
			return raw
		}
		if raw := strings.TrimSpace(r.Header.Get("X-Real-IP")); net.ParseIP(raw) != nil {
			return raw
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err == nil && net.ParseIP(host) != nil {
		return host
	}
	if net.ParseIP(r.RemoteAddr) != nil {
		return r.RemoteAddr
	}
	return "unknown"
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
		if u.Disabled {
			writeError(w, http.StatusForbidden, "账号已被禁用，请联系管理员")
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
				if u, err := a.store.GetUserByID(r.Context(), userID); err == nil && !u.Disabled {
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

// requireStaff 要求教师或管理员角色。
func (a *API) requireStaff(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		u, ok := userFromCtx(r.Context())
		if !ok || !model.IsStaff(u.Role) {
			writeError(w, http.StatusForbidden, "需要教师或管理员权限")
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
