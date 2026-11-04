"""Admin user + API token management. Tokens are stored as SHA-256 hashes only."""

from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerifyMismatchError
from sqlalchemy import delete, func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth.actor import Actor
from app.core.errors import Conflict, Forbidden, NotFound, Unauthorized, ValidationFailed
from app.models import ApiToken, Project, ProjectMember, Task, UploadOwner, User, UserInvitation, utcnow
from app.repositories.base import paginate
from app.schemas.entities import TokenCreate, UserCreate, UserUpdate
from app.services.access import require_admin
from app.services.activity import log_event

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
        user = User(username=username, password_hash=_ph.hash(password), is_admin=user_count(db) == 0)
        db.add(user)
        db.flush()
        if user.is_admin:
            for project in db.scalars(select(Project).where(Project.owner_id.is_(None))):
                project.owner_id = user.id
                db.add(ProjectMember(project_id=project.id, user_id=user.id))
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
    if user is None or not user.is_active:
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
    actor.require_write()
    _require_human(actor)
    plaintext = TOKEN_PREFIX + secrets.token_urlsafe(32)
    tok = ApiToken(
        user_id=actor.user_id,
        name=data.name,
        token_prefix=plaintext[:10],
        token_hash=hash_token(plaintext),
        scopes=" ".join(data.scopes),
        expires_at=(utcnow() + timedelta(days=data.expires_in_days)) if data.expires_in_days else None,
    )
    db.add(tok)
    log_event(db, actor, project_id=None, event_type="token_created", summary=f"API token created: {data.name}")
    db.commit()
    db.refresh(tok)
    return tok, plaintext


def list_tokens(db: Session, actor: Actor) -> list[ApiToken]:
    _require_human(actor)
    stmt = select(ApiToken)
    if actor.kind != "system":
        # Legacy CLI tokens have no owner and are visible only to administrators.
        stmt = stmt.where((ApiToken.user_id == actor.user_id) | (ApiToken.user_id.is_(None) & actor.is_admin))
    return list(db.scalars(stmt.order_by(ApiToken.created_at.desc())))


def revoke_token(db: Session, actor: Actor, token_id: int) -> ApiToken:
    actor.require_write()
    _require_human(actor)
    tok = db.get(ApiToken, token_id)
    if tok is None or (actor.kind != "system" and tok.user_id != actor.user_id
                       and not (actor.is_admin and tok.user_id is None)):
        raise NotFound(f"Token {token_id} not found")
    if tok.revoked_at is None:
        tok.revoked_at = utcnow()
        log_event(db, actor, project_id=None, event_type="token_revoked", summary=f"API token revoked: {tok.name}")
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
    if tok.user_id is not None:
        user = db.get(User, tok.user_id)
        if user is None or not user.is_active:
            raise Unauthorized("API token owner is disabled")
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


def user_to_dict(user: User) -> dict:
    return {
        "id": user.id, "username": user.username, "is_admin": user.is_admin,
        "is_active": user.is_active, "registered": bool(user.password_hash),
        "created_at": user.created_at, "last_login_at": user.last_login_at,
    }


def list_users(db: Session, actor: Actor, limit: int | None = None, offset: int = 0):
    require_admin(actor)
    return paginate(db, select(User).order_by(User.id), limit, offset)


def _new_invitation(db: Session, user: User) -> str:
    plaintext = secrets.token_urlsafe(32)
    invitation = db.get(UserInvitation, user.id)
    if invitation is None:
        invitation = UserInvitation(user_id=user.id)
        db.add(invitation)
    invitation.token_hash = hash_token(plaintext)
    invitation.expires_at = utcnow() + timedelta(days=7)
    invitation.used_at = None
    return plaintext


def create_user(db: Session, actor: Actor, data: UserCreate) -> tuple[User, str]:
    require_admin(actor)
    if db.scalar(select(User.id).where(User.username == data.username)) is not None:
        raise Conflict("Username is already taken")
    user = User(username=data.username, password_hash="", is_admin=data.is_admin)
    db.add(user)
    try:
        db.flush()
        token = _new_invitation(db, user)
        log_event(db, actor, project_id=None, event_type="user_invited", summary=f"User invited: {user.username}")
        db.commit()
    except IntegrityError:
        db.rollback()
        raise Conflict("Username is already taken") from None
    return user, token


def renew_invitation(db: Session, actor: Actor, user_id: int) -> tuple[User, str]:
    require_admin(actor)
    user = db.get(User, user_id)
    if user is None:
        raise NotFound("User not found")
    if user.password_hash or not user.is_active:
        raise ValidationFailed("Only enabled, unregistered users can be invited")
    token = _new_invitation(db, user)
    log_event(db, actor, project_id=None, event_type="user_invited", summary=f"Invitation renewed: {user.username}")
    db.commit()
    return user, token


