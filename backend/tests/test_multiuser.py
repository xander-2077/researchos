"""Invitation lifecycle, collaborative access and credential isolation."""
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from urllib.parse import parse_qs, urlsplit

from fastapi.testclient import TestClient

from app.api.deps import actor_from_bearer
from app.core.errors import NotFound
from app.database.session import SessionLocal
from app.models import UserInvitation, utcnow
from app.services import projects as projects_svc
from tests.conftest import Ctx

PASSWORD = "member-password-123"


def invite(ctx: Ctx, username: str = "alice", **kw):
    response = ctx.client.post("/api/v1/users", json={"username": username, **kw}, headers=ctx.csrf)
    assert response.status_code == 201, response.text
    data = response.json()
    token = parse_qs(urlsplit(data["invitation_path"]).fragment)["invite"][0]
    return data, token


def member(ctx: Ctx, username: str = "alice", **kw):
    data, token = invite(ctx, username, **kw)
    client = TestClient(ctx.client.app)
    response = client.post("/api/v1/auth/register", json={"token": token, "password": PASSWORD})
    assert response.status_code == 201, response.text
    return client, {"X-CSRF-Token": response.json()["csrf_token"]}, data["user"]["id"]


def project(ctx: Ctx, title="Private project"):
    response = ctx.client.post("/api/v1/projects", json={"title": title}, headers=ctx.csrf)
    assert response.status_code == 201, response.text
    return response.json()


def test_research_activity_excludes_account_changes(ctx: Ctx):
    initial_total = ctx.client.get("/api/v1/dashboard/activity").json()["total"]
    p = project(ctx)
    alice, _, uid = member(ctx)
    assert ctx.client.patch(f"/api/v1/users/{uid}", json={"is_active": False}, headers=ctx.csrf).status_code == 200
    assert ctx.client.delete(f"/api/v1/users/{uid}", headers=ctx.csrf).status_code == 204
    alice.close()

    page = ctx.client.get("/api/v1/dashboard/activity?limit=1").json()
    assert page["total"] == initial_total + 1
    assert page["items"][0]["event_type"] == "project_created"
    assert page["items"][0]["project_id"] == p["id"]
    assert ctx.client.get("/api/v1/dashboard/activity?event_type=user_invited,user_registered,user_updated,user_deleted").json()["total"] == 0


def test_admin_only_user_management_and_pagination(ctx: Ctx):
    alice, csrf, uid = member(ctx)
    for method, path, payload in [
        ("GET", "/users", None), ("POST", "/users", {"username": "intruder"}),
        ("PATCH", f"/users/{uid}", {"is_admin": True}), ("POST", f"/users/{uid}/invitation", {}),
    ]:
        assert alice.request(method, f"/api/v1{path}", json=payload, headers=csrf).status_code == 403
    assert ctx.client.get("/api/v1/users", headers=ctx.rw).status_code == 403
    assert ctx.client.post("/api/v1/users", json={"username": "bob"}).status_code == 403
    page = ctx.client.get("/api/v1/users?limit=1&offset=1").json()
    assert page["total"] == 2 and page["items"][0]["username"] == "alice"
    assert "password_hash" not in page["items"][0]
    assert ctx.client.post("/api/v1/users", json={"username": "alice"}, headers=ctx.csrf).status_code == 409
    assert ctx.client.patch("/api/v1/users/1", json={"is_admin": False}, headers=ctx.csrf).status_code == 422
    assert ctx.client.patch("/api/v1/users/1", json={"is_active": False}, headers=ctx.csrf).status_code == 422


