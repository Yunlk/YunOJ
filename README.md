# YunOJ

YunOJ 是面向校园教学、日常练习与程序设计竞赛的在线评测系统。项目包含题库、代码评测、比赛、动态滚榜、教学空间、个人中心、全站排名和测评集群管理。

## 主要能力

- 题目与测试点管理：题面、难度、标签、时间/内存限制、逐点分值、ZIP 导入与预览
- 评测状态：AC、WA、PE、TLE、MLE、OLE、RE、CE、SE，并保留每个测试点的结果
- 题目类型：标准评测、SPJ、交互题接口与输出题接口
- 在线 IDE：代码草稿、最近提交恢复、样例运行、自测与逐点结果
- 比赛：ACM、OI、IOI 和自定义计分模板，支持个人或团体报名
- 比赛运维：题目管理、参赛者管理、广播、对话式答疑、榜单导出和时间线数据包
- 动态榜单：封榜、逐条揭晓、快速最终榜与实时更新事件
- 教学空间：班级/团体、作业、测试与完成情况
- 用户侧：个人中心、头像、提交记录、参赛记录、刷题热力图、收藏与通知
- 全站排名：综合分、难度权重与用户名等级颜色
- 测评集群：节点心跳、动态并发、平滑排空、语言启停、队列统计与操作审计

## 项目结构

```text
backend/                 Go API、评测守护进程、数据库迁移与领域逻辑
  cmd/server/            HTTP API 服务
  cmd/judge/             测评节点进程
  cmd/seedcontests/      比赛流程演示数据
  internal/              API、Store、Queue、Judge、Contest 等模块
frontend/                React + TypeScript 前端
  src/                   页面、组件与样式
  server.mjs             生产环境 SPA 静态服务与 API 反向代理
config/                  受信任的语言配置
scripts/                 开发和比赛控制脚本
data/                    运行时题目数据，不纳入版本控制
third_party/isolate/     固定版本的 isolate 沙箱源码
toolchains/              可挂载的自有工具链目录
docker-compose.yml       前端、后端、数据库、Redis 与测评节点编排
```

## 架构

```text
Browser
   |
Frontend (React static service)
   |
Backend API -------- PostgreSQL
   |                     |
   +------ Redis Queue --+
              |
       Judge Node 1..N
              |
       Shared DATA_DIR
```

前端与后端分别构建和部署。API 不再携带前端静态文件，前端服务负责 SPA 路由和 `/api` 反向代理。

评测节点不提供公网端口。每个节点使用唯一的节点 ID 注册，生产环境应显式配置稳定的 `JUDGE_NODE_ID`；worker 使用“节点 ID + 槽位”作为全局唯一消费者 ID。提交由数据库条件更新原子领取，因此重复队列消息或多节点并发不会导致同一提交被重复执行。

## 快速部署

前置条件：

- Docker Engine 与 Docker Compose
- 支持 Linux namespace 的环境
- 生产环境需准备强随机 JWT 密钥和数据库密码

启动全部服务：

```bash
cp .env.example .env
docker compose up -d --build
```

通过 `HTTP_PORT` 对应的部署域名访问站点。首次注册账号会成为管理员，正式开放注册前应先完成管理员初始化并检查注册策略。

停止服务：

```bash
docker compose down
```

数据库保存在命名卷中，题目数据保存在 `data/`。删除卷或数据目录前必须先完成备份。

## 本地开发

先启动依赖：

```bash
docker compose up -d postgres redis
```

启动后端：

```powershell
pwsh -File scripts/dev-server.ps1
```

启动前端：

```bash
cd frontend
npm ci
npm run dev
```

测评沙箱依赖 Linux。可以使用 Compose 启动测评节点：

```bash
docker compose up -d judge
```

也可以在已安装 isolate 的 Linux 主机上运行：

```powershell
pwsh -File scripts/dev-judge.ps1
```

## 测评集群

管理员可在“测评集群”页面查看：

- 节点在线状态、版本与最后心跳
- 实际并发和目标并发
- 排队与处理中任务数
- 每种语言的开放状态
- 提交状态汇总和配置变更记录

将节点目标并发设为 `0` 或关闭调度时，节点停止领取新任务，正在运行的任务会完成后退出，不会被强制终止。后台配置通常在一个心跳周期内生效。

单机增加节点实例：

```bash
docker compose up -d --scale judge=3
```

多机部署还必须满足：

