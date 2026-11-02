# Architecture

ResearchOS is a single-process, single-database application. One ASGI app serves the web UI,
the REST API and the MCP endpoint; all three share one service layer and one SQLite file.

```
 Browser (React SPA)        Scripts / CI              Claude Code · Codex
   cookie session + CSRF      Bearer token              Bearer token
        │                        │                          │
        ▼                        ▼                          ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ FastAPI app (uvicorn)                                               │
 │  middleware: security headers · body-size limit · rate limit ·      │
 │              signed session cookie · (optional) CORS                │
 │                                                                     │
 │  /            static SPA (frontend/dist)                            │
 │  /api/v1/*    REST routers  ──┐                                     │
 │  /mcp         MCP Streamable HTTP (MCPServer, stateless JSON) ──┐   │
 │                               │  Actor (who, source, scopes)     │   │
 │                               ▼                                  ▼   │
 │               services/  (validation · permissions · transactions │   │
 │                           · activity logging · integrity rules)   │   │
 │                               │                                      │
 │               repositories/ + SQLAlchemy 2 models                    │
 └───────────────────────────────┼──────────────────────────────────────┘
                                 ▼
                     SQLite (WAL, busy_timeout, FK on)  ← Alembic migrations
                     /data/researchos.db (Docker volume)
```

The optional **stdio** MCP adapter (`python -m app.mcp.stdio`) imports the very same `MCPServer`
and services and opens the same database file; it is not a second implementation.

## Backend layout (`backend/app`)

| Path | Responsibility |
|---|---|
| `main.py` | App factory: migrations on start, admin bootstrap, middleware, routers, MCP route, SPA. |
| `core/` | Settings (`RESEARCHOS_*` env), enums, domain errors, ASGI middlewares. |
| `auth/actor.py` | `Actor` = who performs an operation (`user` session, `token`, `system`), source, scopes. |
| `api/` | Thin REST routers → services. `deps.py` turns a request into an `Actor` (Bearer or session+CSRF). |
| `mcp/server.py` | 8 MCP tools. Each tool authenticates the bearer token from the request headers and calls services in a worker thread. |
| `services/` | All business logic. Every mutating function: `actor.require_write()` → validate → change → `log_event(...)` → `commit()`. |
| `repositories/` | Shared lookup/sort/pagination helpers with hard page-size caps. |
| `models/` | SQLAlchemy models; UTC-aware timestamp type. |
| `schemas/` | Pydantic v2 request/response models (`extra="forbid"`, length limits). |
| `migrations/` | Alembic (batch mode for SQLite). |
| `cli.py` | Admin password, tokens, backup/restore, export, seed, migrate. |

## Data model

```
Project 1─* Milestone
   │  1─* Task ── (optional) Milestone
   │  1─* Experiment 1─* ExperimentRun
   │  1─* ProgressEvent (append-only activity log)
User (single admin)      ApiToken (sha256 hash, scopes, expiry, revocation)
```

* **Project** – slug (unique), research question, hypothesis, venue, submission deadline, stage,
  health, priority, next action, blocker summary, Markdown notes, external links (JSON),
  `archived` (soft delete), `version` (optimistic concurrency for UI edits).
* **Milestone** – status (`planned/in_progress/completed/cancelled`), due date, completion time.
  Portfolio progress = completed ÷ non-cancelled milestones; without milestones the UI shows
  “Not set” instead of a made-up percentage.
* **Task** – status, priority, due date, tags, git reference, milestone, optional `client_key`
  (unique per project) for idempotent agent writes.
* **Experiment** – one condition; `group_name` groups an ablation study; `experiment_key`
  unique per project; status lifecycle `planned → running → analyzing → needs_review → verified`
  (or `failed/cancelled`).
* **ExperimentRun** – one execution: `external_run_id` (unique per experiment), seed, git
  commit/branch, config JSON, metrics JSON `{name: {value, unit, description}}`, artifact links,
  verification status. Large artifacts are never stored — only URLs/paths.
* **ProgressEvent** – timestamp, project, event type, actor, **source**
  (`manual / claude_code / codex / rest_api / mcp / system`), summary, details, related resource.

## Integrity rules (service layer)

| Rule | Where |
|---|---|
| Only human sessions may set `verified` | `services/experiments._forbid_agent_verify` |
| Verified results can't be silently overwritten by agents | `_apply_experiment_changes`, `_apply_run_changes` |
| High-impact project changes by agents need `confirm` | `services/projects.update_project` |
| Run/task idempotency | DB unique constraints + upsert lookups |
| Read-only tokens can't write | `Actor.require_write()` in every mutating service |
| Agents can't impersonate `manual` | `Actor.with_source` |
| Activity is append-only | No update/delete API for events |

## Security model

* **Browser**: single admin user, Argon2id password hash, signed `HttpOnly` + `SameSite=Strict`
  session cookie (`Secure` when `RESEARCHOS_COOKIE_SECURE=true`), CSRF token required on every
  unsafe request, strict CSP, no API tokens in the browser.
* **API/MCP**: `Bearer ros_…` tokens; only SHA-256 hashes stored; read vs read/write scopes,
  expiry, revocation, last-used tracking. Tokens are managed only from a browser session or CLI.
* **Transport**: binds to `127.0.0.1` by default; remote access via HTTPS reverse proxy or
  Tailscale. Optional MCP Host allow-list (DNS-rebinding protection).
* **Abuse limits**: 1 MB request bodies, per-IP rate limit (stricter for login), page size ≤ 200
  (REST) / ≤ 100 (MCP), access logs strip query strings.

## Frontend layout (`frontend/src`)

| Path | Responsibility |
|---|---|
| `services/api.ts` | Fetch wrapper (same-origin cookies, CSRF header, uniform `ApiError`). |
| `hooks/queries.ts` | TanStack Query hooks; every mutation invalidates research queries and toasts. Data refreshes every 30 s and on focus, so agent writes appear without reload. |
| `components/ui/` | shadcn-style primitives on Radix (dialog, dropdown, tabs) + Tailwind v4 tokens (light/dark). |
| `components/layout/` | Sidebar (collapsible), header (search ⌘K, project filter, New menu, theme). |
| `features/` | Forms (zod validation), project cards/tables, task table/kanban, experiment registry, activity timeline. |
| `pages/` | Overview, Projects, Project detail (6 tabs), Experiments (+detail), Tasks, Timeline, Activity, Settings, Login. |

## Key decisions

* **SQLite + WAL** – one file, trivially backed up; WAL allows the stdio adapter and web server
  concurrently. Backups use the SQLite backup API.
* **Stateless MCP over Streamable HTTP with JSON responses** – no session affinity, simplest to
  proxy; tools are short request/response operations.
* **Sync SQLAlchemy** – simple; MCP tools offload DB work to a thread so the event loop stays free.
* **No background workers, Redis, queues** – nothing in the MVP needs them.
* **Extension points** (not implemented): GitHub/W&B integrations would be new services writing
  through the same service layer with `source="system"`; comparison views can be built on the
  existing `metric_summary`.
