"""Application settings, loaded from environment variables (prefix ``RESEARCHOS_``)."""

from __future__ import annotations

import secrets
from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="RESEARCHOS_", env_file=".env", extra="ignore")

    # Storage
    data_dir: Path = Path("./data")
    database_url: str | None = None  # defaults to sqlite:///<data_dir>/researchos.db
    auto_migrate: bool = True

    # Security
    secret_key: str | None = None  # session signing key; generated + persisted in data_dir if unset
    admin_username: str = "admin"
    admin_password: str | None = None  # bootstrap admin on first start if no user exists
    cookie_secure: bool = False  # set true behind HTTPS
    session_max_age_days: int = 14
    cors_origins: list[str] = []  # empty = same-origin only
    rate_limit_per_minute: int = 600
    login_rate_limit_per_minute: int = 10
    max_body_bytes: int = 1_000_000

    # MCP: Host header allow-list for DNS-rebinding protection. Empty = disabled
    # (Bearer tokens are always required regardless).
    mcp_allowed_hosts: list[str] = []

    # Frontend build to serve (if present)
    frontend_dist: Path = Path(__file__).resolve().parents[3] / "frontend" / "dist"

    # Query guardrails
    default_page_size: int = 50
    max_page_size: int = 200

    @property
    def sqlalchemy_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite:///{(self.data_dir / 'researchos.db').resolve()}"

    def resolved_secret_key(self) -> str:
        if self.secret_key:
            return self.secret_key
        self.data_dir.mkdir(parents=True, exist_ok=True)
        key_file = self.data_dir / ".secret_key"
        if key_file.exists():
            return key_file.read_text().strip()
        key = secrets.token_urlsafe(48)
        key_file.write_text(key)
        key_file.chmod(0o600)
        return key


@lru_cache
def get_settings() -> Settings:
    return Settings()
