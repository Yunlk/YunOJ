# YunOJ

一个从零实现的轻量在线评测系统（Online Judge），支持题库、在线评测和 ACM/OI/IOI 比赛，Docker 一键部署。

项目地址：[github.com/Yunlk/YunOJ](https://github.com/Yunlk/YunOJ)

- **后端**：Go（web/API 服务 + 评测守护进程两个二进制），性能优先、单文件部署
- **评测沙箱**：IOI 官方 [isolate](https://github.com/ioi/isolate)（namespace + seccomp 隔离）
- **前端**：React + TypeScript + Vite，题面支持 Markdown / KaTeX 数学公式
- **基础设施**：PostgreSQL（数据）+ Redis（评测队列），Docker Compose 一键部署

## 功能

- 注册 / 登录（JWT），首个注册用户自动成为管理员
- 题目管理后台：列表搜索/难度/标签/题型/状态筛选、草稿-发布-停用状态机、
  复制、批量操作、删除前比赛引用阻断
- 题目类型：标准比较、Special Judge（含 0-100 部分分）、交互题（双沙箱管道通信）、输出题
- 测试点管理：manifest 权威分值（编号稳定、删除不重排）、单点增删改、拖拽排序、
  ZIP 上传前预览后确认导入（成对/分值/总分 100 校验）
- 测试数据上传：zip 包（`N.in` / `N.out` 成对文件），带路径穿越与 zip 炸弹防护
- 提交评测：C / C++ / Python 3，判定 `AC / WA / TLE / MLE / OLE / RE / CE / SE`
- 提交记录：全局/按题目/按用户/按状态过滤，逐测试点详情（仅本人与管理员可见）
- 重测（rejudge）、提交限流（每用户 10 秒 1 次）、评测机崩溃自动恢复
- 在线 IDE：Monaco 编辑器，自测（自定义输入）与样例测试，不落库即时反馈
- 比赛工作台：报名（队伍名 + 头像）、总览（公告/倒计时/进度条/单题状态/通过率/
  我的成绩）、比赛内作答页（常驻剩余时间、上一题/下一题）、我的提交、排行榜
- 比赛系统：ACM（罚时 + 封榜动态揭晓）/ OI / IOI 三种赛制模板 + 自定义引擎组合、
  盲评、报名时间窗、可见性（公开/私有）、提交次数上限（比赛默认 + 单题覆盖）、
  比赛题目管理（题库搜索选择器、拖拽排序、题号/单题分值/上限）

ACM 比赛的榜单与动态揭晓使用同一个排行榜页面：封榜前实时显示最新评测状态；比赛结束后，系统按提交时间逐条展示封榜期间的评测结果，最终停留在正式排名，不展示名次变化文案。

## 架构

```
用户 → web (Go, :8080) ── 题目/提交/文件上传 ──> PostgreSQL
              │                                     ↑
              │ 提交入队 (Redis list)               │ 判定结果写回
              ▼                                     │
   Redis 评测队列 ──BRPOPLPUSH──> judge (Go 守护进程) ─┘
                                    │
                              isolate 沙箱（每 worker 一个）
                              —— 编译 → 逐测试点运行 → 输出比较
```

关键设计：

- **web 与 judge 完全解耦**：提交只是往 Redis 队列入队，评测异步进行；judge 可水平扩展到多台机器
- **可靠队列**：任务经 `BRPOPLPUSH` 原子转移到各 worker 的处理中列表，评测机崩溃后重启时自动找回并重测
- **资源计量双模式**：`ISOLATE_CG=true` 时走 cgroup 精确计量（裸 Linux 服务器推荐）；
  默认关闭时 isolate 用 rlimit 限制 + `max-rss` 计量（兼容 Docker Desktop/WSL2 等
  无法委派 memory 控制器的环境）
- **比较器**：按空白切 token 比较，忽略行末空格/文末换行，避免 Windows 换行误判
- **计数一致性**：题目通过/提交数仅在首次评测时更新，重测不重复计数
- **比赛引擎为纯函数**：ACM 罚时 / OI·IOI 计分 / 封榜 / 动态揭晓均为内存纯计算，
  结果可复现、可单元测试，判定落库时仅多写一条冻结标记

## 快速开始（Docker）

前置：Docker + Docker Compose。

```bash
git clone https://github.com/Yunlk/YunOJ.git && cd YunOJ
cp .env.example .env          # 按需修改，生产环境务必更换 JWT_SECRET
mkdir -p data
# Linux 主机注意：web 容器以 uid 1000 写入 ./data，需放开权限
sudo chown -R 1000:1000 data  # 或 chmod 777 data
docker compose up -d --build
```

启动完成后访问 **http://localhost:8080**。

- 第一次构建会编译 isolate 沙箱，`judge` 镜像耗时较长属正常
- **第一个注册的账号自动成为管理员**（请立即注册并保管好该账号）
- 使用流程：注册 → 管理员在「新建题目」创建题目 → 「上传测试数据」上传 zip → 任意用户提交代码
- 测试数据 zip 格式：成对的 `1.in/1.out`、`2.in/2.out`…（可带子目录，按文件名排序）

### 国内网络说明

项目已针对国内网络做了开箱即用配置：

- **Docker Hub 镜像**：默认通过 `REGISTRY_PREFIX=docker.1ms.run/` 拉取（见 `.env`）。
  海外环境或服务器上把它设为空即可；该镜像源不可用时也可换成其他加速站
- **Go 模块代理**：镜像内默认 `GOPROXY=https://goproxy.cn,direct`（见 Dockerfile），
  海外环境可删除对应行
- **isolate 源码已固化**在 `third_party/isolate`（构建时不访问 GitHub，版本锁定见
  `third_party/ISOLATE_VERSION`）

## 本地开发（开发优先：后端/前端原生运行，Docker 只跑基础设施）

日常开发**不需要构建任何 Docker 镜像**：数据库和 Redis 用容器跑，
后端与前端都在本机原生运行，改代码即时生效。

### 1. 基础设施（PostgreSQL + Redis）

```bash
docker compose up -d postgres redis
```

### 2. 后端（Windows/macOS/Linux 均可）

```bash
pwsh -File scripts/dev-server.ps1     # 等价于: go run ./cmd/server（自动设置 GOPROXY）
```

后端默认连接 `localhost:5432` / `localhost:6379`，直接可用。

### 3. 前端（热更新）

```bash
cd web
npm install
npm run dev        # http://localhost:5173，/api 自动代理到 localhost:8080
```

### 4. 评测机（需要判题功能时再启动）

评测需要 Linux 环境的 isolate 沙箱，两种方式任选：

```bash
# 方式 A：Docker 运行（与部署一致，Windows 也可用）
docker compose build judge && docker compose up -d judge

# 方式 B：Linux 原生运行
sudo apt install isolate        # Debian 12+ 自带；或编译 third_party/isolate
pwsh -File scripts/dev-judge.ps1
```

> 未启动评测机时提交会停留在 `pending`，web/API/前端开发不受影响。

### 打包上线

开发完成后用 Docker 打包（镜像内完成前端构建与后端编译）：

```bash
docker compose build
docker compose push  # 或 docker save 后上传到服务器
```

### 前端构建产物

```bash
cd web
npm run build    # 产物输出到 web/dist，被后端 go:embed 嵌入
```

### 常用校验命令

```bash
go test ./...
cd web && npm run build
```

## 配置项

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `SERVER_ADDR` | `:8080` | web 监听地址 |
| `DATABASE_URL` | `postgres://yunoj:yunoj@localhost:5432/yunoj?sslmode=disable` | PostgreSQL 连接串 |
| `REDIS_ADDR` | `localhost:6379` | Redis 地址 |
| `JWT_SECRET` | `dev-secret-change-me` | **生产必改**，JWT 签名密钥 |
| `DATA_DIR` | `./data` | 题目测试数据目录（web/judge 共享） |
| `JUDGE_WORKERS` | `2` | 评测 worker 数，建议 = CPU 核数 |
| `ISOLATE_PATH` | `isolate` | isolate 可执行文件路径 |
| `ISOLATE_DIR` | `/var/local/lib/isolate` | 沙箱根目录 |
| `ISOLATE_CG` | `false` | 是否启用 cgroup 精确内存计量（见架构一节） |

## API 摘要

统一前缀 `/api`，错误响应 `{"error": "..."}`，分页响应 `{"items": [...], "total": n}`。
认证方式：`Authorization: Bearer <token>`。

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/auth/register` | 注册（即登录），返回 `{token, user}` |
| POST | `/auth/login` | 登录 |
| GET | `/auth/me` | 当前用户（登录） |
| GET | `/problems?page=&size=&keyword=` | 题目列表 |
| GET | `/problems/{id}` | 题目详情 |
| POST/PUT/DELETE | `/problems[/{id}]` | 创建/更新/删除题目（管理员） |
| POST | `/problems/{id}/tests` | 上传测试数据 zip，multipart 字段 `file`（管理员） |
| POST | `/submissions` | 提交代码 `{problem_id, language, code}`（登录，限流） |
| GET | `/submissions?page=&problem_id=&user_id=&status=` | 提交列表 |
| GET | `/submissions/{id}` | 提交详情（匿名仅可见概要；本人/管理员可见代码与逐点结果） |
| POST | `/submissions/{id}/rejudge` | 重测（管理员） |
| GET | `/languages` | 支持的语言列表 |
| POST | `/problems/{id}/test` | 自测（登录，自定义输入，不落库） |
| POST | `/problems/{id}/test-samples` | 样例测试（登录，不落库） |
| POST | `/problems/{id}/copy` | 复制题目（管理员，含测试数据与分值，草稿态） |
| PATCH | `/problems/{id}/status` | 草稿/发布/停用（管理员，发布校验总分 100） |
| POST | `/problems/batch` | 批量发布/停用/删除（管理员） |
| GET | `/problems/{id}/usage` | 删除影响范围：引用比赛与提交数（管理员） |
| GET | `/problems/{id}/testcases` | 测试点列表（管理员，含总分与完整性） |
| POST | `/problems/{id}/testcases/preview` | ZIP 解析预览（管理员，不落盘） |
| POST | `/problems/{id}/testcases/import` | ZIP 确认导入 replace/append（管理员） |
| POST/PUT/DELETE | `/problems/{id}/testcases[/{ordinal}]` | 单点增改删（管理员） |
| PUT | `/problems/{id}/testcases/order` | 测试点重排（管理员，分值随编号移动） |
| GET | `/contests?page=&size=` | 比赛列表（private 对非管理员隐藏） |
| GET | `/contests/{id}` | 比赛详情（题目列表、是否已报名） |
| POST/PUT/DELETE | `/contests[/{id}]` | 创建/更新/删除比赛（管理员，含说明/可见性/报名窗/默认上限） |
| POST | `/contests/{id}/problems` | 添加比赛题目（管理员，含分值/上限覆盖） |
| PUT | `/contests/{id}/problems/{pid}` | 改题号/单题分值/单题上限（管理员） |
| PUT | `/contests/{id}/problems/order` | 比赛题目拖拽排序（管理员） |
| POST | `/contests/{id}/register` | 报名（登录，受报名时间窗约束） |
| POST | `/contests/{id}/avatar` | 上传队伍头像（登录，已报名） |
| POST | `/contests/{id}/submit` | 比赛内提交（登录，时间窗 `[start, end)` + 上限校验） |
| GET | `/contests/{id}/overview` | 比赛总览（登录+报名，公告/统计/我的状态/我的成绩） |
| GET | `/contests/{id}/problems/{pid}` | 比赛题面上下文（赛前非管理员 403） |
| GET | `/contests/{id}/submissions` | 我的比赛提交（盲评中脱敏为 hidden） |
| GET | `/contests/{id}/standings` | 排行榜（盲评进行中对非管理员隐藏） |
| GET | `/health` | 健康检查（含 server_time 供前端时钟校正） |

判题状态：`pending`、`running`、`accepted`、`wrong_answer`、`time_limit_exceeded`、
`memory_limit_exceeded`、`output_limit_exceeded`、`runtime_error`、`compile_error`、`system_error`。

## 目录结构

```
cmd/server/           web/API 服务入口
cmd/judge/            评测守护进程入口
internal/api/         HTTP 路由与处理器
internal/auth/        bcrypt 密码哈希 + JWT
internal/config/      环境变量配置
internal/data/        测试数据文件管理与 zip 安全解压
internal/judge/       isolate 沙箱封装、编译、运行、判定、比较器
internal/langs/       语言定义（编译/运行命令、限制倍率）
internal/model/       数据模型、判题状态、SQL 迁移
internal/queue/       Redis 可靠评测队列
internal/store/       PostgreSQL 数据访问层
web/                  React 前端（embed.go 嵌入其构建产物）
third_party/isolate/  isolate 源码（随仓库分发，构建镜像时本地编译）
Dockerfile            web 镜像（前端构建 + 后端构建 + 运行）
Dockerfile.judge      评测机镜像（isolate 编译 + 工具链 + judge）
```

## 安全说明

- 用户代码在 isolate 沙箱内运行：无网络、进程数受限、seccomp 系统调用白名单、
  只读根文件系统、独立 tmpfs 工作目录；时间/内存/输出大小均有硬限制
- `judge` 容器需以 `privileged` 运行（isolate 需创建 namespace）。它不暴露
  端口、不提供任何网络服务，建议部署在专用评测节点，与业务容器网络隔离
- 测试数据上传做了 zip 路径穿越、解压炸弹、单文件/总量限制
- 代码与编译错误仅本人与管理员可见；所有用户输入（题面/昵称等）渲染前需由前端消毒
- `JWT_SECRET`、数据库密码等敏感配置通过 `.env` 注入，不要提交到仓库

## 已知边界与 Roadmap

- [x] 比赛模块（ACM 罚时 / OI 计分、封榜动态揭晓）
- [x] Special Judge、部分分、交互题
- [ ] 多评测机动态调度与心跳监控
- [ ] 代码查重（SIM/MOSS 类）
- [ ] 讨论区、题解
- [ ] 提交量膨胀后的归档/分表策略

## 故障排查

- **评测结果大量 `system_error`**：查看 judge 容器日志。常见原因：沙箱初始化失败；
  确认 judge 容器以 privileged 运行；Docker Desktop/WSL2 环境保持 `ISOLATE_CG=false`
- **构建时拉取基础镜像失败**：国内网络走默认的 `docker.1ms.run` 加速；若该源失效，
  在 `.env` 换一个可用的 `REGISTRY_PREFIX`（需以 `/` 结尾）
- **构建时 go mod download 失败**：确认 Dockerfile 中 `GOPROXY` 指向可达的代理
- **上传测试数据失败**：确认 `./data` 目录对 uid 1000 可写（见快速开始）
- **提交一直 `pending`**：检查 judge 容器是否运行、Redis 是否健康
