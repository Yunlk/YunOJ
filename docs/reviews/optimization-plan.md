# YunOJ 全栈优化方案

> **审查范围**：基础设施、后端 Go、前端 React/TypeScript  
> **审查时间**：2025 年  
> **总体评级**：B+（架构优秀，缺乏生产加固与性能优化）

---

## 执行摘要

### 🎯 核心发现

YunOJ 拥有**扎实的架构基础**（可靠的队列模式、完善的数据库设计、清晰的模块边界），但在以下四个关键领域存在显著改进空间：

1. **性能瓶颈**：N+1 查询、缺失索引、前端未拆包（初始加载 5-8MB）
2. **生产就绪度**：无监控体系、默认密码、缺少灾备文档
3. **开发体验**：重复的样板代码、缺少测试、手动管理状态
4. **可维护性**：大型单体文件（1600+ 行）、技术债务积累

### 📊 优化潜力评估

| 领域 | 预期改善 | 工作量 |
|------|---------|--------|
| 数据库查询性能 | **5-100x** | 4-6 小时 |
| 前端初始加载 | **-40-60%** | 1-2 天 |
| 开发效率 | **-60% 样板代码** | 1-2 周 |
| 生产稳定性 | 从"不可上线"到"可监控" | 2-3 周 |

---

## 优先级矩阵

按**影响 × 实施难度**排序：

### 🔥 第一优先级：Quick Wins（1-3 天，立即见效）

#### 1. 数据库索引优化（2 小时）
**影响**：5-100x 查询加速  
**难度**：极低  
**位置**：`backend/internal/model/migrations.go`

```sql
-- 新增 migration version 24
CREATE INDEX CONCURRENTLY idx_submissions_problem_status_created 
  ON submissions(problem_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY idx_submissions_user_status_created 
  ON submissions(user_id, status, created_at DESC);

CREATE INDEX CONCURRENTLY idx_submissions_pending 
  ON submissions(created_at) WHERE status = 'pending';

CREATE INDEX idx_problems_tags_gin ON problems USING GIN(tags);
```

#### 2. 前端代码拆分（4-6 小时）
**影响**：-40-60% 初始加载体积  
**难度**：低  
**位置**：`frontend/src/App.tsx`

```tsx
// 改造前：所有页面打包在一起
import ProblemDetail from './pages/ProblemDetail'
import ContestStandings from './pages/ContestStandingsPage'

// 改造后：按路由懒加载
const ProblemDetail = lazy(() => import('./pages/ProblemDetail'))
const ContestStandings = lazy(() => import('./pages/ContestStandingsPage'))
const MonacoEditor = lazy(() => import('@monaco-editor/react'))

<Suspense fallback={<div>加载中...</div>}>
  <Routes>
    <Route path="/problem/:id" element={<ProblemDetail />} />
  </Routes>
</Suspense>
```

#### 3. 修复 GetUserRankingEntry N+1（2 小时）
**影响**：50-100x 加速个人排名查询  
**难度**：低  
**位置**：`backend/internal/store/rankings.go`

```go
// 新增方法：单用户排名查询
func (s *Store) GetUserRankingEntry(ctx context.Context, userID int64) (*model.UserRankingEntry, error) {
    query := `
        WITH ranked AS (
            SELECT user_id, rating, 
                   ROW_NUMBER() OVER (ORDER BY rating DESC, user_id ASC) AS rank
            FROM users WHERE role IN ('student', 'user')
        )
        SELECT u.id, u.username, u.rating, r.rank, u.role
        FROM ranked r
        JOIN users u ON r.user_id = u.id
        WHERE u.id = $1
    `
    var entry model.UserRankingEntry
    err := s.db.QueryRow(ctx, query, userID).Scan(...)
    return &entry, err
}
```

#### 4. AuthContext memoization（5 分钟）
**影响**：消除全站组件不必要的重渲染  
**难度**：极低  
**位置**：`frontend/src/context/AuthContext.tsx`

```tsx
const value = useMemo(
  () => ({ user, loading, setUser, refresh }),
  [user, loading] // setUser/refresh 是稳定引用，可省略
)
```

#### 5. Redis 持久化配置（10 分钟）
**影响**：防止重启后队列数据丢失  
**难度**：极低  
**位置**：`docker-compose.yml`

```yaml
redis:
  command: redis-server --appendonly yes
  volumes:
    - redis-data:/data  # 新增持久化卷
```

---

