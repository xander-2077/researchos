# MCP integration: Claude Code & OpenAI Codex

ResearchOS exposes a **Model Context Protocol** server so coding agents can read and update your
research state from whatever repository they are working in.

| | |
|---|---|
| Transport | **Streamable HTTP** (primary), stdio (optional, local only) |
| Endpoint | `https://<your-host>/mcp` (local default: `http://127.0.0.1:8000/mcp`) |
| Auth | `Authorization: Bearer <token>` — create tokens in **Settings → API & MCP tokens** |
| Scopes | *Read only* or *Read / Write*. Read-only tokens get `insufficient_scope` on every write tool. |
| SDK | Official `mcp` Python SDK 2.3 (`MCPServer`, the successor of FastMCP), stateless JSON responses |

The MCP tools call the **same service layer** as the REST API and the web UI, so validation,
permission checks and activity logging are identical everywhere.

> Verified against **Claude Code 2.1.316** and **Codex CLI 0.166.0** (`claude mcp add --help`,
> `codex mcp add --help`). The protocol itself is covered by automated tests that use the official
> MCP client over real HTTP (`backend/tests/test_mcp.py`).

---

## 1. Create a token

1. Open ResearchOS → **Settings** → **New token**.
2. Name it after the agent and machine, e.g. `claude-code-macbook` or `codex-vps`.
   Token names containing `claude` / `codex` automatically set the activity *Source* to
   *Claude Code* / *Codex* (you can also send the header `X-ResearchOS-Source: claude_code|codex`).
3. Choose **Read / Write** (or *Read only* for query-only agents) and an expiry.
4. Copy the token (`ros_…`) — it is shown **once**. Put it in an environment variable:

```bash
# ~/.zshrc or ~/.bashrc (never commit tokens to git)
export RESEARCHOS_TOKEN="ros_xxxxxxxxxxxxxxxxxxxxxxxxxxxx"
```

CLI alternative (on the server): `python -m app.cli create-token claude-code-macbook --write`
(Docker: `docker compose exec researchos python -m app.cli create-token claude-code-macbook --write`).

---

## 2. Claude Code

### Option A — user-wide (all repositories)

```bash
claude mcp add --transport http --scope user researchos https://research.example.com/mcp \
  --header "Authorization: Bearer $RESEARCHOS_TOKEN"
```

Note: this stores the expanded token value in your user config (`~/.claude.json`). To keep the
token out of config files, use the project file below with `${RESEARCHOS_TOKEN}` expansion.

### Option B — per repository (`.mcp.json`, safe to commit)

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

Claude Code expands `${RESEARCHOS_TOKEN}` from the environment, so the file contains no secret.

### Verify

```bash
claude mcp list          # researchos … ✓ Connected
claude mcp get researchos
```

Inside a session, `/mcp` shows the server and its 8 tools.

### Example prompts

- “List my ResearchOS projects and tell me which ones are blocked.” → `list_projects`
- “Record today's progress on humanoid-wbm: finished the WBC base-compensation module; next is the
  simulation ablation.” → `log_progress`
- “Record this ablation run (no world model, seed 0, commit `abc1234`, goal_rate 0.52) in
  quadruped-soccer.” → `record_experiment`
- “What unfinished tasks are due in the next 7 days across all projects?” → `query_work`

---

## 3. OpenAI Codex (CLI / IDE)

### Register the server

```bash
codex mcp add researchos --url https://research.example.com/mcp --bearer-token-env-var RESEARCHOS_TOKEN
```

This writes to `~/.codex/config.toml`:

```toml
[mcp_servers.researchos]
url = "https://research.example.com/mcp"
bearer_token_env_var = "RESEARCHOS_TOKEN"
# optional: tag activity explicitly (otherwise inferred from the token name)
http_headers = { "X-ResearchOS-Source" = "codex" }
```

Codex reads the token from `RESEARCHOS_TOKEN` at runtime; the config file holds no secret.

### Verify

```bash
codex mcp list             # researchos  https://…/mcp  RESEARCHOS_TOKEN  enabled  Bearer token
codex mcp get researchos
```

