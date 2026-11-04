import pytest

from tests.test_multiuser import member, project


@pytest.mark.parametrize("administrator", [False, True])
def test_activity_follows_project_participation_and_member_invitation(ctx, administrator):
    unrelated = project(ctx, "Unrelated project")
    bob, bob_csrf, _ = member(ctx, "bob")
    if administrator:
        alice, csrf, username = ctx.client, ctx.csrf, "admin"
    else:
        alice, csrf, _ = member(ctx, "alice")
        username = "alice"
    own = alice.post("/api/v1/projects", json={"title": "My project"}, headers=csrf).json()
    shared = bob.post("/api/v1/projects", json={"title": "Bob project"}, headers=bob_csrf).json()
    endpoint = "/api/v1/dashboard/activity"
    before = alice.get(endpoint).json()["items"]
    expected = {own["id"], unrelated["id"]} if administrator else {own["id"]}
    assert {e["project_id"] for e in before} == expected
    # Even administrators with access to Bob's project don't see it in their personal feed.
    assert alice.get(endpoint, params={"project_id": shared["id"]}).json()["total"] == 0
    assert ctx.client.get(endpoint, params={"project_id": shared["id"]}).json()["total"] == 0
    added = bob.post(f"/api/v1/projects/{shared['id']}/members", json={"username": username}, headers=bob_csrf)
    assert added.status_code == 204
    assert shared["id"] in {p["id"] for p in alice.get("/api/v1/projects").json()["items"]}
    events = alice.get(endpoint, params={"project_id": shared["id"], "limit": 1}).json()
    assert events["total"] == 2
    invitation = events["items"][0]
    assert invitation["event_type"] == "member_added"
    assert invitation["actor"] == "bob"
    assert invitation["project_title"] == "Bob project"
    assert invitation["summary"] == f"Member added: {username}"
    uid = alice.get("/api/v1/auth/me").json()["user_id"]
    assert bob.delete(f"/api/v1/projects/{shared['id']}/members/{uid}", headers=bob_csrf).status_code == 204
    assert alice.get(endpoint, params={"project_id": shared["id"]}).json()["total"] == 0
    bob.close()
    if not administrator:
        alice.close()


def test_admin_personal_feed_excludes_other_users_standalone_tasks(ctx):
    alice, csrf, _ = member(ctx)
    alice.post("/api/v1/tasks", json={"title": "Alice task"}, headers=csrf)
    task = ctx.client.post("/api/v1/tasks", json={"title": "My task"}, headers=ctx.csrf).json()
    page = ctx.client.get("/api/v1/dashboard/activity").json()
    assert page["total"] == 1
    assert page["items"][0]["related_resource_id"] == task["id"]
    alice.close()
