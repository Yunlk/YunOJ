package auth

import (
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

func TestSignAndParseToken(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	token, err := SignToken(secret, 42, "user", time.Hour)
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	id, role, err := ParseToken(secret, token)
	if err != nil || id != 42 || role != "user" {
		t.Fatalf("unexpected parsed token: id=%d role=%q err=%v", id, role, err)
	}
}

func TestCheckPasswordUsesDummyHashForMissingUser(t *testing.T) {
	if CheckPassword("", "anything") {
		t.Fatal("missing-user dummy hash must never authenticate")
	}
}

func TestParseTokenRejectsOtherHMACMethod(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	claims := Claims{
		Role: "user",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "42",
			Issuer:    "yunoj",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS512, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign alternate token: %v", err)
	}
	if _, _, err := ParseToken(secret, token); err == nil {
		t.Fatal("expected HS512 token to be rejected")
	}
}

func TestParseTokenRequiresExpiration(t *testing.T) {
	const secret = "0123456789abcdef0123456789abcdef"
	claims := Claims{
		Role: "user",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:  "42",
			Issuer:   "yunoj",
			IssuedAt: jwt.NewNumericDate(time.Now()),
		},
	}
	token, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
	if err != nil {
		t.Fatalf("sign token without expiration: %v", err)
	}
	if _, _, err := ParseToken(secret, token); err == nil {
		t.Fatal("expected token without expiration to be rejected")
	}
}
