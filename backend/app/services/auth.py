"""Admin user + API token management. Tokens are stored as SHA-256 hashes only."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.core.errors import Forbidden, NotFound, Unauthorized, ValidationFailed
from app.models import ApiToken, User, utcnow
from app.schemas.entities import TokenCreate

_ph = PasswordHasher()
TOKEN_PREFIX = "ros_"
# Dummy hash so failed logins for unknown users take similar time.
_DUMMY_HASH = _ph.hash("researchos-dummy-password")


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


# ------------------------------------------------------------------ users
def user_count(db: Session) -> int:
    return db.scalar(select(func.count()).select_from(User)) or 0


def set_password(db: Session, username: str, password: str) -> User:
    if len(password) < 10:
        raise ValidationFailed("Password must be at least 10 characters")
    user = db.scalar(select(User).where(User.username == username))
    if user is None:
        user = User(username=username, password_hash=_ph.hash(password))
        db.add(user)
    else:
        user.password_hash = _ph.hash(password)
        user.session_version = (user.session_version or 1) + 1  # invalidates all existing sessions
    db.commit()
    db.refresh(user)
    return user


def rename_user(db: Session, old: str, new: str) -> User:
    """Change the login name. All existing sessions are invalidated."""
    new = new.strip()
    if not (1 <= len(new) <= 64):
        raise ValidationFailed("Username must be 1-64 characters")
    user = db.scalar(select(User).where(User.username == old))
    if user is None:
        raise NotFound(f"User '{old}' not found")
    if user.username == new:
        return user
    if db.scalar(select(User.id).where(User.username == new)) is not None:
        raise ValidationFailed(f"Username '{new}' is already taken")
    user.username = new
    user.session_version = (user.session_version or 1) + 1
    db.commit()
    db.refresh(user)
    return user


def authenticate(db: Session, username: str, password: str) -> User:
    user = db.scalar(select(User).where(User.username == username))
    try:
        _ph.verify(user.password_hash if user else _DUMMY_HASH, password)
    except (VerifyMismatchError, InvalidHashError):
        raise Unauthorized("Invalid username or password") from None
    if user is None:
        raise Unauthorized("Invalid username or password")
    if _ph.check_needs_rehash(user.password_hash):
        user.password_hash = _ph.hash(password)
    user.last_login_at = utcnow()
    db.commit()
    return user


def change_password(db: Session, user_id: int, current: str, new: str) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    try:
        _ph.verify(user.password_hash, current)
    except (VerifyMismatchError, InvalidHashError):
        raise Unauthorized("Current password is incorrect") from None
    return set_password(db, user.username, new)


# ------------------------------------------------------------------ tokens
def _require_human(actor: Actor) -> None:
    if not actor.is_human:
        raise Forbidden("API tokens can only be managed from a logged-in browser session or the CLI")


def create_token(db: Session, actor: Actor, data: TokenCreate) -> tuple[ApiToken, str]:
    _require_human(actor)
    plaintext = TOKEN_PREFIX + secrets.token_urlsafe(32)
    tok = ApiToken(
        name=data.name,
        token_prefix=plaintext[:10],
        token_hash=hash_token(plaintext),
        scopes=" ".join(data.scopes),
        expires_at=(utcnow() + timedelta(days=data.expires_in_days)) if data.expires_in_days else None,
    )
    db.add(tok)
    db.commit()
    db.refresh(tok)
    return tok, plaintext


def list_tokens(db: Session, actor: Actor) -> list[ApiToken]:
    _require_human(actor)
    return list(db.scalars(select(ApiToken).order_by(ApiToken.created_at.desc())))


def revoke_token(db: Session, actor: Actor, token_id: int) -> ApiToken:
    _require_human(actor)
    tok = db.get(ApiToken, token_id)
    if tok is None:
        raise NotFound(f"Token {token_id} not found")
    if tok.revoked_at is None:
        tok.revoked_at = utcnow()
        db.commit()
    return tok


def verify_token(db: Session, plaintext: str) -> ApiToken:
    """Return the active token or raise Unauthorized. Updates last_used_at (throttled)."""
    if not plaintext or not plaintext.startswith(TOKEN_PREFIX):
        raise Unauthorized("Invalid API token")
    tok = db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(plaintext)))
    if tok is None or not secrets.compare_digest(tok.token_hash, hash_token(plaintext)):
        raise Unauthorized("Invalid API token")
    now = datetime.now(timezone.utc)
    if tok.revoked_at is not None:
        raise Unauthorized("API token has been revoked")
    if tok.expires_at is not None and tok.expires_at <= now:
        raise Unauthorized("API token has expired")
    if tok.last_used_at is None or (now - tok.last_used_at) > timedelta(minutes=1):
        tok.last_used_at = now
        db.commit()
    return tok


def token_to_dict(t: ApiToken) -> dict:
    return {
        "id": t.id, "name": t.name, "token_prefix": t.token_prefix, "scopes": t.scope_list,
        "created_at": t.created_at, "expires_at": t.expires_at, "last_used_at": t.last_used_at,
        "revoked_at": t.revoked_at,
    }
