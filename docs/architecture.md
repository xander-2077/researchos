# 架构

ResearchOS 由一个 ASGI 应用提供网页、REST API 和 MCP，共用业务层和 SQLite 数据库。

```text
浏览器（React）       脚本 / CI       Claude Code / Codex
Cookie + CSRF        Bearer 令牌     Bearer 令牌
       │                  │               │
       ▼                  ▼               ▼
FastAPI / uvicorn
├── /                前端静态文件（frontend/dist）
├── /api/v1/*        REST 路由
└── /mcp             MCP Streamable HTTP
                          │
                   Actor：身份、来源、权限
                          │
                   services/：业务逻辑
                   校验 → 修改 → 记录动态 → 提交事务
                          │
                   repositories/ + SQLAlchemy
                          │
                   SQLite（WAL、外键、busy_timeout）
                   /data/researchos.db
                   Alembic 管理数据库迁移
```

可选的 stdio 入口 `python -m app.mcp.stdio` 复用同一 MCP 服务和数据库。

## 后端目录

以下路径相对于 `backend/app`，迁移目录除外。

| 路径 | 职责 |
|---|---|
| `main.py` | 应用工厂；启动迁移、初始化管理员、注册中间件、路由和前端 |
| `core/` | `RESEARCHOS_*` 配置、枚举、业务错误和 ASGI 中间件 |
| `auth/actor.py` | 操作者身份：用户会话、令牌或系统，以及来源和权限 |
| `api/` | REST 薄适配层；`deps.py` 解析 Bearer 令牌或会话与 CSRF，生成 `Actor` |
| `mcp/server.py` | MCP 工具；验证令牌，在工作线程中调用业务层 |
| `services/` | 业务逻辑、权限校验、事务和活动记录 |
| `repositories/` | 查询、排序和分页工具，限制最大页大小 |
| `models/` | SQLAlchemy 模型和 UTC 时间戳类型 |
| `schemas/` | Pydantic 请求与响应模型；限制字段长度，拒绝未知字段 |
| `backend/migrations/` | Alembic 迁移，使用 SQLite 批处理模式 |
| `cli.py` | 密码、令牌、备份、恢复、导出和迁移命令 |

所有写入服务遵循：`actor.require_write()` → 校验 → 修改 → `log_event()` → `commit()`。REST 路由和 MCP 工具不直接写数据库。

## 数据模型

```text
Project（项目）
├── Milestone（里程碑）
├── Task（任务，可关联里程碑）
├── Experiment（实验）
│   └── ExperimentRun（运行）
└── ProgressEvent（只追加的动态）

User（管理员）
ApiToken（令牌哈希、权限、有效期、撤销状态）
```

| 实体 | 主要字段与约束 |
|---|---|
| 项目 | 唯一 `slug`、研究问题、假设、投稿信息、阶段、健康度、优先级、下一步、阻塞、笔记和链接；`archived` 为软删除，`version` 用于并发检查 |
| 里程碑 | 状态、截止日期、完成时间；项目进度为已完成数 ÷ 未取消总数，无里程碑时显示“未设置” |
| 任务 | 状态、优先级、截止日期、标签、Git 引用、里程碑；`client_key` 在项目内唯一；无项目任务按 `owner_id` 隔离，`client_key` 在所属用户内唯一，用于重复写入去重 |
| 实验 | 一个对照条件，`group_name` 关联同组实验；`experiment_key` 在项目内唯一 |
| 运行 | `external_run_id` 在实验内唯一；记录种子、Git 提交/分支、配置、指标、产物链接和验证状态 |
| 动态 | 时间、项目、事件类型、操作者、来源、摘要、详情和关联资源 |

实验状态：`planned → running → analyzing → needs_review → verified`，另有 `failed`、`cancelled`。
指标格式：`{name: {value, unit, description}}`。大文件仅保存路径或链接。
时间戳存为 UTC，界面按浏览器时区显示；截止日期为纯日期。

## 业务约束

| 规则 | 实现位置 |
|---|---|
| 智能体不能设置 `verified` | `services/experiments._forbid_agent_verify` |
| 修改已验证结果需确认 | `_apply_experiment_changes`、`_apply_run_changes` |
| 智能体完成/归档项目、改写已有研究问题或假设需 `confirm` | `services/projects.update_project` |
| 任务、实验、运行按稳定键去重 | 数据库唯一约束与更新查询 |
| 只读令牌不能写入 | `Actor.require_write()` |
| 智能体不能冒充手动操作 | `Actor.with_source` |
| 动态只追加 | 不提供事件修改或删除接口 |

## 认证与安全

- **浏览器**：多用户（管理员 / 普通成员），Argon2id 密码哈希；签名 Cookie 使用 `HttpOnly`、`SameSite=Strict`，HTTPS 下开启 `Secure`。修改请求必须携带 CSRF 令牌，不使用 API 令牌认证。
- **项目权限**：`services/access.py` 按成员关系限制数据、聚合和导出；创建者和管理员管理成员。用户邀请仅保存令牌哈希，7 天有效、一次性使用。停用账号使会话失效并撤销个人令牌。
- **API / MCP**：使用 `Bearer ros_…` 令牌，数据库只存 SHA-256 哈希；支持只读/读写权限、有效期、撤销和最近使用记录。令牌由浏览器会话或 CLI 管理。
- **网络**：默认绑定 `127.0.0.1`；远程访问使用 HTTPS 反向代理或 Tailscale，可配置 MCP Host 白名单防止 DNS 重绑定。
- **请求限制**：默认请求体上限 1 MB；按 IP 限流，登录限制更严格；REST 每页最多 200 条，MCP 最多 100 条。访问日志去除查询字符串。
- **中间件**：安全响应头、CSP、请求体大小限制、限流、签名会话及可选 CORS。

## 前端目录

路径相对于 `frontend/src`。

| 路径 | 职责 |
|---|---|
| `services/api.ts` | 统一请求入口：同源 Cookie、CSRF 请求头和 `ApiError` |
| `hooks/queries.ts` | TanStack Query 数据查询；通过 `useWrite` 写入、刷新缓存并提示结果；每 30 秒及窗口聚焦时刷新 |
| `components/ui/` | 基于 Radix 的基础组件、Tailwind v4 样式和明暗主题 |
| `components/layout/` | 侧栏、搜索、项目筛选、新建菜单和主题切换 |
| `features/` | 表单校验、项目卡片、任务列表/看板、实验记录和动态 |
| `pages/` | 总览、项目、实验、任务、时间线、动态、设置、帮助和登录页 |

帮助页在构建时打包 `docs/` 和 `templates/` 中的 Markdown 文件。

## 技术取舍

- **SQLite + WAL**：单文件存储，支持网页与 stdio 并发访问；使用 SQLite 备份接口生成一致快照。
- **无状态 MCP**：Streamable HTTP 返回 JSON，无需会话绑定，便于反向代理。
- **同步 SQLAlchemy**：MCP 将数据库操作放入工作线程，避免阻塞事件循环。
- **单进程部署**：不依赖 Redis、消息队列或后台任务服务。
- **扩展方式**：GitHub、W&B 等后续集成应通过现有业务层写入；实验比较可复用 `metric_summary`。这些集成尚未实现。
