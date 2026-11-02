from __future__ import annotations

import socket
import threading
import time
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path

import pytest
import uvicorn
from fastapi.testclient import TestClient

from app.core.config import Settings
from app.main import create_app

ADMIN_PW = "test-password-123"


def make_settings(tmp: Path, **kw) -> Settings:
    return Settings(
        data_dir=tmp,
        admin_password=ADMIN_PW,
        secret_key="test-secret",
        rate_limit_per_minute=0,
        frontend_dist=tmp / "no-frontend",
        **kw,
    )


@dataclass
class Ctx:
    client: TestClient
    csrf: dict[str, str]
    rw: dict[str, str]
    ro: dict[str, str]
    rw_token: str
    ro_token: str


def login(client: TestClient) -> dict[str, str]:
    r = client.post("/api/v1/auth/login", json={"username": "admin", "password": ADMIN_PW})
    assert r.status_code == 200, r.text
    return {"X-CSRF-Token": r.json()["csrf_token"]}


def _make_token(client: TestClient, csrf: dict[str, str], name: str, scopes: list[str]) -> str:
    r = client.post("/api/v1/tokens", json={"name": name, "scopes": scopes}, headers=csrf)
    assert r.status_code == 201, r.text
    return r.json()["token"]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return make_settings(tmp_path)


@pytest.fixture
def ctx(settings: Settings) -> Iterator[Ctx]:
    app = create_app(settings)
    with TestClient(app) as client:
        csrf = login(client)
        rw = _make_token(client, csrf, "codex-agent", ["read", "write"])
        ro = _make_token(client, csrf, "readonly", ["read"])
        yield Ctx(client, csrf, {"Authorization": f"Bearer {rw}"}, {"Authorization": f"Bearer {ro}"}, rw, ro)


@pytest.fixture
def api(ctx: Ctx) -> TestClient:
    """Token-authenticated client helper (cookie removed so only bearer auth applies)."""
    return ctx.client


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@dataclass
class LiveServer:
    url: str
    rw_token: str
    ro_token: str
    client: TestClient
    csrf: dict[str, str]


@pytest.fixture
def live_server(tmp_path: Path) -> Iterator[LiveServer]:
    """Real uvicorn server on a random port, for MCP protocol tests."""
    settings = make_settings(tmp_path)
    app = create_app(settings)
    port = _free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, log_level="warning", lifespan="on"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    for _ in range(100):
        if server.started:
            break
        time.sleep(0.05)
    assert server.started
    # A separate TestClient (no lifespan) against the same DB for setup via REST.
    client = TestClient(app)
    csrf = login(client)
    rw = _make_token(client, csrf, "claude-code", ["read", "write"])
    ro = _make_token(client, csrf, "readonly", ["read"])
    try:
        yield LiveServer(f"http://127.0.0.1:{port}", rw, ro, client, csrf)
    finally:
        server.should_exit = True
        th.join(timeout=5)