1. 所有后端和测评节点连接同一 PostgreSQL 与 Redis。
2. 所有测评节点使用唯一的 `JUDGE_NODE_ID`；未设置时使用主机名。
3. 所有节点读取一致的 `config/languages.json`。
4. `DATA_DIR` 必须是所有 API 与测评节点可见的共享存储，例如 NFS 或 CephFS。
5. 测评节点应部署在专用 Linux 主机，并限制出站网络和宿主机权限。

当前管理页只允许启停服务端已经加载的受信任语言。新增编译器需要先修改语言配置并在节点安装对应工具链；管理 API 不接受任意编译命令，以免形成远程命令执行入口。

## 自定义语言

在 `config/languages.json` 中声明语言。命令以参数数组执行，不经过 shell；编译命令必须使用 `{source}` 与 `{output}` 占位符。

```json
{
  "languages": [
    {
      "key": "example",
      "name": "Example",
      "version": "toolchain-version",
      "monaco": "plaintext",
      "source_file": "main.example",
      "run_command": ["/opt/toolchains/example", "main.example"],
      "time_factor": 1,
      "memory_factor": 1,
      "processes": 16
    }
  ]
}
```

配置文件属于受信任的服务器配置。修改后需要重启 API 和各测评节点，使语言清单和执行能力保持一致。

## 比赛演示与控制

生成不同赛制、封榜阶段和并发提交的演示比赛：

```bash
go -C backend run ./cmd/seedcontests
```

重建演示数据：

```bash
go -C backend run ./cmd/seedcontests -reset
```

控制比赛阶段：

```bash
python scripts/contest_phase_control.py --help
python scripts/contest_control.py --help
```

控制脚本通过 API 操作比赛，不直接修改数据库；服务地址和凭据应通过脚本参数提供。

## 测试与构建

后端：

```bash
go -C backend test ./...
go -C backend build ./cmd/server
go -C backend build ./cmd/judge
```

前端：

```bash
cd frontend
npm ci
npm run build
```

检查 Compose：

```bash
docker compose config
```

## 环境变量

| 变量 | 用途 |
| --- | --- |
| `POSTGRES_PASSWORD` | Compose 数据库密码 |
| `DATABASE_URL` | PostgreSQL 连接串 |
| `REDIS_ADDR` | Redis 地址 |
| `JWT_SECRET` | 登录令牌签名密钥 |
| `SERVER_ADDR` | API 监听地址 |
| `DATA_DIR` | 题目测试数据目录 |
| `LANGUAGE_CONFIG` | 受信任语言配置路径 |
| `HTTP_PORT` | 前端服务公开端口 |
| `JUDGE_WORKERS` | 节点首次注册时的目标并发 |
| `JUDGE_NODE_ID` | 集群内唯一节点 ID |
| `JUDGE_NODE_NAME` | 节点展示名称 |
| `JUDGE_VERSION` | 节点版本标识 |
| `ISOLATE_PATH` | isolate 可执行文件 |
| `ISOLATE_DIR` | isolate 沙箱根目录 |
| `ISOLATE_CG` | 是否启用 cgroup 精确计量 |

## 安全边界

- 用户代码只应在 isolate 沙箱内运行，API 服务不得直接执行用户代码。
- 测评节点需要较高宿主权限，应与数据库、业务 API 和其他内部系统隔离。
- 生产环境不要使用示例密钥和密码，不要公开 PostgreSQL、Redis 或测评节点端口。
- 比赛盲评和封榜结果由 API 权限逻辑控制，新增接口时必须复用相同的可见性检查。
- 上传的题目数据、头像与比赛封面应在反向代理层配置请求大小和速率限制。
- 管理操作应继续补充更完整的审计、二次确认和告警。

## 待办

- 部署管理页：环境检查、迁移状态、备份状态、版本与滚动升级
- 将共享文件目录抽象为对象存储，降低多机挂载依赖
- 测评节点能力调度：按语言、架构和空闲资源选择节点
- 节点证书或服务身份认证，避免未授权节点注册
- 登录保护、密码策略、二次认证和会话管理
- 指标、日志聚合、告警与队列积压自动扩容
- 大型前端模块按路由拆包，进一步缩短首次加载时间

## 说明

项目仍处于持续开发阶段。用于正式比赛或教学前，应在目标 Linux 环境完成沙箱逃逸检查、资源限制压力测试、断电恢复演练、备份恢复演练和权限审计。
