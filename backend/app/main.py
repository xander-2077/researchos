"""ASGI entry point: REST API (/api/v1), MCP Streamable HTTP (/mcp), SPA (/)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from mcp.server.transport_security import TransportSecuritySettings
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.sessions import SessionMiddleware
from starlette.routing import Route
from starlette.staticfiles import StaticFiles
from starlette.types import ASGIApp, Receive, Scope, Send

from app.api import projects as projects_api
from app.api import system as system_api
from app.api import uploads as uploads_api
from app.api import work as work_api
from app.core.config import Settings, get_settings
from app.core.errors import AppError
from app.core.middleware import BodySizeLimitMiddleware, RateLimitMiddleware, SecurityHeadersMiddleware
from app.database.migrate import upgrade_to_head
from app.database.session import SessionLocal, init_engine
from app.mcp.server import mcp

log = logging.getLogger("researchos")


class _AccessLogFilter(logging.Filter):
    """Never let query strings / tokens leak into access logs."""

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.args, tuple) and len(record.args) >= 3 and isinstance(record.args[2], str):
            args = list(record.args)
            args[2] = args[2].split("?", 1)[0]
            record.args = tuple(args)
        return True


logging.getLogger("uvicorn.access").addFilter(_AccessLogFilter())


class MCPAuthGuard:
    """Rejects unauthenticated MCP HTTP requests before they reach the protocol layer.
    (Tools re-check the token and scopes on every call.)"""

    def __init__(self, app: ASGIApp) -> None:
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        from app.api.deps import actor_from_bearer
        from app.core.errors import Unauthorized

        headers = {k.decode().lower(): v.decode() for k, v in scope.get("headers", [])}
        auth = headers.get("authorization")
        if not auth:
            return await JSONResponse(
                {"error": {"code": "unauthorized", "message": "Bearer token required"}},
                status_code=401, headers={"WWW-Authenticate": 'Bearer realm="researchos"'},
            )(scope, receive, send)
        db = SessionLocal()
        try:
            actor_from_bearer(db, auth, headers.get("x-researchos-source"), "mcp")
        except Unauthorized as e:
            return await JSONResponse(e.to_dict(), status_code=401,
                                      headers={"WWW-Authenticate": 'Bearer error="invalid_token"'})(scope, receive, send)
        finally:
            db.close()
        await self.app(scope, receive, send)


def bootstrap_admin(settings: Settings) -> None:
    from app.services.auth import set_password, user_count

    if not settings.admin_password:
        return
    db = SessionLocal()
    try:
        if user_count(db) == 0:
            set_password(db, settings.admin_username, settings.admin_password)
            log.warning("Created admin user '%s' from RESEARCHOS_ADMIN_PASSWORD", settings.admin_username)
    finally:
        db.close()


async def _prune_uploads_daily(settings: Settings) -> None:
    """Remove images no note references any more: shortly after start, then once a day."""
    from app.services.uploads import prune_uploads

    def run() -> None:
        with SessionLocal() as db:
            prune_uploads(db, settings.data_dir / "uploads")

    await asyncio.sleep(60)
    while True:
        try:
            await asyncio.to_thread(run)
        except Exception:  # pragma: no cover - housekeeping must never take the server down
            logging.getLogger(__name__).exception("Pruning uploads failed")
        await asyncio.sleep(24 * 3600)


def create_app(settings: Settings | None = None) -> FastAPI:
    settings = settings or get_settings()
    init_engine(settings.sqlalchemy_url)
    if settings.auto_migrate:
        upgrade_to_head(settings.sqlalchemy_url)
    bootstrap_admin(settings)

    security = (
        TransportSecuritySettings(enable_dns_rebinding_protection=True, allowed_hosts=settings.mcp_allowed_hosts,
                                  allowed_origins=[])
        if settings.mcp_allowed_hosts
        else TransportSecuritySettings(enable_dns_rebinding_protection=False)
    )
    mcp_app = mcp.streamable_http_app(
        streamable_http_path="/mcp", stateless_http=True, json_response=True, transport_security=security,
        max_request_body_size=settings.max_body_bytes,
    )
    mcp_endpoint = next(r for r in mcp_app.routes if isinstance(r, Route) and r.path == "/mcp").endpoint

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        housekeeping = asyncio.create_task(_prune_uploads_daily(settings))
        try:
            async with mcp.session_manager.run():
                yield
        finally:
            housekeeping.cancel()

    app = FastAPI(
        title="ResearchOS API",
        version="0.1.0",
        description="Research portfolio management. Authenticate with `Authorization: Bearer <token>`.",
        docs_url="/api/docs",
        redoc_url=None,
        openapi_url="/api/openapi.json",
        lifespan=lifespan,
    )

    @app.exception_handler(AppError)
    async def _app_error(_: Request, exc: AppError):
        return JSONResponse(exc.to_dict(), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_: Request, exc: RequestValidationError):
        errors = [
            {"loc": [str(p) for p in e.get("loc", [])], "msg": e.get("msg"), "type": e.get("type")}
            for e in exc.errors()
        ]
        return JSONResponse(
            {"error": {"code": "validation_error", "message": "Invalid request", "details": errors}},
            status_code=422,
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_: Request, exc: StarletteHTTPException):
        return JSONResponse(
            {"error": {"code": "http_error", "message": str(exc.detail)}}, status_code=exc.status_code,
            headers=getattr(exc, "headers", None),
        )

    @app.exception_handler(Exception)
    async def _unhandled(_: Request, exc: Exception):  # pragma: no cover
        log.exception("Unhandled error")
        return JSONResponse({"error": {"code": "internal_error", "message": "Internal server error"}}, status_code=500)

    app.state.settings = settings
    for r in (system_api.router, projects_api.router, work_api.router, uploads_api.router):
        app.include_router(r, prefix="/api/v1")

    # MCP Streamable HTTP endpoint (shares process, DB and services).
    app.router.routes.append(Route("/mcp", endpoint=MCPAuthGuard(mcp_endpoint), methods=["GET", "POST", "DELETE"]))

    # Middlewares (last added = outermost)
    app.add_middleware(
        SessionMiddleware,
        secret_key=settings.resolved_secret_key(),
        session_cookie="researchos_session",
        max_age=settings.session_max_age_days * 86400,
        same_site="strict",
        https_only=settings.cookie_secure,
    )
    if settings.cors_origins:
        app.add_middleware(
            CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
            allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Authorization", "Content-Type", "X-CSRF-Token", "X-ResearchOS-Source"],
        )
    app.add_middleware(RateLimitMiddleware, per_minute=settings.rate_limit_per_minute,
                       login_per_minute=settings.login_rate_limit_per_minute)
    app.add_middleware(BodySizeLimitMiddleware, max_bytes=settings.max_body_bytes,
                       overrides={"/api/v1/uploads": settings.upload_max_bytes})
    app.add_middleware(SecurityHeadersMiddleware)

    _mount_frontend(app, settings.frontend_dist)
    return app


def _mount_frontend(app: FastAPI, dist: Path) -> None:
    index = dist / "index.html"
    if not index.exists():
        @app.get("/", include_in_schema=False)
        def _no_ui():
            return JSONResponse({"message": "ResearchOS API is running. Frontend build not found; see README.",
                                 "docs": "/api/docs"})
        return
    if (dist / "assets").exists():
        app.mount("/assets", StaticFiles(directory=dist / "assets"), name="assets")

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    def _spa(path: str):
        if path.startswith(("api/", "mcp")):
            return JSONResponse({"error": {"code": "not_found", "message": "Not found"}}, status_code=404)
        candidate = (dist / path).resolve()
        if path and candidate.is_file() and dist.resolve() in candidate.parents:
            return FileResponse(candidate)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})


# Run with: uvicorn app.main:create_app --factory
