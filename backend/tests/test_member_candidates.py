from tests.test_multiuser import invite, member, project


def test_member_candidates_are_registered_enabled_nonmembers_except_admin(ctx):
    p = project(ctx)
    alice, _, alice_id = member(ctx)
    bob, _, bob_id = member(ctx, "bob")
    carol, _, carol_id = member(ctx, "carol")
    invite(ctx, "pending")
    assert ctx.client.patch(f"/api/v1/users/{carol_id}", json={"is_active": False}, headers=ctx.csrf).status_code == 200
    endpoint = f"/api/v1/projects/{p['id']}/member-candidates"
    first = ctx.client.get(endpoint, params={"limit": 1}).json()
    assert first["total"] == 2
    assert first["items"] == [{"user_id": alice_id, "username": "alice"}]
    second = ctx.client.get(endpoint, params={"limit": 1, "offset": 1}).json()
    assert second["items"] == [{"user_id": bob_id, "username": "bob"}]
    assert ctx.client.post(f"/api/v1/projects/{p['id']}/members", json={"username": "alice"}, headers=ctx.csrf).status_code == 204
    assert ctx.client.get(endpoint).json()["items"] == second["items"]
    assert ctx.client.delete(f"/api/v1/projects/{p['id']}/members/{alice_id}", headers=ctx.csrf).status_code == 204
    assert ctx.client.get(endpoint).json()["total"] == 2
    alice.close()
    bob.close()
    carol.close()


def test_only_project_member_managers_can_list_candidates(ctx):
    alice, csrf, _ = member(ctx)
    bob, _, _ = member(ctx, "bob")
    p = alice.post("/api/v1/projects", json={"title": "Alice project"}, headers=csrf).json()
    endpoint = f"/api/v1/projects/{p['id']}/member-candidates"
    assert alice.get("/api/v1/users").status_code == 403
    assert alice.get(endpoint).json()["items"][0]["username"] == "bob"
    assert bob.get(endpoint).status_code == 404
    assert alice.post(f"/api/v1/projects/{p['id']}/members", json={"username": "bob"}, headers=csrf).status_code == 204
    assert bob.get(endpoint).status_code == 403
    assert ctx.client.get(endpoint, headers=ctx.rw).status_code == 403
    assert ctx.client.get(endpoint, headers=ctx.ro).status_code == 403
    alice.close()
    bob.close()
