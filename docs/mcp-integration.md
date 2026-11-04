# MCP 集成：Claude Code 与 Codex

通过 MCP 查询项目、更新任务、记录实验和进展。

| 项目 | 配置 |
|---|---|
| 传输 | Streamable HTTP；可选本机 stdio |
| 地址 | `https://<服务器地址>/mcp`；本机默认 `http://127.0.0.1:8000/mcp` |
| 认证 | `Authorization: Bearer <token>` |
| 权限 | 只读或读写；只读令牌调用写入工具会返回 `insufficient_scope` |
| 实现 | Python `mcp` SDK 2.3，`MCPServer`，无状态 JSON 响应 |

MCP 与网页、REST API 共用业务层，执行相同的权限校验和活动记录。
命令示例已按 Claude Code 2.1.316、Codex CLI 0.166.0 核对；HTTP 协议测试见 `backend/tests/test_mcp.py`。

## 1. 创建令牌

在 **设置 → 新建令牌** 中选择权限和有效期。名称包含 `claude` 或 `codex` 时，动态来源会自动标注。令牌仅显示一次。

在运行智能体的环境中设置：

```bash
# 可加入 ~/.zshrc 或 ~/.bashrc；不要提交到 Git
export RESEARCHOS_TOKEN="ros_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

也可在服务器创建：

```bash
docker compose exec researchos python -m app.cli create-token codex-vps --write --days 90
```

省略 `--write` 创建只读令牌。后续示例中的域名需替换为实际访问地址。

## 2. Claude Code

### 所有仓库共用

```bash
claude mcp add --transport http --scope user researchos https://research.example.com/mcp \
  --header "Authorization: Bearer $RESEARCHOS_TOKEN"
