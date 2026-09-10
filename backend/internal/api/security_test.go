package api

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/yunoj/yunoj/internal/config"
)

func TestCORSAllowsConfiguredOrigin(t *testing.T) {
	a := &API{cfg: config.Config{CORSAllowedOrigins: []string{"https://oj.example.edu"}}}
	handler := a.securityHeaders(a.cors(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})))
	req := httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	req.Header.Set("Origin", "https://oj.example.edu")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d", res.Code)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "https://oj.example.edu" {
		t.Fatalf("unexpected allow origin %q", got)
	}
	if got := res.Header().Get("X-Frame-Options"); got != "DENY" {
		t.Fatalf("missing security header: %q", got)
	}
}

func TestCORSRejectsUnknownPreflightOrigin(t *testing.T) {
	a := &API{cfg: config.Config{CORSAllowedOrigins: []string{"https://oj.example.edu"}}}
	handler := a.cors(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	req := httptest.NewRequest(http.MethodOptions, "/api/health", nil)
	req.Header.Set("Origin", "https://attacker.example")
	res := httptest.NewRecorder()
	handler.ServeHTTP(res, req)

	if res.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", res.Code)
	}
	if got := res.Header().Get("Access-Control-Allow-Origin"); got != "" {
		t.Fatalf("unexpected allow origin %q", got)
	}
}

func TestDecodeJSONRejectsTrailingValue(t *testing.T) {
	var dst struct {
		Name string `json:"name"`
	}
	req := httptest.NewRequest(http.MethodPost, "/", strings.NewReader(`{"name":"first"}{"name":"second"}`))
	res := httptest.NewRecorder()
	if decodeJSON(res, req, &dst) {
		t.Fatal("expected trailing JSON value to be rejected")
	}
	if res.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", res.Code)
	}
}

func TestClientIPOnlyTrustsProxyWhenConfigured(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.RemoteAddr = "192.0.2.10:1234"
	req.Header.Set("X-Forwarded-For", "198.51.100.20")

	if got := (&API{}).clientIP(req); got != "192.0.2.10" {
		t.Fatalf("untrusted proxy header used: %q", got)
	}
	if got := (&API{cfg: config.Config{TrustProxy: true}}).clientIP(req); got != "198.51.100.20" {
		t.Fatalf("trusted proxy header ignored: %q", got)
	}
}