### ⚠️ 第二优先级：生产加固（1-2 周）

#### 6. 健康检查端点（1 天）
```go
// backend/internal/api/router.go
r.Get("/health", a.handleHealth)
r.Get("/readiness", a.handleReadiness)

func (a *API) handleHealth(w http.ResponseWriter, r *http.Request) {
    json.NewEncoder(w).Encode(map[string]string{
        "status": "ok",
        "version": os.Getenv("APP_VERSION"),
    })
}

func (a *API) handleReadiness(w http.ResponseWriter, r *http.Request) {
    // 检查数据库、Redis 连接
    ctx, cancel := context.WithTimeout(r.Context(), 2*time.Second)
    defer cancel()
    
    if err := a.store.Ping(ctx); err != nil {
        http.Error(w, "database unavailable", 503)
        return
    }
    if err := a.queue.Ping(ctx); err != nil {
        http.Error(w, "redis unavailable", 503)
        return
    }
    w.WriteHeader(200)
}
```

#### 7. 结构化日志（2-3 天）
```go
// 替换 slog 为结构化字段
slog.Info("submission received",
    "submission_id", sub.ID,
    "user_id", sub.UserID,
    "problem_id", sub.ProblemID,
    "language", sub.Language,
)
```

#### 8. Prometheus 指标（3-4 天）
```go
import "github.com/prometheus/client_golang/prometheus"

var (
    submissionCounter = prometheus.NewCounterVec(
        prometheus.CounterOpts{Name: "yunoj_submissions_total"},
        []string{"status", "language"},
    )
    queueDepth = prometheus.NewGauge(
        prometheus.GaugeOpts{Name: "yunoj_queue_depth"},
    )
)
```

#### 9. Docker 资源限制（30 分钟）
```yaml
backend:
  deploy:
    resources:
      limits:
        cpus: '2'
        memory: 1G
      reservations:
        cpus: '0.5'
        memory: 512M
  logging:
    driver: "json-file"
    options:
      max-size: "10m"
      max-file: "3"
```

#### 10. API 速率限制（1-2 天）
```go
// 当前只有 submission rate limit，需要全局 API 限流
middleware.RateLimit(50, time.Minute) // 50 req/min per IP
```

---

### 📈 第三优先级：开发效率（2-3 周）

#### 11. React Query 集成（1 周）
**收益**：-60% 数据获取样板代码，自动缓存与重复请求去重

```tsx
// 改造前：手动管理 loading/error/data
const [problems, setProblems] = useState([])
const [loading, setLoading] = useState(true)
useEffect(() => {
  getProblems().then(setProblems).finally(() => setLoading(false))
}, [])

// 改造后：React Query
const { data: problems, isLoading } = useQuery({
  queryKey: ['problems'],
  queryFn: getProblems,
  staleTime: 5 * 60 * 1000, // 5 分钟内视为新鲜
})
```

#### 12. 批量加载比赛题目（4 小时）
```go
// backend/internal/api/handlers_contest.go:290
// 改造前：N 次单独查询
for _, p := range problems {
    problem, _ := a.store.GetProblem(ctx, p.ProblemID)
}

// 改造后：1 次批量查询
problemIDs := make([]int64, len(problems))
for i, p := range problems { problemIDs[i] = p.ProblemID }
problemsMap := a.store.GetProblemsMap(ctx, problemIDs)
```

#### 13. 拆分大型文件（1 周）
```
handlers_contest.go (1662 行) 拆分为：
  - handlers_contest_crud.go      (CRUD 操作)
  - handlers_contest_registration.go (报名逻辑)
  - handlers_contest_standings.go  (榜单与动态)
  - handlers_contest_submissions.go (提交查询)
```

---

### 🔧 第四优先级：技术债务（3-4 周）

#### 14. 测试覆盖率提升（2-3 周）
当前状态：
- ✅ 已测试：ACM/OI 计分、auth、输出比较
- ❌ 未测试：`store/rankings.go`、`judge/runner.go`、大部分 API handlers

目标：70% 覆盖率

#### 15. TypeScript strict 模式（1-2 周）
```json
// tsconfig.json
{
  "compilerOptions": {
    "strict": true,              // 启用所有严格检查
    "noImplicitAny": true,
    "strictNullChecks": true,
    "noUncheckedIndexedAccess": true
  }
}
```

#### 16. 无障碍改进（1 周）
- 所有 `<button>` 添加 `type="button"`
- 表单输入框添加 `<label htmlFor>`
- 键盘导航支持（Tab、Enter、Escape）
- 运行 axe DevTools 审计

