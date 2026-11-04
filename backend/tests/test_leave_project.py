from tests.test_multiuser import member, project


def test_member_can_leave_and_project_keeps_a_departure_event(ctx):
    p = project(ctx)
    alice, csrf, uid = member(ctx)
    root = f"/api/v1/projects/{p['id']}"
    assert ctx.client.post(root + "/members", json={"username": "alice"}, headers=ctx.csrf).status_code == 204
    token = alice.post("/api/v1/tokens", json={"name": "alice-agent", "scopes": ["read", "write"]}, headers=csrf).json()["token"]
    task = alice.post("/api/v1/tasks", json={"project_id": p["id"], "title": "Keep project task"}, headers=csrf).json()
    assert alice.post(root + "/leave", headers=csrf).status_code == 204
    assert alice.get(root).status_code == 404
    assert alice.get(root, headers={"Authorization": f"Bearer {token}"}).status_code == 404
    assert alice.get("/api/v1/projects").json()["items"] == []
    assert alice.get("/api/v1/dashboard/activity").json()["items"] == []
    assert uid not in {m["user_id"] for m in ctx.client.get(root + "/members").json()["items"]}
    assert ctx.client.get(f"/api/v1/tasks/{task['id']}").json()["title"] == "Keep project task"
    events = ctx.client.get(root + "/progress", params={"event_type": "member_left"}).json()
    assert events["total"] == 1
    assert events["items"][0]["summary"] == "Member left: alice"
    assert events["items"][0]["actor"] == "alice"
    assert events["items"][0]["project_id"] == p["id"]
    assert alice.post(root + "/leave", headers=csrf).status_code == 404
    assert ctx.client.get(root + "/progress", params={"event_type": "member_left"}).json()["total"] == 1
    alice.close()


def test_owner_nonmembers_and_tokens_cannot_leave(ctx):
    p = project(ctx)
    alice, csrf, _ = member(ctx)
    root = f"/api/v1/projects/{p['id']}"
    assert ctx.client.post(root + "/leave", headers=ctx.csrf).status_code == 422
    assert alice.post(root + "/leave", headers=csrf).status_code == 404
    assert ctx.client.post(root + "/members", json={"username": "alice"}, headers=ctx.csrf).status_code == 204
    token = alice.post("/api/v1/tokens", json={"name": "alice-agent", "scopes": ["read", "write"]}, headers=csrf).json()["token"]
    assert alice.post(root + "/leave", headers={"Authorization": f"Bearer {token}"}).status_code == 403
    assert alice.post(root + "/leave").status_code == 403
    assert ctx.client.post(root + "/leave", headers=ctx.ro).status_code == 403
    assert ctx.client.get(root + "/progress", params={"event_type": "member_left"}).json()["total"] == 0
    assert alice.get(root).status_code == 200
    alice.close()