```

此命令将令牌值保存到 `~/.claude.json`。若希望配置文件只引用环境变量，使用下面的仓库配置。

### 单个仓库

在仓库根目录创建 `.mcp.json`：

```json
{
  "mcpServers": {
    "researchos": {
      "type": "http",
      "url": "https://research.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ${RESEARCHOS_TOKEN}",
        "X-ResearchOS-Source": "claude_code"
      }
    }
  }
}
```

Claude Code 从环境变量读取令牌；此文件不含令牌值，可提交到 Git。

### 检查 Claude Code 连接

```bash
claude mcp list
claude mcp get researchos
```

在会话中输入 `/mcp`，检查服务连接及工具列表。

## 3. Codex

### 注册服务

```bash
codex mcp add researchos --url https://research.example.com/mcp --bearer-token-env-var RESEARCHOS_TOKEN
```

对应的 `~/.codex/config.toml` 配置：

```toml
[mcp_servers.researchos]
url = "https://research.example.com/mcp"
bearer_token_env_var = "RESEARCHOS_TOKEN"
# 可选：明确标注动态来源
http_headers = { "X-ResearchOS-Source" = "codex" }
```

启动 Codex 的进程必须能读取 `RESEARCHOS_TOKEN`；仅在另一个终端设置变量不会传给已运行的应用。

### 检查 Codex 连接

```bash
codex mcp list
codex mcp get researchos
```

新开会话，在 CLI 中输入 `/mcp`，或发送：“用 researchos 列出我的项目。”

## 4. 仓库指令

将 [CLAUDE.md 模板](../templates/CLAUDE.md) 或 [AGENTS.md 模板](../templates/AGENTS.md) 复制到科研仓库根目录，填写项目短标识。也可设置 `RESEARCHOS_PROJECT` 供智能体参考。

模板约定：先读项目上下文，记录有效进展，使用稳定 ID 写入任务和实验；不自行验证结果，不上传密钥，服务不可用时继续本地工作。

示例指令：

- “列出所有受阻项目。”
- “记录今天的进展：完成 WBC 基座补偿，下一步做仿真消融。”
- “记录消融运行：去掉世界模型，seed 0，提交 abc1234，goal_rate 0.52。”
- “列出未来 7 天到期的未完成任务。”

## 5. 工具与权限

| 工具 | 类型 | 用途 |
|---|---|---|
| `list_projects` | 读取 | 查询项目阶段、健康度、进度、截止日期和阻塞；支持阶段、健康度、优先级和归档筛选 |
| `get_project` | 读取 | 按 ID 或短标识查询项目；`include` 可包含 `milestones`、`tasks`、`experiments`、`progress`、`deadlines` |
| `query_work` | 读取 | 跨项目查询任务、里程碑、实验和截止日期；支持状态、日期、优先级、关键词；默认查未完成项，最多 100 条 |
| `upsert_task` | 写入 | 按 `task_id` 或 `client_key` 创建或更新任务，仅修改传入字段；`project` 省略或传 `null` 表示无项目任务；支持 `start_date`（甘特图条形起点）和 `depends_on`（同项目前置任务 id 列表，整体替换，`[]` 清空；自依赖、跨项目、循环依赖会被拒绝） |
| `upsert_milestone` | 写入 | 创建或更新里程碑 |
| `record_experiment` | 写入 | 按 `experiment_key` 写入实验，可同时按 `external_run_id` 写入运行；新增结果为待审核 |
| `log_progress` | 写入 | 追加进展记录 |
| `update_project` | 写入 | 更新阶段、健康度、优先级、下一步、阻塞和投稿信息；完成项目需 `confirm=true` |

写入返回资源 ID 和 `summary`，并在动态中记录来源。

服务端限制：

- 智能体不能将实验或运行设为 `verified`。
- 修改已验证结果需 `confirm_overwrite_verified=true`，修改后回到待审核状态。
- 智能体完成或归档项目、改写已有研究问题或假设，需 `confirm=true`。
- 无项目任务共享独立的 `client_key` 去重范围。任务按 `(project_id, client_key)`、实验按 `(project_id, experiment_key)`、运行按 `(experiment_id, external_run_id)` 去重。
- 读取工具不写入数据；MCP 不提供实验或运行删除工具。

## 6. 本机 stdio 接入

智能体与数据库在同一台机器时，可通过 stdio 直接调用相同业务层。仍需有效令牌。SQLite WAL 支持与网页服务同时访问。

```bash
# Claude Code
claude mcp add researchos-local \
  -e RESEARCHOS_TOKEN=$RESEARCHOS_TOKEN \
  -e RESEARCHOS_DATA_DIR=/path/to/researchos/backend/data \
  -e PYTHONPATH=/path/to/researchos/backend \
  -- /path/to/researchos/backend/.venv/bin/python -m app.mcp.stdio

# Codex
codex mcp add researchos-local \
  --env RESEARCHOS_DATA_DIR=/path/to/researchos/backend/data \
  --env PYTHONPATH=/path/to/researchos/backend \
  --env RESEARCHOS_TOKEN=ros_... \
  -- /path/to/researchos/backend/.venv/bin/python -m app.mcp.stdio
```

Docker 部署优先使用 HTTP，数据库保存在容器数据卷中。

## 7. 排障

| 错误或现象 | 检查项 |
|---|---|
| `401` / `Bearer token required` | 令牌是否传入、过期或被撤销 |
| `insufficient_scope` | 是否使用读写令牌 |
| `421 Misdirected` | `RESEARCHOS_MCP_ALLOWED_HOSTS` 是否包含当前 Host |
| `429` | 请求频率是否超过 `RESEARCHOS_RATE_LIMIT_PER_MINUTE` |
| `not_found` | 用 `list_projects` 核对项目 ID 或短标识 |
| `validation_error` | 按错误提示检查必填字段和格式 |
| 网页未更新 | 手动刷新，并在“动态”中按来源查询；页面每 30 秒及切回窗口时自动刷新 |

检查 HTTP 握手：

```bash
curl -s https://research.example.com/mcp \
  -H "Authorization: Bearer $RESEARCHOS_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```
