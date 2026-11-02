from __future__ import annotations

from pathlib import Path

from fastapi.testclient import TestClient

from app.main import create_app
from tests.conftest import Ctx, login, make_settings

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPG = b"\xff\xd8\xff\xe0" + b"\x01" * 64


def test_upload_roundtrip_and_dedupe(ctx: Ctx, settings):
    c = ctx.client
    r = c.post("/api/v1/uploads", content=PNG, headers={**ctx.csrf, "Content-Type": "image/png"})
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["url"].startswith("/api/v1/uploads/") and body["url"].endswith(".png")
    assert body["size"] == len(PNG) and body["content_type"] == "image/png"
    assert (settings.data_dir / "uploads" / body["name"]).read_bytes() == PNG

    again = c.post("/api/v1/uploads", content=PNG, headers={**ctx.csrf, "Content-Type": "image/png"})
    assert again.json()["name"] == body["name"]

    g = c.get(body["url"])
    assert g.status_code == 200
    assert g.headers["content-type"] == "image/png"
    assert g.headers["x-content-type-options"] == "nosniff"
    assert g.content == PNG

    # the type comes from the bytes, not the declared header
    j = c.post("/api/v1/uploads", content=JPG, headers={**ctx.csrf, "Content-Type": "image/png"})
    assert j.json()["name"].endswith(".jpg")


def test_upload_rejects_non_images_and_bad_names(ctx: Ctx):
    c = ctx.client
    for payload in (b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", b"hello", b""):
        r = c.post("/api/v1/uploads", content=payload, headers={**ctx.csrf, "Content-Type": "image/svg+xml"})
        assert r.status_code == 422, payload
    for bad in ("../researchos.db", "abc.png", "0" * 32 + ".svg", "0" * 32 + ".png"):
        assert c.get(f"/api/v1/uploads/{bad}").status_code == 404


def test_upload_auth_scope_and_csrf(ctx: Ctx):
    c = ctx.client
    # cookie session without the CSRF header
    assert c.post("/api/v1/uploads", content=PNG, headers={"Content-Type": "image/png"}).status_code == 403
    # read-only token cannot upload but can read
    assert c.post("/api/v1/uploads", content=PNG, headers={**ctx.ro, "Content-Type": "image/png"}).status_code == 403
    url = c.post("/api/v1/uploads", content=PNG, headers={**ctx.rw, "Content-Type": "image/png"}).json()["url"]
    assert c.get(url, headers=ctx.ro).status_code == 200
    c.cookies.clear()
    assert c.get(url).status_code == 401


def test_upload_size_limit_is_separate_from_json_limit(tmp_path: Path):
    app = create_app(make_settings(tmp_path, max_body_bytes=1000, upload_max_bytes=5000))
    with TestClient(app) as c:
        csrf = login(c)
        big = PNG + b"\x00" * 2000  # above the JSON limit, below the upload limit
        assert c.post("/api/v1/uploads", content=big, headers={**csrf, "Content-Type": "image/png"}).status_code == 201
        huge = PNG + b"\x00" * 6000
        r = c.post("/api/v1/uploads", content=huge, headers={**csrf, "Content-Type": "image/png"})
        assert r.status_code == 413
        r = c.post("/api/v1/projects", json={"title": "x" * 2000}, headers=csrf)
        assert r.status_code == 413
