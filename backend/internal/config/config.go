// Package config 从环境变量加载配置，全部带本地开发默认值。
package config

import (
	"fmt"
	"os"
	"regexp"
	"strconv"
	"strings"
	"time"
)

var invalidNodeIDChars = regexp.MustCompile(`[^a-zA-Z0-9._-]+`)

// Config 全局配置。所有字段均可通过环境变量覆盖，便于容器化部署。
type Config struct {
	// Environment 运行环境（APP_ENV），production 会启用严格配置校验。
	Environment string
	// Addr HTTP 监听地址（SERVER_ADDR）
	Addr string
	// DatabaseURL PostgreSQL 连接串（DATABASE_URL）
	DatabaseURL string
	// RedisAddr Redis 地址（REDIS_ADDR）
	RedisAddr string
	// JWTSecret 登录令牌签名密钥（JWT_SECRET）
	JWTSecret string
	// CORSAllowedOrigins 允许直接跨域访问 API 的来源列表。
	CORSAllowedOrigins []string
	// TrustProxy 是否信任反向代理写入的客户端来源地址。
	TrustProxy bool
	// DataDir 题目测试数据等共享数据目录（DATA_DIR），web 与 judge 挂载同一目录
	DataDir string
	// LanguageConfigPath 自定义语言配置（LANGUAGE_CONFIG），web 与 judge 必须读取同一份。
	LanguageConfigPath string
	// JudgeWorkers 评测 worker 数量（JUDGE_WORKERS），每个 worker 独占一个沙箱
	JudgeWorkers int
	// JudgeNodeID 是集群内稳定且唯一的节点标识（JUDGE_NODE_ID）。
	JudgeNodeID string
	// JudgeNodeName 是后台展示名（JUDGE_NODE_NAME）。
	JudgeNodeName string
	// JudgeVersion 是节点版本标识（JUDGE_VERSION）。
	JudgeVersion string
	// IsolatePath isolate 可执行文件路径（ISOLATE_PATH）
	IsolatePath string
	// IsolateDir isolate 沙箱根目录（ISOLATE_DIR）
	IsolateDir string
	// IsolateCG 是否启用 cgroup 精确资源计量（ISOLATE_CG）。
	// 需要宿主环境允许向子 cgroup 委派 memory/cpu 控制器（裸 Linux 服务器可开）；
	// Docker Desktop/WSL2 等环境不支持委派，须保持关闭（isolate 自动退回
	// rlimit 限制 + max-rss 计量）。
	IsolateCG bool
	// TokenTTL 登录令牌有效期
	TokenTTL time.Duration
}

// Load 读取环境变量并返回配置。
func Load() Config {
	nodeID := getEnv("JUDGE_NODE_ID", defaultNodeID())
	return Config{
		Environment:        getEnv("APP_ENV", "development"),
		Addr:               getEnv("SERVER_ADDR", ":8080"),
		DatabaseURL:        getEnv("DATABASE_URL", "postgres://yunoj:yunoj@localhost:5432/yunoj?sslmode=disable"),
		RedisAddr:          getEnv("REDIS_ADDR", "localhost:6379"),
		JWTSecret:          getEnv("JWT_SECRET", "dev-secret-change-me"),
		CORSAllowedOrigins: getEnvList("CORS_ALLOWED_ORIGINS", "http://127.0.0.1:5173,http://localhost:5173"),
		TrustProxy:         getEnvBool("TRUST_PROXY", false),
		DataDir:            getEnv("DATA_DIR", "../data"),
		LanguageConfigPath: getEnv("LANGUAGE_CONFIG", "../config/languages.json"),
		JudgeWorkers:       getEnvInt("JUDGE_WORKERS", 2),
		JudgeNodeID:        nodeID,
		JudgeNodeName:      getEnv("JUDGE_NODE_NAME", nodeID),
		JudgeVersion:       getEnv("JUDGE_VERSION", "dev"),
		IsolatePath:        getEnv("ISOLATE_PATH", "isolate"),
		IsolateDir:         getEnv("ISOLATE_DIR", "/var/local/lib/isolate"),
		IsolateCG:          getEnvBool("ISOLATE_CG", false),
		TokenTTL:           7 * 24 * time.Hour,
	}
}

// ValidateServer 拒绝会让生产服务处于已知不安全状态的配置。
func (c Config) ValidateServer() error {
	if !strings.EqualFold(strings.TrimSpace(c.Environment), "production") {
		return nil
	}
	if len(c.JWTSecret) < 32 || c.JWTSecret == "dev-secret-change-me" {
		return fmt.Errorf("production requires JWT_SECRET with at least 32 characters")
	}
	for _, origin := range c.CORSAllowedOrigins {
		if origin == "*" {
			return fmt.Errorf("production does not allow wildcard CORS origin")
		}
	}
	return nil
}

func defaultNodeID() string {
	hostname, _ := os.Hostname()
	nodeID := strings.Trim(invalidNodeIDChars.ReplaceAllString(hostname, "-"), "-.")
	if nodeID == "" {
		return "judge-node"
	}
	return nodeID
}

func getEnv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getEnvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil || n < 1 {
		return def
	}
	return n
}

func getEnvList(key, def string) []string {
	raw := getEnv(key, def)
	items := make([]string, 0)
	for _, item := range strings.Split(raw, ",") {
		if item = strings.TrimSpace(item); item != "" {
			items = append(items, strings.TrimRight(item, "/"))
		}
	}
	return items
}

// getEnvBool 解析布尔环境变量（true/1 为真，其余为假）。
func getEnvBool(key string, def bool) bool {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	return v == "true" || v == "1" || v == "yes"
}
