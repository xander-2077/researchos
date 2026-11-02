"""Auth (login/logout/me), API tokens, health, JSON export."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_actor
from app.auth.actor import Actor
from app.core.errors import Forbidden
from app.database.session import get_db
from app.models import User
from app.schemas.entities import LoginRequest, PasswordChange, TokenCreate, TokenCreated, TokenOut
from app.services import auth as auth_svc
from app.services.export import export_all

router = APIRouter()


@router.get("/healthz", tags=["system"])
def healthz(db: Session = Depends(get_db)):
    db.execute(text("SELECT 1"))
    return {"status": "ok"}


# ---------------------------------------------------------------- session auth
@router.post("/auth/login", tags=["auth"])
def login(data: LoginRequest, request: Request, db: Session = Depends(get_db)):
    user = auth_svc.authenticate(db, data.username, data.password)
    request.session.clear()
    request.session["uid"] = user.id
    request.session["csrf"] = secrets.token_urlsafe(32)
    return {"username": user.username, "csrf_token": request.session["csrf"]}


@router.post("/auth/logout", tags=["auth"])
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/auth/me", tags=["auth"])
def me(request: Request, db: Session = Depends(get_db)):
    """Returns the session user and CSRF token, or ``authenticated: false``.
    ``setup_required`` tells the UI that no admin exists yet."""
    uid = request.session.get("uid")
    user = db.get(User, uid) if uid else None
    if user is None:
        return {"authenticated": False, "setup_required": auth_svc.user_count(db) == 0}
    if "csrf" not in request.session:
        request.session["csrf"] = secrets.token_urlsafe(32)
    return {"authenticated": True, "username": user.username, "csrf_token": request.session["csrf"]}


@router.post("/auth/password", tags=["auth"])
def change_password(data: PasswordChange, request: Request, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    if actor.kind != "user":
        raise Forbidden("Password can only be changed from a browser session")
    auth_svc.change_password(db, request.session["uid"], data.current_password, data.new_password)
    return {"ok": True}


# ---------------------------------------------------------------- tokens
@router.get("/tokens", response_model=list[TokenOut], tags=["auth"])
def list_tokens(actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return [auth_svc.token_to_dict(t) for t in auth_svc.list_tokens(db, actor)]


@router.post("/tokens", response_model=TokenCreated, status_code=201, tags=["auth"],
             description="The plaintext token is returned only once.")
def create_token(data: TokenCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    tok, plaintext = auth_svc.create_token(db, actor, data)
    return {**auth_svc.token_to_dict(tok), "token": plaintext}


@router.delete("/tokens/{token_id}", response_model=TokenOut, tags=["auth"])
def revoke_token(token_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return auth_svc.token_to_dict(auth_svc.revoke_token(db, actor, token_id))


# ---------------------------------------------------------------- export
@router.get("/export", tags=["system"], description="Full JSON export of research data (no secrets).")
def export(actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    actor.require_read()
    return export_all(db)