def test_invitation_renewal_expiry_and_single_use(ctx: Ctx):
    data, old = invite(ctx)
    uid = data["user"]["id"]
    assert not data["user"]["registered"]
    assert ctx.client.post("/api/v1/auth/login", json={"username": "alice", "password": ""}).status_code != 200
    renewed = ctx.client.post(f"/api/v1/users/{uid}/invitation", headers=ctx.csrf).json()
    token = parse_qs(urlsplit(renewed["invitation_path"]).fragment)["invite"][0]
    guest = TestClient(ctx.client.app)
    assert guest.post("/api/v1/auth/invitation", json={"token": old}).status_code == 422
    assert guest.post("/api/v1/auth/invitation", json={"token": token}).json()["username"] == "alice"
    assert guest.post("/api/v1/auth/register", json={"token": token, "password": "short"}).status_code == 422
    with SessionLocal() as db:
        invitation = db.get(UserInvitation, uid)
        assert invitation.token_hash != token and len(invitation.token_hash) == 64
        invitation.expires_at = utcnow() - timedelta(seconds=1)
        db.commit()
    assert guest.post("/api/v1/auth/register", json={"token": token, "password": PASSWORD}).status_code == 422
    renewed = ctx.client.post(f"/api/v1/users/{uid}/invitation", headers=ctx.csrf).json()
    token = parse_qs(urlsplit(renewed["invitation_path"]).fragment)["invite"][0]
    response = guest.post("/api/v1/auth/register", json={"token": token, "password": PASSWORD})
    assert response.status_code == 201 and response.json()["user_id"] == uid
    assert response.json()["is_admin"] is False
    assert guest.get("/api/v1/auth/me").json()["authenticated"]
    assert guest.post("/api/v1/auth/register", json={"token": token, "password": "changed-password"}).status_code == 422
    assert ctx.client.post(f"/api/v1/users/{uid}/invitation", headers=ctx.csrf).status_code == 422
    assert guest.post("/api/v1/auth/login", json={"username": "alice", "password": PASSWORD}).status_code == 200


def test_invitation_cannot_be_consumed_concurrently(ctx: Ctx):
    _, token = invite(ctx)
    def register_once(_):
        client = TestClient(ctx.client.app)
        try:
            return client.post("/api/v1/auth/register", json={"token": token, "password": PASSWORD}).status_code
        finally:
            client.close()
    # These clients share the app but not cookies; the conditional UPDATE permits one winner.
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(register_once, range(2))) == [201, 422]


