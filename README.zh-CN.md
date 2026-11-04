# ResearchOS

[English](README.md) | [简体中文](README.zh-CN.md)

**支持自行部署、面向 AI 协作的科研项目看板。** 通过网页界面、REST API 和 MCP 服务，
集中管理多篇论文、机器人学习实验与科研软件项目。Claude Code 和 OpenAI Codex
可以直接从你的研究仓库访问项目数据。

- **项目总览**：以卡片或表格查看各项目的阶段、健康状态、里程碑进度、下一截止日期、
  未完成任务、阻塞因素和最近动态。
- **项目工作区**：记录研究问题、假设、投稿会议与截止日期；管理里程碑时间线、任务看板、
  实验、动态、Markdown 笔记和文档链接。
- **实验登记**：按消融实验分组，每个实验可包含多次运行，记录随机种子、配置、Git 提交、
  带单位的指标、产物链接、验证状态，以及多次运行的均值和标准差。
- **跨项目视图**：集中查看任务（受阻、本周到期、高优先级等）、投稿与任务截止时间线，
  以及标明来源的动态日志。
- **面向智能体的 API**：REST（`/api/v1`，OpenAPI 文档位于 `/api/docs`）与 MCP
  （`/mcp`，Streamable HTTP）共用业务服务层，支持幂等写入、只读或读写令牌及审计记录。
- **科研数据验证**：智能体不能将结果标为“已验证”，不能直接覆盖已验证的结论；
  涉及已验证数据的覆盖操作需要明确确认。
- **部署简单**：一个容器、一个 SQLite 数据库文件，无需付费服务。

> ResearchOS 用于记录、展示和查询研究状态，不负责运行智能体或调度 GPU 作业，
> 也不替代 W&B/MLflow。

---

## 快速开始（Docker）

```bash
git clone <your-repo-url> researchos && cd researchos
cp .env.example .env
# 编辑 .env，设置 RESEARCHOS_ADMIN_PASSWORD（至少 10 个字符）
docker compose up -d --build
```

打开 **http://127.0.0.1:8000**，使用 `admin` 和刚才设置的密码登录。
在**设置 → 用户管理**中创建用户并分享注册链接；在项目的**成员**标签页添加协作者。
普通用户及其 MCP 令牌只能访问自己拥有或加入的项目。

服务默认只监听本机。如需从笔记本或手机远程访问，可启用随项目提供的 Tailscale 辅助容器，
通过 tailnet 内的 HTTPS 访问，无需开放公网端口：

```bash
docker compose --profile tailscale up -d
docker compose logs tailscale | grep -A1 "To authenticate"   # 首次按提示授权
# → https://researchos.<your-tailnet>.ts.net
```

部署细节、Caddy/nginx 及 VPS 配置见 [部署文档](docs/deployment.md)。

**应用内帮助：** 侧边栏底部的**帮助**页面包含中英文用户指南、MCP 集成、部署说明、
架构文档，以及可复制或下载的 CLAUDE.md / AGENTS.md 模板。

可选示例数据（三个虚构项目，仅适用于空数据库）：

```bash
docker compose exec researchos python -m app.cli seed-demo
```

### 自定义数据存储路径（可选）

在项目的 `.env` 中设置一次，之后 `docker compose` 会自动读取：

```dotenv
RESEARCHOS_HOST_DATA_DIR=/mnt/researchos-data
```

宿主机目录会挂载到容器内的 `/data`。所有用户共用 `researchos.db`，其中存储账户、
密码哈希、项目和权限；`uploads/` 保存图片，`.secret_key` 保存生成的会话签名密钥。
容器内保持 `RESEARCHOS_DATA_DIR=/data`。未设置 `RESEARCHOS_HOST_DATA_DIR` 时，
默认使用 `researchos-data` 命名卷，可通过 `RESEARCHOS_VOLUME` 修改卷名。

**全新安装：** 创建容器用户（UID/GID 10001）可写的目录，设置上述变量，再启动：

```bash
sudo mkdir -p /mnt/researchos-data
sudo chown 10001:10001 /mnt/researchos-data
docker compose up -d --build researchos
```

**已有安装：** 在修改 `.env` **之前**迁移数据。在项目根目录、仍使用原存储配置时执行：

