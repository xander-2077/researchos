"""Demo data (fictional). Only inserted into an empty database."""

from __future__ import annotations

from datetime import date, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.models import Project
from app.schemas.entities import (
    ExperimentCreate,
    MilestoneCreate,
    ProgressCreate,
    ProjectCreate,
    RunCreate,
    TaskCreate,
    TaskUpdate,
)
from app.services import activity, experiments, milestones, projects, tasks

DEMO = Actor(kind="system", name="demo-seed", source="system")


def seed_demo(db: Session) -> str:
    if (db.scalar(select(func.count()).select_from(Project)) or 0) > 0:
        return "Database is not empty; demo data not inserted."
    t = date.today()
    d = lambda n: t + timedelta(days=n)  # noqa: E731

    specs = [
        dict(
            project=ProjectCreate(
                title="Humanoid Whole-Body Manipulation", slug="humanoid-wbm",
                description="[DEMO] Whole-body loco-manipulation for a humanoid with a learned base-compensation controller.",
                research_question="Can a learned whole-body controller compensate base motion well enough for precise bimanual manipulation?",
                hypothesis="Adding base-motion compensation to WBC improves end-effector tracking by >30% while walking.",
                target_venue="CoRL 2027", submission_deadline=d(45), stage="experimentation", health_status="on_track",
                priority="high", repository_url="https://example.com/lab/humanoid-wbm",
                next_action="Run simulation ablations for the base-compensation module.",
            ),
            milestones=[("WBC base-compensation module", "completed", d(-10)), ("Simulation ablations", "in_progress", d(10)),
                        ("Real-robot validation", "planned", d(30)), ("Paper draft", "planned", d(40))],
            tasks=[("Run sim ablation: no base compensation", "in_progress", "high", d(3), ["experiment", "sim"]),
                   ("Collect teleop demos for drawer task", "todo", "medium", d(8), ["data"]),
                   ("Fix IK singularity near joint limits", "done", "high", d(-2), ["bug"])],
        ),
        dict(
            project=ProjectCreate(
                title="Multi-Agent Quadruped Soccer", slug="quadruped-soccer",
                description="[DEMO] Decentralised multi-agent RL for 2v2 quadruped soccer with a learned world model.",
                research_question="Does a shared world model improve coordination in decentralised multi-robot soccer?",
                hypothesis="Agents with a world model score more goals per episode than model-free agents.",
                target_venue="ICRA 2027", submission_deadline=d(20), stage="analysis", health_status="at_risk",
                priority="critical", next_action="Finish world-model ablation with 5 seeds.",
                blocker_summary="Cluster quota exhausted until next week.",
            ),
            milestones=[("Simulation environment", "completed", d(-30)), ("World-model ablation", "in_progress", d(5)),
                        ("Paper submission", "planned", d(20))],
            deps={"Make goal-rate plot": ["Re-run seeds 3-5 for no-world-model ablation"],
                  "Analyse ablation results": ["Re-run seeds 3-5 for no-world-model ablation", "Run full-model baseline, 5 seeds"],
                  "Write related work": ["Write method section"],
                  "Proofread and submit": ["Analyse ablation results", "Write related work"]},
            tasks=[("Re-run seeds 3-5 for no-world-model ablation", "blocked", "critical", d(2), ["experiment"]),
                   ("Write method section", "in_progress", "high", d(6), ["writing"]),
                   ("Make goal-rate plot", "todo", "medium", d(-1), ["figure"]),
                   ("Run full-model baseline, 5 seeds", "done", "high", d(-8), ["experiment"]),
                   ("Analyse ablation results", "todo", "high", d(11), ["analysis"]),
                   ("Write related work", "todo", "medium", d(15), ["writing"]),
                   ("Proofread and submit", "todo", "critical", d(20), ["writing"])],
        ),
        dict(
            project=ProjectCreate(
                title="Humanoid Data Generation", slug="humanoid-datagen",
                description="[DEMO] Procedural generation of humanoid manipulation demonstrations.",
                research_question="Can procedurally generated demos replace part of human teleoperation data?",
                stage="research_design", priority="medium", next_action="Define task distribution and success metric.",
            ),
            milestones=[],
            tasks=[("Literature review on data augmentation for BC", "todo", "low", d(14), ["reading"])],
        ),
    ]
    created = []
    for s in specs:
        p = projects.create_project(db, DEMO, s["project"])
        created.append(p)
        for title, status, due in s["milestones"]:
            milestones.create_milestone(db, DEMO, p.id, MilestoneCreate(title=title, status=status, due_date=due))
        by_title = {}
        for title, status, prio, due, tags in s["tasks"]:
            span = 3 if prio in ("low", "medium") else 5
            by_title[title] = tasks.create_task(db, DEMO, TaskCreate(
                project_id=p.id, title=title, status=status, priority=prio, due_date=due, tags=tags,
                start_date=due - timedelta(days=span)))
        for title, deps in s.get("deps", {}).items():
            tasks.update_task(db, DEMO, by_title[title].id, TaskUpdate(depends_on=[by_title[x].id for x in deps]))

    soccer = created[1]
    for key, name, variant, status, sr in [
        ("full-model", "Full model (with world model)", "baseline: full model", "verified", [0.71, 0.68, 0.74]),
        ("no-world-model", "Ablation: no world model", "remove world model", "needs_review", [0.52, 0.49]),
        ("no-comm", "Ablation: no communication", "disable message passing", "running", [0.61]),
    ]:
        e = experiments.create_experiment(db, DEMO, ExperimentCreate(
            project_id=soccer.id, experiment_key=key, name=name, group_name="World-model ablations",
            type="ablation" if key != "full-model" else "baseline", variant=variant, status=status,
            hypothesis="World model improves goal rate." if key == "no-world-model" else "",
        ))
        for i, v in enumerate(sr):
            experiments.upsert_run(db, DEMO, e.id, RunCreate(
                external_run_id=f"demo-{key}-seed{i}", seed=i, git_commit="a1b2c3d", git_branch="main",
                environment="IsaacGym soccer 2v2", config={"lr": 3e-4, "num_envs": 4096},
                metrics={"goal_rate": {"value": v, "unit": "goals/episode"}, "success_rate": {"value": round(v * 100, 1), "unit": "%"}},
                verification_status="verified" if status == "verified" else "needs_review",
            ))
    activity.add_progress(db, DEMO, created[0].id, ProgressCreate(
        summary="Finished WBC base-compensation module; next: simulation ablations.", source="claude_code"))
    activity.add_progress(db, DEMO, soccer.id, ProgressCreate(
        summary="No-world-model ablation shows ~25% lower goal rate (2 seeds, needs review).", source="codex"))
    return f"Inserted {len(created)} demo projects."
