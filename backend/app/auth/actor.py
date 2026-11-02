"""The ``Actor`` describes who performs an operation. Every service call receives one;
it drives permission checks and the ``source``/``actor`` fields of the activity log."""

from __future__ import annotations

from dataclasses import dataclass, field

from app.core.enums import SOURCES
from app.core.errors import Forbidden


@dataclass(frozen=True)
class Actor:
    kind: str  # "user" (browser session) | "token" (API/MCP) | "system"
    name: str
    source: str  # one of SOURCES
    scopes: frozenset[str] = field(default_factory=lambda: frozenset({"read", "write"}))
    token_id: int | None = None

    @property
    def is_human(self) -> bool:
        """Only a logged-in human (or system maintenance) may mark science as verified."""
        return self.kind in ("user", "system")

    @property
    def is_agent(self) -> bool:
        return self.kind == "token"

    def require_read(self) -> None:
        if "read" not in self.scopes:
            raise Forbidden("This credential has no read scope")

    def require_write(self) -> None:
        if "write" not in self.scopes:
            raise Forbidden(
                "This token is read-only. Create a read/write token in Settings → API Tokens to make changes.",
                code="insufficient_scope",
            )

    def with_source(self, source: str | None) -> Actor:
        if not source or source == self.source:
            return self
        if source not in SOURCES:
            return self
        # Humans can't impersonate agents and vice versa only for "manual".
        if self.is_agent and source == "manual":
            return self
        return Actor(self.kind, self.name, source, self.scopes, self.token_id)


SYSTEM = Actor(kind="system", name="system", source="system")


def infer_agent_source(token_name: str, header: str | None, default: str) -> str:
    """Source for token-authenticated calls: explicit header wins, then token-name hint."""
    if header:
        h = header.strip().lower().replace("-", "_").replace(" ", "_")
        if h in SOURCES and h != "manual":
            return h
    n = token_name.lower()
    if "claude" in n:
        return "claude_code"
    if "codex" in n:
        return "codex"
    return default