```bash
scripts/backup.sh
docker compose stop researchos
sudo mkdir -p /mnt/researchos-data
# 目标目录应为空。复制整个 /data，包括图片和隐藏的密钥文件。
sudo docker compose cp researchos:/data/. /mnt/researchos-data/
sudo chown -R 10001:10001 /mnt/researchos-data
# 此时再向 .env 添加 RESEARCHOS_HOST_DATA_DIR=/mnt/researchos-data。
docker compose up -d --build researchos
```

检查运行中容器的挂载：

```bash
docker inspect "$(docker compose ps -q researchos)" \
  --format '{{range .Mounts}}{{if eq .Destination "/data"}}{{.Source}} -> {{.Destination}}{{end}}{{end}}'
```

预期输出为 `/mnt/researchos-data -> /data`。切换到空目录不会自动迁移原有账户和项目。
确认迁移后的系统正常再处理旧数据卷；重新构建容器会保留已挂载的数据。

### 管理员账户与密码

- **首次启动：** 数据库中尚无用户时，使用 `.env` 中的 `RESEARCHOS_ADMIN_PASSWORD`
  创建 `admin` 账户，之后可以从 `.env` 删除该密码。
- **修改或重置密码：** 在**设置 → 账户**中操作，或使用交互式命令：
  `docker compose exec researchos python -m app.cli set-password`。

系统不提供“在浏览器中创建初始管理员”的步骤，避免新实例被首个访问者认领。

## 使用流程

1. **添加项目**：点击**项目 → 新建项目**，或顶部的**新建**菜单，设置阶段、健康状态、
   优先级、投稿会议和投稿截止日期。
2. **定义里程碑**：为每个里程碑设置明确的完成标准。进度按“已完成 / 未取消的里程碑”计算；
   没有里程碑时显示“未设置”。
3. **跟踪任务**：在项目内使用看板或列表，也可在全局**任务**页面跨项目查看。
4. **登记实验**：按实验条件创建实验，例如在“世界模型消融”分组下创建“消融：无世界模型”，
   再按随机种子添加运行记录。人工确认结果后点击**标记为已验证**。
5. **记录进展**：在项目中点击**记录进展**，或让智能体通过 MCP 写入。

## API 令牌

进入**设置 → API 与 MCP 令牌 → 新建令牌**，选择**只读**或**读写**权限及有效期。
令牌（`ros_…`）只显示一次，数据库中仅保存哈希，可随时撤销。

也可使用命令行创建：

```bash
docker compose exec researchos python -m app.cli create-token <name> [--write] [--days 90]
```

REST 示例：

```bash
export RESEARCHOS_TOKEN=ros_...
curl -s http://127.0.0.1:8000/api/v1/projects -H "Authorization: Bearer $RESEARCHOS_TOKEN"
curl -s -X POST http://127.0.0.1:8000/api/v1/projects/1/progress \
  -H "Authorization: Bearer $RESEARCHOS_TOKEN" -H "Content-Type: application/json" \
  -d '{"summary": "完成 WBC 基座补偿；下一步：仿真消融实验"}'
```

交互式 API 文档：http://127.0.0.1:8000/api/docs

## 连接 Claude Code

```bash
export RESEARCHOS_TOKEN=ros_...      # 使用读写令牌
claude mcp add --transport http researchos http://127.0.0.1:8000/mcp \
  --header "Authorization: Bearer $RESEARCHOS_TOKEN"
claude mcp list
```

将 [`templates/CLAUDE.md`](templates/CLAUDE.md) 复制到研究仓库，并填写项目 slug。

## 连接 Codex

```bash
export RESEARCHOS_TOKEN=ros_...
codex mcp add researchos --url http://127.0.0.1:8000/mcp --bearer-token-env-var RESEARCHOS_TOKEN
codex mcp list
```

将 [`templates/AGENTS.md`](templates/AGENTS.md) 复制到研究仓库，并填写项目 slug。

完整指南、`.mcp.json` / `config.toml` 配置方式、stdio 模式及工具参考见
[MCP 集成文档](docs/mcp-integration.md)。

MCP 工具：`list_projects`、`get_project`、`query_work`、`upsert_task`、`upsert_milestone`、
`record_experiment`、`log_progress`、`update_project`。

## 备份与恢复

