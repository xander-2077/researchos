# ResearchOS user guide

ResearchOS is a self-hosted research workbench: manage projects, milestones, tasks and
experiments in the browser, and let Claude Code or Codex read and update them over MCP.

> This is the quick guide. Detailed references are listed on the left: MCP integration,
> deployment, architecture, and the agent instruction templates.

## 1. Concepts

| Concept | Meaning |
|---|---|
| **Project** | A paper or research thread: research question, hypothesis, venue, submission deadline, stage, health, priority, next action, blockers. |
| **Stage** | Ideation → Research Design → Implementation → Experimentation → Analysis → Writing → Submission → Revision → Completed (or On Hold). |
| **Health** | On Track / At Risk / Blocked. “Blocked Projects” on the overview counts *Blocked*. |
| **Milestone** | A checkpoint with a clear completion criterion. Progress = completed / non-cancelled milestones; without milestones the UI shows “Not set” rather than a made-up percentage. |
| **Task** | A concrete to-do; optional milestone, priority, deadline, tags, git reference. |
| **Experiment** | One condition (e.g. “Ablation: no world model”). Use **Group** to keep an ablation study together. |
| **Run** | One execution of an experiment (seed/config): commit, config, metrics, artifact links, verification status. |
| **Activity** | Append-only research log: progress notes plus every important change, with its source (Manual, Claude Code, Codex, REST API, System). |

## 2. Daily use

### Overview

- Five summary cards: active projects, open tasks, running experiments, deadlines in 14 days, blocked projects.
- All projects as cards or a table, filterable by stage, priority and health, with sorting.
- Upcoming deadlines, recent research activity and experiments needing review.

### Creating and editing

- **New** menu (top right): project, task, experiment, progress note.
- The three selects at the top of a project change **stage / health / priority** in place.
- Project tabs: Overview, Milestones (with timeline), Tasks (Kanban/List), Experiments, Activity, Notes (Markdown + external links).
- Kanban: drag cards with the mouse; on touch screens drag by the ⋮⋮ grip, or use the status select on the card.

### Cross-project views

- **Tasks**: presets (Open, Top priority, Due in 7 days, Overdue, Blocked, All) plus status/priority/date/keyword filters; overdue rows are highlighted.
- **Projects**: drag cards to set their order (touch: use the grip; keyboard: focus the grip and press the arrow keys). The order is shared by the overview, the sidebar and agents (`GET /projects` defaults to `sort=manual`). Click a project's icon (project page or edit dialog) to pick an icon and colour from the built-in research icon library.
- **Kanban**: drag cards between columns to change status and within a column to reorder (grip + ↑/↓ on the keyboard).
- **Gantt** (Timeline page, default; also a *Gantt* tab on every project): tasks as bars grouped by project, with milestones, submission deadlines, a today line and finish-to-start dependency arrows (red = a task starts before its prerequisite finishes). Drag a bar to reschedule it, drag its edges to resize, or use the keyboard (←/→ move, Shift+←/→ change the end date, Enter edit). Set a task's **Start date** and **Depends on** in the task form. Zoom: day / week / month.
- **Timeline**: per-project near-term timeline, or switch to **Calendar** for a month view of submissions, milestones and task due dates.
- **Activity**: filter by project, source, event type and time.
- **Global search** (⌘K / Ctrl+K) across projects, tasks and experiments.

## 3. Recording experiments well

1. One experiment per condition, all conditions of a study in the same **group**.
2. One **run** per seed/config with a stable run ID (W&B id or `<commit>-seed0`), seed, commit, metrics with units.
   Re-using a run ID updates that run instead of duplicating it.
3. Lists and detail pages show **mean ± std** per metric across runs.
4. After checking the evidence, click **Mark verified**. Agents can only record results as *Needs Review*
   and cannot change verified results without explicit confirmation.
5. Don't upload checkpoints, videos or raw logs — store paths/URLs.

## 4. Connect Claude Code / Codex

1. **Settings → New token**, *Read / Write*. Include `claude` or `codex` in the name to tag the activity source. The token is shown once.
2. On the agent's machine: `export RESEARCHOS_TOKEN=ros_...`
3. Register the server (use the address you reach ResearchOS at, e.g. your Tailscale URL):

```bash
claude mcp add --transport http researchos https://<your-host>/mcp \
  --header "Authorization: Bearer $RESEARCHOS_TOKEN"
codex mcp add researchos --url https://<your-host>/mcp --bearer-token-env-var RESEARCHOS_TOKEN
```

4. Copy the [CLAUDE.md template](../templates/CLAUDE.md) or [AGENTS.md template](../templates/AGENTS.md) into your research repo and set the project slug.

Full details: [MCP integration](mcp-integration.md).

## 5. Remote access (Tailscale)

```bash
docker compose --profile tailscale up -d
docker compose logs tailscale        # first start: open the login URL printed here
```

Then open `https://researchos.<your-tailnet>.ts.net` from any device in your tailnet. Enable **MagicDNS**
and **HTTPS Certificates** in the Tailscale admin console once. See [deployment](deployment.md#方案-atailscale-内网-https).

## 6. Backup & upgrade

```bash
scripts/backup.sh
scripts/restore.sh backups/researchos-<ts>.db
git pull && docker compose up -d --build       # migrations run automatically
```

**Settings → Data → Export JSON** exports everything as JSON.

## 7. FAQ

| Problem | Fix |
|---|---|
| Agent writes don't show up | The UI refreshes every 30 s and on focus; reload, or filter Activity by source. |
| `insufficient_scope` | The token is read-only; create a Read/Write token. |
| `confirmation_required` / `verified_protected` | Safety guard: completing/archiving a project or changing verified results needs your explicit OK. |
| Forgot admin password | `docker compose exec researchos python -m app.cli set-password` |
| Change language | Language button in the header, or Settings → Appearance. |