def test_collaboration_and_all_resource_permissions(ctx: Ctx):
    p = project(ctx)
    pid = p["id"]
    task = ctx.client.post("/api/v1/tasks", json={"project_id": pid, "title": "Secret task", "due_date": date.today().isoformat()}, headers=ctx.csrf).json()
    milestone = ctx.client.post(f"/api/v1/projects/{pid}/milestones", json={"title": "Secret milestone", "due_date": date.today().isoformat()}, headers=ctx.csrf).json()
    experiment = ctx.client.post("/api/v1/experiments", json={"project_id": pid, "name": "Secret experiment", "status": "needs_review"}, headers=ctx.csrf).json()
    eid = experiment["id"]
    run = ctx.client.post(f"/api/v1/experiments/{eid}/runs", json={"external_run_id": "r1"}, headers=ctx.csrf).json()
    alice, csrf, uid = member(ctx)
    own = alice.post("/api/v1/projects", json={"title": "Alice project"}, headers=csrf).json()
    assert own["owner_id"] == uid
    assert [m["user_id"] for m in alice.get(f"/api/v1/projects/{own['id']}/members").json()["items"]] == [uid]
    for path in [f"/projects/{pid}", f"/projects/{p['slug']}", f"/projects/{pid}/milestones", f"/projects/{pid}/members",
                 f"/projects/{pid}/progress", f"/tasks/{task['id']}", f"/experiments/{eid}", f"/experiments/{eid}/runs"]:
        assert alice.get(f"/api/v1{path}").status_code == 404, path
    for path, payload in [
        (f"/projects/{pid}", {"notes": "bad"}), (f"/tasks/{task['id']}", {"title": "bad"}),
        (f"/milestones/{milestone['id']}", {"title": "bad"}), (f"/experiments/{eid}", {"name": "bad"}),
        (f"/runs/{run['id']}", {"conclusion": "bad"}),
    ]:
        assert alice.patch(f"/api/v1{path}", json=payload, headers=csrf).status_code == 404, path
        assert alice.delete(f"/api/v1{path}", headers=csrf).status_code == 404, path
    for path, payload in [
        ("/tasks", {"project_id": pid, "title": "bad"}),
        ("/experiments", {"project_id": pid, "name": "bad"}),
        (f"/projects/{pid}/milestones", {"title": "bad"}),
        (f"/projects/{pid}/progress", {"summary": "bad"}),
        (f"/experiments/{eid}/runs", {"external_run_id": "bad"}),
    ]:
        assert alice.post(f"/api/v1{path}", json=payload, headers=csrf).status_code == 404, path
    for path in ["/tasks", "/experiments", f"/dashboard/activity?project_id={pid}", f"/tasks?project_id={pid}"]:
        assert alice.get(f"/api/v1{path}").json()["items"] == [], path
    assert all(e["project_id"] == own["id"] for e in alice.get("/api/v1/dashboard/activity").json()["items"])
    assert alice.get("/api/v1/dashboard/summary").json()["open_tasks"] == 0
    assert alice.get("/api/v1/dashboard/deadlines").json() == []
    assert alice.get("/api/v1/dashboard/needs-review").json() == []
    exported = alice.get("/api/v1/export").json()
    assert [p["id"] for p in exported["projects"]] == [own["id"]]
    assert exported["experiment_runs"] == [] and exported["tasks"] == []
    assert alice.post("/api/v1/projects/reorder", json={"ids": [pid]}, headers=csrf).status_code == 404
    assert ctx.client.post(f"/api/v1/projects/{pid}/members", json={"username": "alice"}, headers=ctx.csrf).status_code == 204
    assert alice.get(f"/api/v1/projects/{pid}").status_code == 200
    assert alice.patch(f"/api/v1/tasks/{task['id']}", json={"status": "done"}, headers=csrf).status_code == 200
    assert ctx.client.get(f"/api/v1/tasks/{task['id']}").json()["status"] == "done"
    assert alice.post(f"/api/v1/projects/{pid}/members", json={"username": "admin"}, headers=csrf).status_code == 403
    assert ctx.client.delete(f"/api/v1/projects/{pid}/members/{p['owner_id']}", headers=ctx.csrf).status_code == 422
    assert ctx.client.delete(f"/api/v1/projects/{pid}/members/{uid}", headers=ctx.csrf).status_code == 204
    assert alice.get(f"/api/v1/tasks/{task['id']}").status_code == 404


def test_tokens_and_mcp_follow_membership_and_user_status(ctx: Ctx):
    p = project(ctx)
    alice, csrf, uid = member(ctx)
    bob, bob_csrf, _ = member(ctx, "bob")
    response = alice.post("/api/v1/tokens", json={"name": "alice-agent", "scopes": ["read", "write"]}, headers=csrf)
    assert response.status_code == 201
    token = response.json()["token"]
    token_id = response.json()["id"]
    bearer = {"Authorization": f"Bearer {token}"}
    assert [t["id"] for t in alice.get("/api/v1/tokens").json()] == [token_id]
    assert bob.get("/api/v1/tokens").json() == []
    assert bob.delete(f"/api/v1/tokens/{token_id}", headers=bob_csrf).status_code == 404
    assert alice.get("/api/v1/projects", headers=bearer).json()["items"] == []
    with SessionLocal() as db:
        actor = actor_from_bearer(db, bearer["Authorization"], None, "mcp")
        try:
            projects_svc.resolve_project(db, p["slug"], actor)
        except NotFound:
            pass
        else:
            raise AssertionError("MCP actor bypassed project membership")
    ctx.client.post(f"/api/v1/projects/{p['id']}/members", json={"username": "alice"}, headers=ctx.csrf)
    assert alice.get(f"/api/v1/projects/{p['id']}", headers=bearer).status_code == 200
    ctx.client.delete(f"/api/v1/projects/{p['id']}/members/{uid}", headers=ctx.csrf)
    assert alice.get(f"/api/v1/projects/{p['id']}", headers=bearer).status_code == 404
    assert ctx.client.patch(f"/api/v1/users/{uid}", json={"is_active": False}, headers=ctx.csrf).status_code == 200
    assert alice.get("/api/v1/auth/me").json()["authenticated"] is False
    assert alice.get("/api/v1/projects", headers=bearer).status_code == 401
    assert alice.post("/api/v1/auth/login", json={"username": "alice", "password": PASSWORD}).status_code == 401
    assert ctx.client.patch(f"/api/v1/users/{uid}", json={"is_active": True}, headers=ctx.csrf).status_code == 200
    assert alice.get("/api/v1/projects", headers=bearer).status_code == 401  # remains revoked
    assert alice.post("/api/v1/auth/login", json={"username": "alice", "password": PASSWORD}).status_code == 200


