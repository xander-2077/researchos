from sqlalchemy import select

from app.database.session import SessionLocal
from app.models import Experiment, ExperimentRun, Milestone, ProgressEvent, Project, ProjectMember, Task, TaskDependency
from tests.test_multiuser import member, project


def test_creator_can_permanently_delete_project_and_its_resources(ctx):
    keep = project(ctx, "Keep this project")
    alice, csrf, _ = member(ctx)
    p = alice.post("/api/v1/projects", json={"title": "Delete this project"}, headers=csrf).json()
    pid = p["id"]
    root = f"/api/v1/projects/{pid}"
    milestone = alice.post(root + "/milestones", json={"title": "Milestone"}, headers=csrf).json()
    first = alice.post("/api/v1/tasks", json={"project_id": pid, "milestone_id": milestone["id"], "title": "First task"}, headers=csrf).json()
    second = alice.post("/api/v1/tasks", json={"project_id": pid, "title": "Second task", "depends_on": [first["id"]]}, headers=csrf).json()
    personal = alice.post("/api/v1/tasks", json={"title": "Keep personal task"}, headers=csrf).json()
    experiment = alice.post("/api/v1/experiments", json={"project_id": pid, "name": "Experiment"}, headers=csrf).json()
    run = alice.post(f"/api/v1/experiments/{experiment['id']}/runs", json={"external_run_id": "r1"}, headers=csrf).json()
    assert alice.delete(root + "/permanent", headers=csrf).status_code == 204
    assert alice.get(root).status_code == 404
    assert ctx.client.get(root).status_code == 404
    assert alice.get("/api/v1/projects?include_all=true").json()["items"] == []
    assert ctx.client.get(f"/api/v1/projects/{keep['id']}").status_code == 200
    assert alice.get(f"/api/v1/tasks/{personal['id']}").status_code == 200
    with SessionLocal() as db:
        for model, resource_id in [(Project, pid), (Milestone, milestone["id"]), (Task, first["id"]),
                                   (Task, second["id"]), (Experiment, experiment["id"]), (ExperimentRun, run["id"])]:
            assert db.get(model, resource_id) is None
        assert db.scalar(select(ProjectMember).where(ProjectMember.project_id == pid)) is None
        assert db.scalar(select(TaskDependency).where(TaskDependency.task_id == second["id"])) is None
        assert db.scalar(select(ProgressEvent).where(ProgressEvent.project_id == pid)) is None
        audit = db.scalar(select(ProgressEvent).where(ProgressEvent.event_type == "project_deleted"))
        assert audit.related_resource_id == pid
        assert audit.summary == "Project deleted: Delete this project"
    alice.close()


def test_only_owner_session_can_permanently_delete(ctx):
    alice, csrf, _ = member(ctx)
    bob, bob_csrf, _ = member(ctx, "bob")
    p = alice.post("/api/v1/projects", json={"title": "Protected"}, headers=csrf).json()
    root = f"/api/v1/projects/{p['id']}"
    assert bob.delete(root + "/permanent", headers=bob_csrf).status_code == 404
    assert alice.post(root + "/members", json={"username": "bob"}, headers=csrf).status_code == 204
    assert bob.delete(root + "/permanent", headers=bob_csrf).status_code == 403
    assert ctx.client.delete(root + "/permanent", headers=ctx.csrf).status_code == 403
    token = alice.post("/api/v1/tokens", json={"name": "owner-agent", "scopes": ["read", "write"]}, headers=csrf).json()["token"]
    assert alice.delete(root + "/permanent", headers={"Authorization": f"Bearer {token}"}).status_code == 403
    assert alice.delete(root + "/permanent").status_code == 403
    assert alice.get(root).status_code == 200
    assert alice.delete(root, headers=csrf).json()["archived"] is True
    assert alice.get(root).status_code == 200
    assert alice.delete(root + "/permanent", headers=csrf).status_code == 204
    alice.close()
    bob.close()
