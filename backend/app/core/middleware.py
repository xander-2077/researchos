"""Small pure-ASGI middlewares: body size limit, rate limiting, security headers."""

from __future__ import annotations

import json
import time
from collections import defaultdict, deque

from starlette.types import ASGIApp, Message, Receive, Scope, Send


async def _send_json(send: Send, status: int, code: str, message: str, headers: list | None = None) -> None:
    body = json.dumps({"error": {"code": code, "message": message}}).encode()
    await send({
        "type": "http.response.start",
        "status": status,
        "headers": [(b"content-type", b"application/json"), (b"content-length", str(len(body)).encode())]
        + (headers or []),
    })
    await send({"type": "http.response.body", "body": body})


class BodySizeLimitMiddleware:
    def __init__(self, app: ASGIApp, max_bytes: int) -> None:
        self.app = app
        self.max_bytes = max_bytes

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        for k, v in scope.get("headers", []):
            if k == b"content-length" and v.isdigit() and int(v) > self.max_bytes:
                return await _send_json(send, 413, "payload_too_large", f"Request body exceeds {self.max_bytes} bytes")
        received = 0

        async def limited_receive() -> Message:
            nonlocal received
            msg = await receive()
            if msg["type"] == "http.request":
                received += len(msg.get("body", b""))
                if received > self.max_bytes:
                    raise _TooLarge()
            return msg

        try:
            await self.app(scope, limited_receive, send)
        except _TooLarge:
            await _send_json(send, 413, "payload_too_large", f"Request body exceeds {self.max_bytes} bytes")


class _TooLarge(Exception):
    pass


class RateLimitMiddleware:
    """Sliding-window limiter per client IP (and stricter for the login endpoint).
    In-memory; adequate for a single-process, single-user deployment."""

    def __init__(self, app: ASGIApp, per_minute: int, login_per_minute: int) -> None:
        self.app = app
        self.per_minute = per_minute
        self.login_per_minute = login_per_minute
        self.hits: dict[str, deque[float]] = defaultdict(deque)

    def _allow(self, key: str, limit: int) -> bool:
        now = time.monotonic()
        q = self.hits[key]
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= limit:
            return False
        q.append(now)
        if len(self.hits) > 10_000:  # bound memory
            self.hits.clear()
        return True

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or self.per_minute <= 0:
            return await self.app(scope, receive, send)
        path: str = scope.get("path", "")
        if not (path.startswith("/api/") or path.startswith("/mcp")):
            return await self.app(scope, receive, send)
        client = scope.get("client") or ("unknown", 0)
        ip = client[0]
        if path == "/api/v1/auth/login" and scope.get("method") == "POST":
            if not self._allow(f"login:{ip}", self.login_per_minute):
                return await _send_json(send, 429, "rate_limited", "Too many login attempts; wait a minute",
                                        [(b"retry-after", b"60")])
        if not self._allow(f"ip:{ip}", self.per_minute):
            return await _send_json(send, 429, "rate_limited", "Too many requests; slow down",
                                    [(b"retry-after", b"10")])
        await self.app(scope, receive, send)


class SecurityHeadersMiddleware:
    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            return await self.app(scope, receive, send)

        async def wrapped(msg: Message) -> None:
            if msg["type"] == "http.response.start":
                headers = list(msg.get("headers", []))
                names = {k.lower() for k, _ in headers}
                extra = {
                    b"x-content-type-options": b"nosniff",
                    b"x-frame-options": b"DENY",
                    b"referrer-policy": b"same-origin",
                }
                if not scope.get("path", "").startswith("/api/docs"):
                    extra[b"content-security-policy"] = (
                        b"default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                        b"script-src 'self'; connect-src 'self'; frame-ancestors 'none'"
                    )
                for k, v in extra.items():
                    if k not in names:
                        headers.append((k, v))
                msg["headers"] = headers
            await send(msg)

        await self.app(scope, receive, wrapped)