def test_uploaded_images_follow_project_access(ctx: Ctx):
    from tests.test_uploads import PNG

    alice, csrf, uid = member(ctx)
    bob, _, _ = member(ctx, "bob")
    private = project(ctx)
    url = ctx.client.post("/api/v1/uploads", content=PNG, headers=ctx.csrf).json()["url"]
    assert alice.get(url).status_code == 404
    own = alice.post("/api/v1/projects", json={"title": "Alice private"}, headers=csrf).json()
    assert alice.patch(f"/api/v1/projects/{own['id']}", json={"notes": f"![stolen]({url})"}, headers=csrf).status_code == 404
    assert alice.get(url).status_code == 404
    ctx.client.patch(f"/api/v1/projects/{private['id']}", json={"notes": f"![image]({url})"}, headers=ctx.csrf)
    assert alice.get(url).status_code == 404
    ctx.client.post(f"/api/v1/projects/{private['id']}/members", json={"username": "alice"}, headers=ctx.csrf)
    assert alice.get(url).status_code == 200
    assert bob.get(url).status_code == 404
    ctx.client.delete(f"/api/v1/projects/{private['id']}/members/{uid}", headers=ctx.csrf)
    assert alice.get(url).status_code == 404
    # Unsaved uploads are visible to their uploader only, even before joining any project.
    own_url = alice.post("/api/v1/uploads", content=PNG + b"draft", headers=csrf).json()["url"]
    assert alice.get(own_url).status_code == 200
    assert bob.get(own_url).status_code == 404
    # Legacy images (no ownership metadata) still work when referenced by a shared project.
    from app.models import UploadOwner
    from sqlalchemy import delete
    with SessionLocal() as db:
        db.execute(delete(UploadOwner))
        db.commit()
    ctx.client.post(f"/api/v1/projects/{private['id']}/members", json={"username": "alice"}, headers=ctx.csrf)
    assert alice.get(url).status_code == 200


