# AGENTS.md — working on the ResearchOS codebase

(For instructions to put into *research* repositories, see `templates/AGENTS.md` and
`templates/CLAUDE.md`.)

## Layout

- `backend/app` — FastAPI. **All business logic lives in `services/`**; REST routers (`api/`) and
  MCP tools (`mcp/server.py`) are thin adapters that build an `Actor` and call services. Never
  write to the database from a router or MCP tool directly.
- `backend/migrations` — Alembic. Any model change needs a migration
  (`.venv/bin/alembic revision --autogenerate -m "..."`); `tests/test_ops.py` fails on drift.
- `frontend/src` — React/TS. API calls only through `services/api.ts`; data via hooks in
  `hooks/queries.ts`; mutations through `useWrite` (invalidates + toasts).

## Invariants to keep

- Every mutating service: `actor.require_write()` → validate → change → `log_event` → `commit`.
- Agents (token actors) can never set `verified`; verified data needs `confirm_overwrite_verified`.
- Idempotency keys: `(experiment_id, external_run_id)`, `(project_id, client_key)`,
  `(project_id, experiment_key)`.
- List endpoints are paginated and capped (`max_page_size`, MCP ≤ 100).
- Timestamps are UTC in the DB; the UI formats in the browser's timezone. Due dates are plain dates.
- No secrets in logs, no API tokens in the browser.

## Commands

```bash
cd backend && .venv/bin/pytest -q
cd frontend && npx tsc -b && npm test && npm run build
scripts/acceptance-docker.sh      # optional, slow: Docker + Playwright end-to-end
```

Keep it simple: no extra services (Redis, queues, search clusters). Prefer extending existing
services over adding new layers.
