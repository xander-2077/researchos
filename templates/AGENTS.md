<!--
ResearchOS agent instructions — template for OpenAI Codex (AGENTS.md).
Copy this file into the root of a research repository and edit the "Project" section.
The same rules are in templates/CLAUDE.md for Claude Code.
-->

# Research tracking with ResearchOS

This repository belongs to a research project tracked in **ResearchOS**, available to you as the
MCP server `researchos` (tools: `list_projects`, `get_project`, `query_work`, `upsert_task`,
`upsert_milestone`, `record_experiment`, `log_progress`, `update_project`).

## Project

- ResearchOS project: `quadruped-soccer`  <!-- slug or numeric id; edit me -->
- Alternatively read it from the environment variable `RESEARCHOS_PROJECT` if set
  (it takes precedence over the value above).

## When to use ResearchOS

1. **Before starting substantial work**, you may call `get_project` (with
   `include: ["tasks", "experiments", "progress"]`) to load the current goals, open tasks,
   recent experiments and blockers. Prefer this over guessing from old conversations.
2. **After work with real research value** (a module finished, a bug that changed results fixed,
   an experiment launched or analysed, a decision made), call `log_progress` once with a 1–2
   sentence `summary` and optional Markdown `details` (what changed, evidence, next step).
3. **When you have experiment results**, call `record_experiment` with a stable `experiment_key`
   and a stable `external_run_id` (W&B/MLflow run id, or `<git_commit>-seed<seed>`), plus
   `seed`, `git_commit`, `config` (key hyper-parameters only) and `metrics` taken directly from
   logs or result files. Repeating the call with the same ids updates instead of duplicating.
4. **When a task's state changes**, call `upsert_task` (by `task_id`, or with your own
   `client_key` for tasks you create) and pass only the fields that changed.

## Rules

5. Only submit results that are backed by evidence you actually observed (log output, metric
   files, plots). **Never invent or estimate numbers.** If something is uncertain, say so in
   `details`.
6. Code that runs successfully is **not** a verified scientific result. Never try to mark an
   experiment or run as `verified`; leave results in `needs_review` for the researcher.
7. Do not log every small edit, refactor or formatting change. Aim for at most a few
   `log_progress` entries per working session.
8. Never overwrite conclusions the user has confirmed. If a tool returns `verified_protected` or
   `confirmation_required`, stop and ask the user; only retry with
   `confirm_overwrite_verified=true` / `confirm=true` after they explicitly agree.
9. If ResearchOS is unreachable or a call fails, mention it briefly and **continue the main
   coding task** — tracking must never block development.
10. Never send secrets, tokens, credentials, private keys, personal data or raw sensitive datasets
    to ResearchOS. Store only metadata, paths and URLs (not checkpoints, videos or raw logs).