Then start `codex` and type `/mcp` to see the connected tools, or ask:
“Use researchos to list my projects.”

---

## 4. Tell the agent *when* to use it

Copy the templates into each research repository and set the project slug:

- `templates/CLAUDE.md` → `<repo>/CLAUDE.md` (Claude Code)
- `templates/AGENTS.md` → `<repo>/AGENTS.md` (Codex)

Both say: read context first, log meaningful progress, record experiments with stable ids, never
mark results verified, don't spam tiny edits, never overwrite confirmed conclusions, don't block
coding when ResearchOS is down, and never send secrets. The project can also be set per shell via
`export RESEARCHOS_PROJECT=quadruped-soccer`.

---

## 5. Tool reference

| Tool | Kind | Purpose |
|---|---|---|
| `list_projects` | read | Portfolio: stage, health, milestone progress, next deadline, next action, blockers. Filters: `stage`, `health_status`, `priority`, `archived`. |
| `get_project` | read | One project by id or slug. Concise by default; `include` any of `milestones`, `tasks`, `experiments`, `progress`, `deadlines`. |
| `query_work` | read | Cross-project query for `task` / `milestone` / `experiment` / `deadline` with `project`, `status`, `due_before`, `due_after`, `priority`, `keyword`, `limit` (≤100). Defaults to unfinished items. |
| `upsert_task` | write, idempotent | Create or update a task (by `task_id` or `client_key`). Only passed fields change. |
| `upsert_milestone` | write, idempotent | Create or update a milestone. |
| `record_experiment` | write, idempotent | Upsert experiment (`experiment_key`) + optional run (`external_run_id`) atomically. New results → `needs_review`. |
| `log_progress` | write, append-only | Add a progress note to the research log. |
| `update_project` | write | Stage, health, priority, next action, blockers, venue, deadline. `research_stage="completed"` requires `confirm=true`. |

Every write returns the resource ids and a human-readable `summary`, and is recorded in the
Activity log with the source (*Claude Code*, *Codex*, *MCP agent*).

### Safety guarantees (enforced server-side, not just by prompts)

- Agents **cannot** set `verified` on experiments or runs (`verification_requires_human`).
- Changing a verified experiment/run requires `confirm_overwrite_verified=true` and drops it back
  to `needs_review` (`verified_protected`).
- Completing/archiving a project or changing its research question/hypothesis requires
  `confirm=true` (`confirmation_required`).
- Runs are unique per `(experiment, external_run_id)`; tasks per `(project, client_key)`.
- Query tools never write; result sizes are capped.
- Agents cannot delete experiments or runs (UI only).

### Errors

Errors come back as tool errors with a code and a fix hint, e.g.
`[insufficient_scope] This token is read-only…`, `[not_found] Project 'x' not found. Use list_projects…`,
`[validation_error] external_run_id is required when recording run data…`.

---

## 6. stdio transport (optional, same machine only)

For an agent on the same machine as the database, the stdio adapter runs the same MCP server and
services directly against the SQLite file (WAL mode allows this alongside the web server). It
still requires a valid token so scopes and audit logging apply.

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

With Docker deployments prefer HTTP (`http://127.0.0.1:8000/mcp`) — the database lives in a volume.

## 7. Troubleshooting

| Symptom | Fix |
|---|---|
| `401` / “Bearer token required” | Token env var not set in the agent's environment, revoked or expired. |
| `insufficient_scope` | Token is read-only; create a Read/Write token. |
| `421 Misdirected` / host rejected | `RESEARCHOS_MCP_ALLOWED_HOSTS` is set and doesn't include the Host you use. |
| `429` | Rate limit (`RESEARCHOS_RATE_LIMIT_PER_MINUTE`). |
| Agent writes don't appear in UI | The UI refreshes every 30 s and on focus; reload. Check *Activity* filtered by source. |

Manual check with curl:

```bash
curl -s https://research.example.com/mcp \
  -H "Authorization: Bearer $RESEARCHOS_TOKEN" \
  -H "Content-Type: application/json" -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'
```
