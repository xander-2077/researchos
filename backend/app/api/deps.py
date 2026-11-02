"""Request authentication → ``Actor``.

* ``Authorization: Bearer ros_...`` → API token (scopes read / read+write)
* otherwise the signed session cookie set by ``/api/v1/auth/login``. Unsafe methods
  with cookie auth must echo the session's CSRF token in ``X-CSRF-Token``.
"""

from __future__ import annotations

import secrets

from fastapi import Depends, Request
from sqlalchemy.orm import Session

from app.auth.actor import Actor, infer_agent_source
from app.core.errors import Forbidden, Unauthorized
from app.database.session import get_db
from app.models import User
from app.services.auth import verify_token

SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def actor_from_bearer(db: Session, header_value: str, source_header: str | None, default_source: str) -> Actor:
    scheme, _, token = header_value.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        raise Unauthorized("Use 'Authorization: Bearer <token>'")
    tok = verify_token(db, token.strip())
    source = infer_agent_source(tok.name, source_header, default_source)
    return Actor(kind="token", name=f"token:{tok.name}", source=source, scopes=frozenset(tok.scope_list), token_id=tok.id)


def get_actor(request: Request, db: Session = Depends(get_db)) -> Actor:
    auth = request.headers.get("authorization")
    if auth:
        actor = actor_from_bearer(db, auth, request.headers.get("x-researchos-source"), "rest_api")
        request.state.actor = actor
        return actor
    uid = request.session.get("uid")
    if not uid:
        raise Unauthorized("Not authenticated")
    if request.method not in SAFE_METHODS:
        expected = request.session.get("csrf")
        got = request.headers.get("x-csrf-token", "")
        if not expected or not secrets.compare_digest(expected, got):
            raise Forbidden("Missing or invalid CSRF token", code="csrf_failed")
    user = db.get(User, uid)
    if user is None:
        request.session.clear()
        raise Unauthorized("Session expired")
    actor = Actor(kind="user", name=user.username, source="manual")
    request.state.actor = actor
    return actor