```bash
scripts/backup.sh                              # 在线备份，兼容 WAL，使用 SQLite 备份 API，保存到 ./backups/
scripts/restore.sh backups/researchos-<ts>.db   # 停止容器，保留恢复前的数据库副本
```

JSON 导出：**设置 → 导出 JSON**，或调用 `GET /api/v1/export`。
详细说明与定时备份示例见 [部署文档](docs/deployment.md#5-备份与恢复)。

## 升级与数据库迁移

更新代码或执行 `git pull` 后，运行 `scripts/update.sh`：备份 → 重新构建并启动容器 → 等待健康检查通过。

也可手动执行：

```bash
scripts/backup.sh
git pull && docker compose up -d --build     # 启动时自动执行 Alembic 迁移
docker compose exec researchos python -m app.cli db-version
```

如设置 `RESEARCHOS_AUTO_MIGRATE=false`，需手动运行 `python -m app.cli migrate`。
开发时，修改 `backend/app/models/entities.py` 后执行
`cd backend && .venv/bin/alembic revision --autogenerate -m "describe change"`，
检查 `backend/migrations/versions/` 中生成的迁移文件，再运行测试；模型与迁移不一致会导致测试失败。

## 本地开发（无需 Docker）

在项目根目录执行：

```bash
scripts/setup-dev.sh                                  # 首次安装：Python 虚拟环境和 npm 依赖
RESEARCHOS_ADMIN_PASSWORD='dev-password-123' scripts/dev.sh
# 后端 http://127.0.0.1:8000（自动重载）
# 前端 http://127.0.0.1:5173（Vite，代理 /api 和 /mcp）
```

依赖只需安装一次，日常迭代运行 `scripts/dev.sh` 即可，无需重新构建 Docker。
前端修改通过 Vite 自动更新，后端 Python 修改后自动重启，数据库迁移在后端启动时自动执行。

打开 **http://127.0.0.1:5173**，使用 `admin` 和上面的密码登录。
该密码仅用于初始化新数据库，已有账户仍使用原密码。本地数据默认存放于 `backend/data/`，
与 Docker 数据独立。按 `Ctrl+C` 停止开发服务。

### Docker 已占用 8000 端口时

可以保留 Docker 服务，在两个终端分别启动本地后端和前端，后端改用 8001 端口：

```bash
# 终端 1：从项目根目录执行
cd backend
RESEARCHOS_ADMIN_PASSWORD='dev-password-123' \
  .venv/bin/uvicorn app.main:create_app --factory --reload --host 127.0.0.1 --port 8001
```

```bash
# 终端 2：从项目根目录执行
cd frontend
RESEARCHOS_BACKEND=http://127.0.0.1:8001 npm run dev
```

仍通过 **http://127.0.0.1:5173** 访问界面，API 请求会转发到本地 8001 端口的后端。

### 测试

以下命令分别从项目根目录执行：

```bash
cd backend && .venv/bin/pytest -q                     # API、MCP 协议、迁移、备份、stdio
cd frontend && npm test                              # React Testing Library
cd frontend && npx tsc -b && npm run build            # 类型检查及生产构建
# 浏览器、REST、MCP 完整验收，包含 Docker 重启（需先运行 playwright install chromium）
scripts/acceptance-docker.sh
```

## 项目结构

```text
backend/   FastAPI（api/、services/、repositories/、models/、schemas/、mcp/、auth/、core/）、Alembic、测试
frontend/  React + TypeScript + Vite + Tailwind v4 + Radix（shadcn 风格）+ TanStack Query/Table
docs/      架构、MCP 集成、部署及用户指南
templates/ AGENTS.md（Codex）、CLAUDE.md（Claude Code），复制到研究仓库使用
scripts/   本地开发、依赖安装、备份与恢复、端到端验收
```

架构概览见 [架构文档](docs/architecture.md)。

## 安全说明

账户密码使用 Argon2id 哈希；会话使用 `HttpOnly` / `SameSite=Strict` Cookie 并结合 CSRF 令牌。
系统设置严格的 CSP，Bearer 令牌以哈希保存，支持权限范围、过期和撤销；默认请求体上限为 1 MB，
启用请求限流，默认绑定本机地址。通过 HTTPS 提供服务时设置 `RESEARCHOS_COOKIE_SECURE=true`，
不要将 8000 端口直接暴露到公网。

## 许可证

[MIT](LICENSE)