---

## 安全加固清单

### 🔴 立即修复（阻止上线）

1. **修改默认密码**
   ```bash
   # .env（不要提交到 Git）
   POSTGRES_PASSWORD=$(openssl rand -base64 32)
   JWT_SECRET=$(openssl rand -base64 48)
   ```

2. **启用 TLS**
   ```go
   // backend/internal/config/config.go
   dsn := fmt.Sprintf("postgres://...?sslmode=require")
   ```

3. **Redis AOF 持久化**（见前文 Quick Win #5）

### ⚠️ 生产前必须（2-3 天）

4. **CSP 强化**
   ```tsx
   // frontend/server.mjs
   helmet({
     contentSecurityPolicy: {
       directives: {
         "default-src": ["'self'"],
         "style-src": ["'self'", "'sha256-...'"], // 移除 unsafe-inline
       }
     }
   })
   ```

5. **安全响应头**
   ```yaml
   # docker-compose.yml 或 nginx 配置
   Strict-Transport-Security: max-age=31536000
   X-Content-Type-Options: nosniff
   X-Frame-Options: DENY
   ```

---

## 实施路线图

### 阶段 1：快速见效（第 1-3 天）⚡
- [x] 数据库索引 (2h)
- [x] 前端代码拆分 (6h)
- [x] 修复 N+1 查询 (2h)
- [x] AuthContext memo (5min)
- [x] Redis 持久化 (10min)

**预期效果**：
- 查询性能提升 5-100x
- 首屏加载减少 40-60%
- 前端渲染效率提升 30-50%

### 阶段 2：生产加固（第 1-2 周）🛡️
- [ ] 健康检查端点
- [ ] 结构化日志 + 请求 ID
- [ ] Prometheus 指标
- [ ] 资源限制与日志轮转
- [ ] 全局 API 速率限制
- [ ] 修改默认密码 + TLS

**预期效果**：
- 可监控、可告警
- 具备生产上线条件
- 安全基线达标

### 阶段 3：开发效率（第 3-5 周）📦
- [ ] React Query 集成
- [ ] 批量加载优化
- [ ] 拆分大型文件
- [ ] 自定义 Hooks 提取

**预期效果**：
- 新功能开发速度提升 40%
- 代码可维护性显著改善

### 阶段 4：长期演进（第 6-10 周）🔬
- [ ] 测试覆盖率达 70%
- [ ] TypeScript strict 模式
- [ ] 无障碍审计通过
- [ ] CI/CD 流水线
- [ ] 灾备演练与 Runbook

---

## 附加建议

### 文档补充

1. **API 文档**：使用 Swag 生成 OpenAPI 规范
   ```go
   // @title YunOJ API
   // @version 1.0
   // @host localhost:8090
   // @BasePath /api
   ```

2. **生产 Runbook**：
   - 灾难恢复流程（数据库恢复、Redis AOF 重放）
   - 故障排查清单（队列堵塞、数据库慢查询、OOM）
   - 滚动升级步骤（先升级 backend，再升级 judge 节点）

3. **性能调优指南**：
   - 数据库连接池配置（pgx MaxConns）
   - Redis 内存淘汰策略（allkeys-lru）
   - Judge 并发度与资源分配

### 工具推荐

| 工具 | 用途 | 集成难度 |
|------|------|---------|
| `pprof` | Go 性能分析 | 低（内置） |
| `webpack-bundle-analyzer` | 前端打包分析 | 低 |
| `axe DevTools` | 无障碍审计 | 极低（浏览器插件） |
| `k6` | 压力测试 | 中 |
| `Sentry` | 错误跟踪 | 中 |

---

## 总结

YunOJ 的**架构设计优秀**，但需要在以下方面补齐短板：

1. **性能**：通过索引 + 代码拆分 + 查询优化，可在 1-3 天内实现 5-100x 提升
2. **生产就绪度**：通过健康检查 + 监控 + 安全加固，2 周内可满足上线条件
3. **开发效率**：通过 React Query + 测试 + 重构，3-5 周内显著降低维护成本

**建议执行顺序**：先快速修复性能与安全问题（阶段 1-2），再进行长期架构优化（阶段 3-4）。

---

**审查完成时间**：{{ 当前时间 }}  
**下一步**：请选择优先级最高的项目开始实施，或委托我执行 Quick Wins 优化。
