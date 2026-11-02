<!--
ResearchOS agent instructions — template for Claude Code (CLAUDE.md).
Copy this file into the root of a research repository (or append it to an existing CLAUDE.md)
and edit the "Project" section. The same rules are in templates/AGENTS.md for Codex.
-->

# Research tracking with ResearchOS

This repository belongs to a research project tracked in **ResearchOS**, connected as the MCP
server `researchos` (tools: `list_projects`, `get_project`, `query_work`, `upsert_task`,
`upsert_milestone`, `record_experiment`, `log_progress`, `update_project`).

## Project

- ResearchOS project: `humanoid-wbm`  <!-- slug or numeric id; edit me -->
- If the environment variable `RESEARCHOS_PROJECT` is set, use that instead.

## When to use ResearchOS

1. **Before starting substantial work**, you may call `get_project` with
   `include: ["tasks", "experiments", "progress"]` to load goals, open tasks, recent experiments
   and blockers. ResearchOS is the source of truth — not memory of earlier sessions.
2. **After work with real research value** (a component completed, a result-affecting bug fixed,
   an experiment launched or analysed, a decision taken), call `log_progress` once with a short
   `summary` and optional Markdown `details` (what changed, evidence, next step).
3. **When there are experiment results**, call `record_experiment` with a stable
   `experiment_key` and a stable `external_run_id` (W&B/MLflow id or `<git_commit>-seed<seed>`),
   plus `seed`, `git_commit`, `config` (key hyper-parameters only) and `metrics` copied from
   actual logs/result files. Re-sending the same ids updates the existing run.
4. **When a task's status changes**, call `upsert_task` (by `task_id`, or with a `client_key`
   for tasks you create), passing only the fields that changed.

## Rules

5. Only record results supported by evidence you have actually seen. **Never fabricate or
   estimate metrics.** Flag uncertainty in `details`.
6. Successful execution is not scientific verification. Never attempt to set `verified`;
   new results stay in `needs_review` until the researcher reviews them in the web UI.
7. Don't log trivial edits. A few meaningful `log_progress` entries per session is plenty.
8. Never overwrite conclusions the user has confirmed. On `verified_protected` or
   `confirmation_required` errors, ask the user; retry with `confirm_overwrite_verified=true` /
   `confirm=true` only after explicit approval.
9. If ResearchOS is unavailable or a call fails, note it briefly and **carry on with the coding
   task** — tracking must never block development.
10. Never send secrets, API tokens, credentials, private keys, personal data or sensitive raw
    data to ResearchOS. Store metadata, paths and URLs only — not checkpoints, videos or logs.