def test_delete_user_preserves_research_and_invalidates_credentials(ctx: Ctx):
    from sqlalchemy import select
    from app.models import ApiToken, Project, ProjectMember, UploadOwner, User, UserInvitation
    from tests.test_uploads import PNG

    alice, csrf, uid = member(ctx)
    own = alice.post("/api/v1/projects", json={"title": "Preserved research"}, headers=csrf).json()
    task = alice.post("/api/v1/tasks", json={"project_id": own["id"], "title": "Keep task"}, headers=csrf).json()
    token = alice.post("/api/v1/tokens", json={"name": "deleted-user-agent", "scopes": ["read"]}, headers=csrf).json()["token"]
    image = alice.post("/api/v1/uploads", content=PNG, headers=csrf).json()["url"]
    personal = alice.post("/api/v1/tasks", json={"title": "Keep personal", "client_key": "same-key"}, headers=csrf).json()
    ctx.client.post("/api/v1/tasks", json={"title": "Admin personal", "client_key": "same-key"}, headers=ctx.csrf)
    assert alice.delete("/api/v1/users/1", headers=csrf).status_code == 403
    assert ctx.client.delete(f"/api/v1/users/{uid}", headers=ctx.rw).status_code == 403
    assert ctx.client.delete(f"/api/v1/users/{uid}").status_code == 403  # CSRF
    assert ctx.client.delete("/api/v1/users/1", headers=ctx.csrf).status_code == 422
    assert ctx.client.delete(f"/api/v1/users/{uid}", headers=ctx.csrf).status_code == 204
    assert alice.get("/api/v1/auth/me").json()["authenticated"] is False
    assert alice.get("/api/v1/projects", headers={"Authorization": f"Bearer {token}"}).status_code == 401
    assert ctx.client.get(f"/api/v1/tasks/{task['id']}").json()["title"] == "Keep task"
    assert ctx.client.get(image).status_code == 200
    assert ctx.client.get(f"/api/v1/tasks/{personal['id']}").json()["client_key"] is None
    with SessionLocal() as db:
        assert db.get(User, uid) is None
        assert db.get(UserInvitation, uid) is None
        assert db.scalar(select(ApiToken.id).where(ApiToken.user_id == uid)) is None
        assert db.get(Project, own["id"]).owner_id == 1
        assert db.get(ProjectMember, (own["id"], 1)) is not None
        assert db.get(ProjectMember, (own["id"], uid)) is None
        assert db.scalar(select(UploadOwner.user_id)) == 1
    # New accounts cannot resurrect the deleted account's signed cookie (uid + session version).
    _, _, new_uid = member(ctx, "replacement")
    assert new_uid > uid
    assert ctx.client.delete(f"/api/v1/users/{uid}", headers=ctx.csrf).status_code == 404


def test_delete_pending_user_revokes_invitation(ctx: Ctx):
    data, token = invite(ctx)
    assert ctx.client.delete(f"/api/v1/users/{data['user']['id']}", headers=ctx.csrf).status_code == 204
    assert ctx.client.post("/api/v1/auth/register", json={"token": token, "password": PASSWORD}).status_code == 422


def test_administrators_cannot_delete_each_other_concurrently(ctx: Ctx, monkeypatch):
    from threading import Barrier
    from sqlalchemy import func, select
    from app.models import User
    from app.services import auth

    other, csrf, uid = member(ctx, "other-admin", is_admin=True)
    barrier = Barrier(2)
    original = auth.require_admin
    def synchronize(actor):
        original(actor)
        barrier.wait(timeout=5)
    monkeypatch.setattr(auth, "require_admin", synchronize)
    def remove(args):
        client, headers, target = args
        return client.delete(f"/api/v1/users/{target}", headers=headers).status_code
    with ThreadPoolExecutor(max_workers=2) as pool:
        assert sorted(pool.map(remove, [(ctx.client, ctx.csrf, uid), (other, csrf, 1)])) == [204, 403]
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(User).where(User.is_active.is_(True), User.is_admin.is_(True))) == 1


