// Package auth 提供密码哈希与 JWT 签发/校验。
package auth

import (
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

// HashPassword 生成 bcrypt 密码哈希（默认成本 10）。
func HashPassword(password string) (string, error) {
	b, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	return string(b), err
}

// CheckPassword 校验明文密码与哈希是否匹配。
func CheckPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

// Claims JWT 载荷。
type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// SignToken 签发 HS256 令牌，Subject 为用户 ID。
func SignToken(secret string, userID int64, role string, ttl time.Duration) (string, error) {
	claims := Claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   strconv.FormatInt(userID, 10),
			Issuer:    "yunoj",
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(ttl)),
		},
	}
	return jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(secret))
}

// ErrInvalidToken 令牌无效或已过期。
var ErrInvalidToken = errors.New("invalid token")

// ParseToken 校验并解析令牌，返回用户 ID 与角色。
func ParseToken(secret, tokenString string) (int64, string, error) {
	tok, err := jwt.ParseWithClaims(tokenString, &Claims{}, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return []byte(secret), nil
	})
	if err != nil || !tok.Valid {
		return 0, "", ErrInvalidToken
	}
	claims, ok := tok.Claims.(*Claims)
	if !ok {
		return 0, "", ErrInvalidToken
	}
	id, err := strconv.ParseInt(claims.Subject, 10, 64)
	if err != nil || id <= 0 {
		return 0, "", ErrInvalidToken
	}
	return id, claims.Role, nil
}
