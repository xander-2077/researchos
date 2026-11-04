# ResearchOS

**A self-hosted, AI-native research portfolio dashboard.** Manage several papers, robot-learning
experiments and research-software projects in one place — through a clean web UI, a REST API,
and an MCP server that Claude Code and OpenAI Codex can use from inside your repositories.

- **Portfolio dashboard** – every project's stage, health, milestone progress, next deadline,
  open tasks, blockers and last activity on one page (cards or table).
- **Project workspace** – research question, hypothesis, venue, deadline; milestones with
  timeline; tasks as Kanban or list; experiments; activity; Markdown notes and doc links.
- **Experiment registry** – experiments grouped into ablation studies, each with multiple runs
  (seeds/configs), git commit, config, metrics with units, artifact links, verification status
  and mean ± std across runs.
- **Cross-project views** – global tasks (blocked / due this week / overdue / top priority),
  timeline of submissions, milestones and task deadlines, and an activity log with sources.
- **Agent-first API** – REST (`/api/v1`, OpenAPI at `/api/docs`) and MCP (`/mcp`, Streamable HTTP)
  sharing one service layer; idempotent writes, read-only vs read/write tokens, audit trail.
- **Research integrity built in** – agents can't mark results *verified*, can't silently
  overwrite verified conclusions, and need explicit confirmation for high-impact changes.
- **Simple to run** – one container, one SQLite file, no paid services.

> ResearchOS records, shows and queries research state. It does not run agents, schedule GPU
> jobs or replace W&B/MLflow.

---

## Quick start (Docker)

```bash
git clone <your-repo-url> researchos && cd researchos
cp .env.example .env
#   edit .env → RESEARCHOS_ADMIN_PASSWORD=<a long password, ≥10 chars>
docker compose up -d --build
```

Open **http://127.0.0.1:8000** and sign in as `admin` with that password.
The service listens on localhost only. For private remote access from your laptop/phone, enable
the bundled Tailscale sidecar (HTTPS inside your tailnet, no open ports):

```bash
docker compose --profile tailscale up -d
docker compose logs tailscale | grep -A1 "To authenticate"   # approve once
# → https://researchos.<your-tailnet>.ts.net
```

See [docs/deployment.md](docs/deployment.md) for details, Caddy/nginx and VPS setups.

**In-app help:** the **Help** page (bottom of the sidebar) shows the user
guide (English / 简体中文), MCP integration, deployment, architecture and the CLAUDE.md /
AGENTS.md templates with copy/download buttons.

Optional demo data (three fictional projects): `docker compose exec researchos python -m app.cli seed-demo`
(only works on an empty database).

### Admin credentials

- **First start:** `RESEARCHOS_ADMIN_PASSWORD` in `.env` creates the `admin` user if no user
  exists yet. You can remove it from `.env` afterwards.
- **Change / reset:** Settings → Account in the UI, or
  `docker compose exec researchos python -m app.cli set-password` (interactive).

There is deliberately no “create admin in the browser” step, so a freshly started instance is
never claimable by whoever reaches it first.

## Using it

1. **Add a project** – *Projects → New project* (or the **New** menu in the header). Set stage,
   health, priority, venue and submission deadline.
2. **Define milestones** with clear completion criteria – the progress bar is
   `completed / non-cancelled milestones`; with none it shows “Not set”, never a fake percentage.
3. **Track tasks** per project (Kanban/List) or across projects (*Tasks*).
4. **Register experiments** – create an experiment per condition (e.g. “Ablation: no world model”,
   group “World-model ablations”), then add runs per seed. Verify results yourself with
   *Mark verified*.
5. **Log progress** – *Log progress* on a project, or let your agent do it via MCP.

## API tokens

*Settings → API & MCP tokens → New token*. Choose **Read only** or **Read / Write** and an expiry.
The token (`ros_…`) is shown once and stored only as a hash. Revoke any time.

CLI alternative: `docker compose exec researchos python -m app.cli create-token <name> [--write] [--days 90]`.

REST example:

```bash
export RESEARCHOS_TOKEN=ros_...
curl -s http://127.0.0.1:8000/api/v1/projects -H "Authorization: Bearer $RESEARCHOS_TOKEN"
curl -s -X POST http://127.0.0.1:8000/api/v1/projects/1/progress \
  -H "Authorization: Bearer $RESEARCHOS_TOKEN" -H "Content-Type: application/json" \
  -d '{"summary": "Finished WBC base compensation; next: simulation ablations"}'
```

Interactive API docs: http://127.0.0.1:8000/api/docs

## Connect Claude Code

```bash
export RESEARCHOS_TOKEN=ros_...      # a Read/Write token
claude mcp add --transport http researchos http://127.0.0.1:8000/mcp \
  --header "Authorization: Bearer $RESEARCHOS_TOKEN"
claude mcp list
```

Copy [`templates/CLAUDE.md`](templates/CLAUDE.md) into your research repo and set the project slug.

## Connect Codex

```bash
export RESEARCHOS_TOKEN=ros_...
codex mcp add researchos --url http://127.0.0.1:8000/mcp --bearer-token-env-var RESEARCHOS_TOKEN
codex mcp list
```

Copy [`templates/AGENTS.md`](templates/AGENTS.md) into your research repo and set the project slug.

Full guide, `.mcp.json` / `config.toml` variants, stdio mode and the tool reference:
[docs/mcp-integration.md](docs/mcp-integration.md).

MCP tools: `list_projects`, `get_project`, `query_work`, `upsert_task`, `upsert_milestone`,
`record_experiment`, `log_progress`, `update_project`.

## Backup & restore

```bash
scripts/backup.sh                               # online, WAL-safe (SQLite backup API) → ./backups/
scripts/restore.sh backups/researchos-<ts>.db   # stops the container, keeps a pre-restore copy
```

JSON export: *Settings → Export JSON* or `GET /api/v1/export`. Details and cron example in
[docs/deployment.md](docs/deployment.md#5-备份与恢复).

## Upgrading / database migrations

After any code change (or `git pull`): `scripts/update.sh` (backup → `docker compose up -d --build` → wait until healthy).

```bash
scripts/backup.sh
git pull && docker compose up -d --build     # Alembic migrations run automatically on start
docker compose exec researchos python -m app.cli db-version
```

Set `RESEARCHOS_AUTO_MIGRATE=false` to run `python -m app.cli migrate` manually instead.
For developers: change models in `backend/app/models/entities.py`, then
`cd backend && .venv/bin/alembic revision --autogenerate -m "describe change"`, review the file
in `backend/migrations/versions/`, and run the tests (a test fails if models and migrations drift).

## Development

```bash
scripts/setup-dev.sh                                  # Python venv + npm ci
RESEARCHOS_ADMIN_PASSWORD='dev-password-123' scripts/dev.sh
# API http://127.0.0.1:8000 (reload) · UI http://127.0.0.1:5173 (Vite, proxies /api and /mcp)
```

Tests:

```bash
cd backend && .venv/bin/pytest -q                     # API, MCP protocol, migrations, backup, stdio
cd frontend && npm test                                # React Testing Library
cd frontend && npx tsc -b && npm run build             # type check + production build
# Full browser + REST + MCP acceptance incl. Docker restart (needs: playwright install chromium)
scripts/acceptance-docker.sh
```

## Project layout

```
backend/   FastAPI app (api/, services/, repositories/, models/, schemas/, mcp/, auth/, core/), Alembic, tests
frontend/  React + TypeScript + Vite + Tailwind v4 + Radix (shadcn-style) + TanStack Query/Table
docs/      architecture.md · mcp-integration.md · deployment.md
templates/ AGENTS.md (Codex) · CLAUDE.md (Claude Code) — copy into research repos
scripts/   dev, setup, backup/restore, end-to-end acceptance
```

Architecture overview: [docs/architecture.md](docs/architecture.md).

## Security notes

Single admin user (Argon2id), `HttpOnly`/`SameSite=Strict` session cookie + CSRF token, strict
CSP, hashed bearer tokens with scopes/expiry/revocation, 1 MB body limit, rate limiting,
localhost binding by default. Set `RESEARCHOS_COOKIE_SECURE=true` behind HTTPS. Don't expose
port 8000 directly to the internet.

## License

[MIT](LICENSE)
