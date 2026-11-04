from tests.test_multiuser import member, project


def test_admin_can_delete_and_restore_activity(ctx):
    p = project(ctx)
    path = f"/api/v1/projects/{p['id']}/progress"
    original = ctx.client.get(path).json()
    event = original["items"][0]
    endpoint = f"/api/v1/dashboard/activity/{event['id']}"

    for _ in range(2):
        assert ctx.client.delete(endpoint, headers=ctx.csrf).status_code == 204
    assert ctx.client.get(path).json()["total"] == 0
    assert ctx.client.get(f"/api/v1/dashboard/activity?project_id={p['id']}").json()["total"] == 0
    deleted = ctx.client.get("/api/v1/dashboard/activity?deleted=true&limit=1").json()
    assert deleted["total"] == 1
    assert deleted["items"][0]["id"] == event["id"]
    assert deleted["items"][0]["deleted_at"]
    assert ctx.client.get(f"/api/v1/projects/{p['id']}").json()["title"] == p["title"]

    for _ in range(2):
        assert ctx.client.post(endpoint + "/restore", headers=ctx.csrf).status_code == 204
    assert ctx.client.get(path).json() == original
    assert ctx.client.get("/api/v1/dashboard/activity?deleted=true").json()["total"] == 0
    assert ctx.client.delete("/api/v1/dashboard/activity/999999", headers=ctx.csrf).status_code == 404
    assert ctx.client.post("/api/v1/dashboard/activity/999999/restore", headers=ctx.csrf).status_code == 404


def test_members_and_tokens_cannot_manage_activity(ctx):
    p = project(ctx)
    event_id = ctx.client.get(f"/api/v1/projects/{p['id']}/progress").json()["items"][0]["id"]
    alice, csrf, _ = member(ctx)
    endpoint = f"/api/v1/dashboard/activity/{event_id}"
    for client, headers in [(alice, csrf), (ctx.client, ctx.rw), (ctx.client, ctx.ro)]:
        assert client.delete(endpoint, headers=headers).status_code == 403
        assert client.post(endpoint + "/restore", headers=headers).status_code == 403
        assert client.get("/api/v1/dashboard/activity?deleted=true", headers=headers).status_code == 403
    alice.close()