def update_user(db: Session, actor: Actor, user_id: int, data: UserUpdate) -> User:
    require_admin(actor)
    # Serialize account changes before checking the last administrator (SQLite write lock).
    db.execute(update(User).where(User.id == user_id).values(session_version=User.session_version))
    user = db.get(User, user_id, populate_existing=True)
    if user is None:
        raise NotFound("User not found")
    changes = data.model_dump(exclude_unset=True)
    if user.is_admin and user.is_active and user.password_hash and (
        changes.get("is_admin") is False or changes.get("is_active") is False
    ):
        other_admin = db.scalar(select(User.id).where(
            User.id != user.id, User.is_admin.is_(True), User.is_active.is_(True), User.password_hash != "",
        ))
        if other_admin is None:
            raise ValidationFailed("Cannot disable or demote the last active administrator")
    for key, value in changes.items():
        setattr(user, key, value)
    if changes:
        user.session_version += 1
        if not user.is_active:
            db.execute(update(ApiToken).where(ApiToken.user_id == user.id, ApiToken.revoked_at.is_(None)).values(revoked_at=utcnow()))
        log_event(db, actor, project_id=None, event_type="user_updated", summary=f"User updated: {user.username}")
        db.commit()
    return user


def inspect_invitation(db: Session, token: str) -> tuple[User, UserInvitation]:
    invitation = db.scalar(select(UserInvitation).where(UserInvitation.token_hash == hash_token(token)))
    if invitation is None or invitation.used_at is not None or invitation.expires_at <= utcnow():
        raise ValidationFailed("Invitation is invalid or expired")
    user = db.get(User, invitation.user_id)
    if user is None or not user.is_active or user.password_hash:
        raise ValidationFailed("Invitation is invalid or expired")
    return user, invitation


def delete_user(db: Session, actor: Actor, user_id: int) -> None:
    require_admin(actor)
    if actor.kind != "user" or actor.user_id == user_id:
        raise ValidationFailed("You cannot delete your own account")
    # Serialize with role changes; transfer ownership in the same transaction as deletion.
    db.execute(update(User).where(User.id == user_id).values(session_version=User.session_version))
    administrator = db.get(User, actor.user_id, populate_existing=True)
    if administrator is None or not administrator.is_active or not administrator.is_admin:
        raise Forbidden("Administrator access required")
    user = db.get(User, user_id, populate_existing=True)
    if user is None:
        raise NotFound("User not found")
    for project in db.scalars(select(Project).where(Project.owner_id == user_id)):
        project.owner_id = actor.user_id
        if db.get(ProjectMember, (project.id, actor.user_id)) is None:
            db.add(ProjectMember(project_id=project.id, user_id=actor.user_id))
    for task in db.scalars(select(Task).where(Task.owner_id == user_id)):
        if task.project_id is None and task.client_key and db.scalar(select(Task.id).where(
            Task.project_id.is_(None), Task.owner_id == actor.user_id, Task.client_key == task.client_key,
        )) is not None:
            task.client_key = None  # Preserve both tasks when their users used the same key.
        task.owner_id = actor.user_id
    for name in db.scalars(select(UploadOwner.name).where(UploadOwner.user_id == user_id)):
        if db.get(UploadOwner, (name, actor.user_id)) is None:
            db.add(UploadOwner(name=name, user_id=actor.user_id))
    # Delete credentials rather than leaving ownerless tokens with maintenance privileges.
    db.execute(delete(ApiToken).where(ApiToken.user_id == user_id))
    log_event(db, actor, project_id=None, event_type="user_deleted", summary=f"User deleted: {user.username}")
    db.delete(user)  # Memberships, invitations and old upload ownership cascade.
    db.commit()


def register(db: Session, token: str, password: str) -> User:
    if len(password) < 10:
        raise ValidationFailed("Password must be at least 10 characters")
    user, _ = inspect_invitation(db, token)
    password_hash = _ph.hash(password)
    now = utcnow()
    result = db.execute(update(UserInvitation).where(
        UserInvitation.user_id == user.id, UserInvitation.token_hash == hash_token(token),
        UserInvitation.used_at.is_(None), UserInvitation.expires_at > now,
    ).values(used_at=now))
    if result.rowcount != 1:
        db.rollback()
        raise ValidationFailed("Invitation is invalid or expired")
    user.password_hash = password_hash
    user.last_login_at = now
    actor = Actor(kind="user", name=user.username, source="manual", user_id=user.id)
    actor.require_write()
    log_event(db, actor, project_id=None, event_type="user_registered", summary=f"User registered: {user.username}")
    db.commit()
    return user
