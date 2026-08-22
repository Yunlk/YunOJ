# YunOJ

YunOJ 是一个面向教学和校内比赛的在线评测系统，提供题库、在线 IDE、异步评测、比赛管理、ACM 封榜和动态榜单。

项目地址：[github.com/Yunlk/YunOJ](https://github.com/Yunlk/YunOJ)

## 项目定位

YunOJ 适合课堂练习、作业和阶段性测试，也适合学校或社团组织 ACM/OI/IOI 比赛。系统将业务服务和评测机分离：网页/API 服务负责用户、题目、比赛和提交记录；评测机从 Redis 队列取任务，在 isolate 沙箱中编译和运行用户代码。

## 功能

### 题库与评测

- 题目创建、编辑、发布、停用、复制和批量管理
- 标准比较、Special Judge、交互题和输出题
- 测试点单独管理，支持分值、排序、增删改和 ZIP 导入预览
- 题目可配置时间限制和内存限制
- 逐测试点记录状态、时间、内存和得分
- 支持 `AC`、`WA`、`PE`、`TLE`、`MLE`、`OLE`、`RE`、`CE`、`SE` 等状态
- 提交记录支持按题目、用户和状态筛选；代码和详细评测结果仅对本人及管理员开放
- 管理员可发起重测，系统避免重复累计题目提交数和通过数

### 在线 IDE

- Monaco 编辑器，普通题目和比赛题目共用工作台
- 自定义输入自测和样例测试不写入正式提交记录
- 提交后返回最近一次代码继续修改
- 自测入口支持收纳为悬浮面板，移动端使用底部抽屉

### 比赛

- ACM、OI、IOI 三种比赛模式
- 实时反馈和盲评反馈
- 个人报名、团队报名、团队成员和队伍头像
- 报名时间窗、比赛可见性、队伍人数限制和提交次数限制
- 比赛题目管理：题号、排序、单题分值、单题提交上限和题目主题色
- 比赛总览：公告、答疑、倒计时、进度、题目状态和个人成绩
- 管理员可以查看参赛者、全部提交，导出排行榜和比赛数据包

### ACM 封榜与动态榜

1. 封榜前，榜单实时更新，提交状态会经历等待评测、评测中和终态。
2. 进入封榜后，榜单进入暗色封榜状态，冻结提交不再公开到实时榜。
3. 比赛结束后，动态榜先显示黑色选择界面：
   - **动态榜单**：从表格底部向上预览提交和通过情况，再按提交顺序逐条揭晓。
   - **快速榜单**：直接显示最终排名，停留片刻后从底部向上滚动预览。
4. 动态榜不显示“上升 N 名”或“第 X 名 → 第 Y 名”等文案，排名变化通过表格行平滑移动体现。

## 技术结构

```text
浏览器
   │
   ▼
Go Web/API (:8080) ───── PostgreSQL
   │
   └──── Redis 评测队列 ───── Go Judge
                                  │
                                  ▼
                           isolate 沙箱
```

- 后端：Go、Chi、PostgreSQL、Redis
- 前端：React、TypeScript、Vite、Monaco Editor
- 评测隔离：isolate namespace/seccomp 沙箱
- 题面渲染：Markdown、GFM、KaTeX
- 认证：JWT；第一个注册用户自动成为管理员

## 快速开始

### Docker 部署

前置要求：Docker 和 Docker Compose。

```bash
git clone https://github.com/Yunlk/YunOJ.git
cd YunOJ
cp .env.example .env
docker compose up -d --build
```

访问 <http://localhost:8080>。首次注册的账号会自动获得管理员权限。

Linux 主机使用挂载的 `data` 目录时，需要确保容器用户可以写入：

```bash
sudo chown -R 1000:1000 data
```

### 本地开发

推荐本地运行 Go 服务和 Vite，Docker 只运行 PostgreSQL、Redis。

```bash
docker compose up -d postgres redis
pwsh -File scripts/dev-server.ps1
```

后端默认监听 `http://localhost:8080`。

另开终端启动前端：

```bash
cd web
npm install
npm run dev
```

前端默认运行在 <http://localhost:5173>，`/api` 自动代理到 8080。

需要实际评测时再启动 judge：

```bash
docker compose build judge
docker compose up -d judge
```

未启动 judge 时，提交会停留在 `pending`，题库和比赛页面仍可正常开发。

## 演示数据

生成覆盖各类比赛和生命周期的公开演示比赛：

```bash
go run ./cmd/seedcontests
```

需要重建时：

```bash
go run ./cmd/seedcontests -reset
```

演示账号为 `flow01` 至 `flow12`、`burst01` 至 `burst50`，密码均为 `demo123`。

创建一场在指定时间封榜的实时演示赛：

```bash
go run ./cmd/seedcontests -live-freeze-at 17:15
```

## 外部控制脚本

提交联动脚本通过真实登录、报名、提交和榜单接口工作，不直接写数据库：

```bash
python scripts/contest_control.py
python scripts/contest_control.py --mode wa-then-ac
python scripts/contest_control.py --user-prefix burst --count 50 --poll-seconds 90
```

管理员可以在网页外切换比赛阶段：

```bash
python scripts/contest_phase_control.py --admin-user admin --admin-password '你的密码' --create-demo --phase running
python scripts/contest_phase_control.py --admin-user admin --admin-password '你的密码' --contest-id 114 --phase freeze
python scripts/contest_phase_control.py --admin-user admin --admin-password '你的密码' --contest-id 114 --phase ended
python scripts/contest_phase_control.py --admin-user admin --admin-password '你的密码' --contest-id 114 --phase show
```

阶段值为 `upcoming`、`running`、`freeze`、`ended`。脚本只更新比赛时间配置，不伪造提交的评测状态；动态揭晓需要比赛中存在已经完成的冻结提交。也可以使用 `YUNOJ_ADMIN_USER`、`YUNOJ_ADMIN_PASSWORD` 或 `YUNOJ_ADMIN_TOKEN` 环境变量传入认证信息。

## 语言扩展

内置语言：

- C：GCC 12，C11
- C++：GCC 12，C++17
- Python：CPython 3.11

额外语言通过受信任的 `config/languages.json` 注册。web 和 judge 必须读取同一份配置，语言会进入统一的编译、运行、超时、内存和沙箱流程。

示例：

```json
{
  "languages": [
    {
      "key": "custom_cpp",
      "name": "C++",
      "version": "GCC 12 (C++23)",
      "monaco": "cpp",
      "source_file": "main.cpp",
      "compile": {
        "command": ["/usr/bin/g++", "-std=c++23", "-O2", "-o", "{output}", "{source}"],
        "time_ms": 20000,
        "memory_kb": 1048576
      },
      "run_command": ["./main"]
    }
  ]
}
```

自定义编译器属于服务器配置，必须预先安装在评测机中，不能由普通用户在提交时动态指定。

## 关键 API

API 前缀统一为 `/api`，认证使用 `Authorization: Bearer <JWT>`。

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查和服务器时间 |
| `POST` | `/api/auth/register` | 注册并登录 |
| `POST` | `/api/auth/login` | 登录 |
| `GET` | `/api/problems` | 题目列表 |
| `GET` | `/api/problems/{id}` | 题目详情 |
| `POST` | `/api/submissions` | 普通题目提交 |
| `GET` | `/api/submissions/{id}` | 提交详情和测试点结果 |
| `POST` | `/api/problems/{id}/test` | 自定义输入自测 |
| `GET` | `/api/contests` | 比赛列表 |
| `GET` | `/api/contests/{id}` | 比赛详情 |
| `POST` | `/api/contests/{id}/register` | 比赛报名 |
| `POST` | `/api/contests/{id}/submit` | 比赛提交 |
| `GET` | `/api/contests/{id}/standings` | 实时榜、封榜榜和动态揭晓数据 |
| `GET` | `/api/contests/{id}/submissions` | 比赛提交记录 |
| `GET` | `/api/contests/{id}/standings/export` | 导出排行榜 |
| `GET` | `/api/contests/{id}/data-package` | 导出比赛数据包 |
| `GET` | `/api/rankings` | 全站训练排名 |
| `GET` | `/api/profile` | 当前用户个人中心 |

## 评测状态

| 状态 | 含义 |
| --- | --- |
| `pending` | 等待评测队列 |
| `running` | 正在评测 |
| `accepted` | 通过 |
| `wrong_answer` | 答案错误 |
| `presentation_error` | 格式错误 |
| `time_limit_exceeded` | 超出时间限制 |
| `memory_limit_exceeded` | 超出内存限制 |
| `output_limit_exceeded` | 输出超限 |
| `runtime_error` | 运行时错误 |
| `compile_error` | 编译错误 |
| `system_error` | 评测系统错误 |
| `not_run` | 未运行的测试点 |

评测会继续运行后续测试点，最终状态由题目类型和评测规则汇总。评测结果、时间和内存数据会保存在提交详情中。

## 目录结构

```text
cmd/server/              Go Web/API 服务
cmd/judge/               Go 评测守护进程
cmd/seedcontests/        比赛演示数据生成器
internal/api/             HTTP 路由与处理器
internal/auth/            JWT 和密码哈希
internal/config/          环境变量配置
internal/data/            测试数据与 ZIP 安全处理
internal/judge/           isolate 沙箱、编译、运行和比较器
internal/langs/           内置语言和自定义语言加载
internal/model/           数据模型与数据库迁移
internal/queue/           Redis 可靠评测队列
internal/store/           PostgreSQL 数据访问层
web/                      React + TypeScript 前端
config/languages.json     自定义语言配置
data/                     题目测试数据
scripts/                  本地开发和比赛控制脚本
third_party/isolate/      isolate 源码
```

## 配置项

| 环境变量 | 默认值 | 说明 |
| --- | --- | --- |
| `SERVER_ADDR` | `:8080` | Web/API 监听地址 |
| `DATABASE_URL` | `postgres://yunoj:yunoj@localhost:5432/yunoj?sslmode=disable` | PostgreSQL 连接串 |
| `REDIS_ADDR` | `localhost:6379` | Redis 地址 |
| `JWT_SECRET` | `dev-secret-change-me` | 生产环境必须修改 |
| `DATA_DIR` | `./data` | 题目测试数据目录 |
| `LANGUAGE_CONFIG` | `./config/languages.json` | 自定义语言配置路径 |
| `JUDGE_WORKERS` | `2` | 评测 worker 数量 |
| `ISOLATE_PATH` | `isolate` | isolate 可执行文件路径 |
| `ISOLATE_DIR` | `/var/local/lib/isolate` | isolate 沙箱目录 |
| `ISOLATE_CG` | `false` | 是否启用 cgroup 精确内存计量 |

## 常用检查

```bash
go test ./...
cd web && npm run build
```

## 安全边界

- 用户代码在 isolate 沙箱中运行，限制网络、进程、时间、内存和输出。
- judge 容器需要较高系统权限来创建沙箱，生产环境应与业务服务隔离。
- 测试数据上传会校验 ZIP 路径和解压规模，避免路径穿越和解压炸弹。
- 自定义编译器是服务器级配置，只允许管理员维护。
- 不要把 `.env`、JWT 密钥、数据库密码或私有测试数据提交到仓库。

## 当前边界

YunOJ 当前优先服务于校内教学和中小型比赛。多评测机动态调度、代码查重、长期归档和更复杂的教学分析仍属于后续扩展方向。

欢迎通过 Issue 或 Pull Request 提交问题和改进建议。
