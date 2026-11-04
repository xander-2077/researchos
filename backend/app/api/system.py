"""Auth (login/logout/me), API tokens, health, JSON export."""

from __future__ import annotations

import secrets

from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.api.deps import get_actor
from app.auth.actor import Actor
from app.core.errors import Forbidden
from app.database.session import get_db
from app.models import User
from app.schemas.common import Page
from app.schemas.entities import (InvitationCreated, InvitationInspect, LoginRequest, PasswordChange,
                                 RegisterRequest, TokenCreate, TokenCreated, TokenOut, UserCreate, UserOut, UserUpdate)
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
    return _session_response(request, user)


def _session_response(request: Request, user: User):
    request.session.clear()
    request.session["uid"] = user.id
    request.session["sv"] = user.session_version
    request.session["csrf"] = secrets.token_urlsafe(32)
    return {"authenticated": True, "username": user.username, "user_id": user.id, "is_admin": user.is_admin,
            "csrf_token": request.session["csrf"]}


@router.post("/auth/invitation", tags=["auth"])
def inspect_invitation(data: InvitationInspect, db: Session = Depends(get_db)):
    user, invitation = auth_svc.inspect_invitation(db, data.token)
    return {"username": user.username, "expires_at": invitation.expires_at}


@router.post("/auth/register", status_code=201, tags=["auth"])
def register(data: RegisterRequest, request: Request, db: Session = Depends(get_db)):
    return _session_response(request, auth_svc.register(db, data.token, data.password))


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
    if user is not None and (not user.is_active or request.session.get("sv") != user.session_version):
        request.session.clear()
        user = None
    if user is None:
        return {"authenticated": False, "setup_required": auth_svc.user_count(db) == 0}
    if "csrf" not in request.session:
        request.session["csrf"] = secrets.token_urlsafe(32)
    return {"authenticated": True, "username": user.username, "user_id": user.id, "is_admin": user.is_admin,
            "csrf_token": request.session["csrf"]}


def _invitation_response(db: Session, user: User, token: str):
    from app.models import UserInvitation

    return {"user": auth_svc.user_to_dict(user), "invitation_path": f"/register#invite={token}",
            "expires_at": db.get(UserInvitation, user.id).expires_at}


@router.get("/users", response_model=Page[UserOut], tags=["users"])
def list_users(limit: int | None = Query(None, ge=1), offset: int = Query(0, ge=0),
               actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    rows, total, lim, off = auth_svc.list_users(db, actor, limit, offset)
    return {"items": [auth_svc.user_to_dict(u) for u in rows], "total": total, "limit": lim, "offset": off}


@router.post("/users", response_model=InvitationCreated, status_code=201, tags=["users"])
def create_user(data: UserCreate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    user, token = auth_svc.create_user(db, actor, data)
    return _invitation_response(db, user, token)


@router.post("/users/{user_id}/invitation", response_model=InvitationCreated, tags=["users"])
def renew_invitation(user_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    user, token = auth_svc.renew_invitation(db, actor, user_id)
    return _invitation_response(db, user, token)


@router.patch("/users/{user_id}", response_model=UserOut, tags=["users"])
def update_user(user_id: int, data: UserUpdate, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    return auth_svc.user_to_dict(auth_svc.update_user(db, actor, user_id, data))


@router.delete("/users/{user_id}", status_code=204, tags=["users"])
def delete_user(user_id: int, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    auth_svc.delete_user(db, actor, user_id)


@router.post("/auth/password", tags=["auth"])
def change_password(data: PasswordChange, request: Request, actor: Actor = Depends(get_actor), db: Session = Depends(get_db)):
    if actor.kind != "user":
        raise Forbidden("Password can only be changed from a browser session")
    user = auth_svc.change_password(db, request.session["uid"], data.current_password, data.new_password)
    # Every other session is now invalid; keep this one (rotate the CSRF token too).
    request.session["sv"] = user.session_version
    request.session["csrf"] = secrets.token_urlsafe(32)
    return {"ok": True, "csrf_token": request.session["csrf"]}


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
    return export_all(db, actor)