def test_personal_standalone_tasks_are_isolated_in_rest_mcp_and_aggregations(ctx: Ctx):
    import pytest
    from app.services import tasks as tasks_svc

    alice, csrf, _ = member(ctx)
    bob, bob_csrf, _ = member(ctx, "bob")
    fields = {"title": "Personal task", "client_key": "daily", "due_date": date.today().isoformat()}
    a = alice.post("/api/v1/tasks", json=fields, headers=csrf)
    b = bob.post("/api/v1/tasks", json=fields, headers=bob_csrf)
    assert a.status_code == b.status_code == 201
    tid, other_id = a.json()["id"], b.json()["id"]
    assert tid != other_id
    assert alice.post("/api/v1/tasks", json=fields, headers=csrf).json()["id"] == tid
    for client, headers, hidden in [(alice, csrf, other_id), (bob, bob_csrf, tid)]:
        assert client.get(f"/api/v1/tasks/{hidden}").status_code == 404
        assert client.patch(f"/api/v1/tasks/{hidden}", json={"title": "bad"}, headers=headers).status_code == 404
        assert client.delete(f"/api/v1/tasks/{hidden}", headers=headers).status_code == 404
    assert [t["id"] for t in alice.get("/api/v1/tasks?project_id=0").json()["items"]] == [tid]
    assert alice.get("/api/v1/dashboard/summary").json()["open_tasks"] == 1
    assert [t["id"] for t in alice.get("/api/v1/dashboard/deadlines?include_archived=true").json()] == [tid]
    assert [t["id"] for t in alice.get("/api/v1/export").json()["tasks"]] == [tid]
    events = alice.get("/api/v1/dashboard/activity?project_id=0").json()["items"]
    assert events and all(e["related_resource_id"] == tid for e in events)
    assert alice.patch(f"/api/v1/tasks/{tid}", json={"depends_on": [other_id]}, headers=csrf).status_code == 422
    # Crowded ordering must not rewrite another user's private tasks.
    extra = alice.post("/api/v1/tasks", json={"title": "Extra"}, headers=csrf).json()
    assert alice.patch(f"/api/v1/tasks/{extra['id']}", json={"sort_order": a.json()["sort_order"] + 0.0001}, headers=csrf).status_code == 200
    assert bob.get(f"/api/v1/tasks/{other_id}").json()["sort_order"] == b.json()["sort_order"]
    token = alice.post("/api/v1/tokens", json={"name": "agent", "scopes": ["read", "write"]}, headers=csrf).json()["token"]
    with SessionLocal() as db:
        actor = actor_from_bearer(db, f"Bearer {token}", None, "mcp")
        updated, created = tasks_svc.upsert_task(db, actor, None, tid, None, {"title": "Updated by id"})
        assert not created and updated.title == "Updated by id"
        retried, created = tasks_svc.upsert_task(db, actor, None, None, "daily", {"title": "Updated by key"})
        assert not created and retried.id == tid
        new, created = tasks_svc.upsert_task(db, actor, None, None, "agent-task", {"title": "Agent task"})
        assert created and new.owner_id == actor.user_id
        with pytest.raises(NotFound):
            tasks_svc.upsert_task(db, actor, None, other_id, None, {"title": "bad"})
    assert alice.delete(f"/api/v1/tasks/{tid}", headers=csrf).status_code == 204
    assert any(e["event_type"] == "task_deleted" and e["related_resource_id"] == tid
               for e in alice.get("/api/v1/dashboard/activity?project_id=0").json()["items"])
    assert all(e["related_resource_id"] != tid for e in bob.get("/api/v1/dashboard/activity?project_id=0").json()["items"])


def test_shared_task_becomes_personal_with_image_access_and_can_rejoin_project(ctx: Ctx):
    from tests.test_uploads import PNG

    p = project(ctx)
    url = ctx.client.post("/api/v1/uploads", content=PNG, headers=ctx.csrf).json()["url"]
    task = ctx.client.post("/api/v1/tasks", json={"project_id": p["id"], "title": "Shared task", "notes": f"![image]({url})", "client_key": "daily"}, headers=ctx.csrf).json()
    alice, csrf, uid = member(ctx)
    ctx.client.post(f"/api/v1/projects/{p['id']}/members", json={"username": "alice"}, headers=ctx.csrf)
    assert alice.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": None}, headers=csrf).status_code == 200
    ctx.client.delete(f"/api/v1/projects/{p['id']}/members/{uid}", headers=ctx.csrf)
    assert alice.get(f"/api/v1/tasks/{task['id']}").status_code == 200
    assert alice.get(url).status_code == 200
    assert alice.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": p["id"]}, headers=csrf).status_code == 404
    own = alice.post("/api/v1/projects", json={"title": "Alice project"}, headers=csrf).json()
    assert alice.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": own["id"]}, headers=csrf).status_code == 200
    personal = alice.post("/api/v1/tasks", json={"title": "Daily", "client_key": "daily"}, headers=csrf).json()
    assert alice.patch(f"/api/v1/tasks/{task['id']}", json={"project_id": None}, headers=csrf).status_code == 409
    assert alice.get(f"/api/v1/tasks/{personal['id']}").json()["title"] == "Daily"
