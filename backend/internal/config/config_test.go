package config

import "testing"

func TestValidateServerRejectsWeakProductionSecret(t *testing.T) {
	cfg := Config{Environment: "production", JWTSecret: "dev-secret-change-me"}
	if err := cfg.ValidateServer(); err == nil {
		t.Fatal("expected weak production JWT secret to be rejected")
	}
}

func TestValidateServerRejectsWildcardProductionCORS(t *testing.T) {
	cfg := Config{
		Environment:        "production",
		JWTSecret:          "0123456789abcdef0123456789abcdef",
		CORSAllowedOrigins: []string{"*"},
	}
	if err := cfg.ValidateServer(); err == nil {
		t.Fatal("expected wildcard production CORS to be rejected")
	}
}

func TestValidateServerAllowsStrongProductionConfig(t *testing.T) {
	cfg := Config{
		Environment:        "production",
		JWTSecret:          "0123456789abcdef0123456789abcdef",
		CORSAllowedOrigins: []string{"https://oj.example.edu"},
	}
	if err := cfg.ValidateServer(); err != nil {
		t.Fatalf("expected valid production config: %v", err)
	}
}
