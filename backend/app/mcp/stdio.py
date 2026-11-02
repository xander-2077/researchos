"""stdio transport for local agents.

Runs the *same* MCPServer and services against the same SQLite database (WAL mode
makes concurrent access with the web server safe). Requires a valid API token so
scopes and audit logging work exactly as over HTTP:

    RESEARCHOS_TOKEN=ros_... RESEARCHOS_DATA_DIR=/path/to/data python -m app.mcp.stdio
"""

from __future__ import annotations

import logging
import os
import sys

from app.core.config import get_settings
from app.database.session import SessionLocal, init_engine
from app.mcp.server import mcp


def main() -> None:
    logging.basicConfig(stream=sys.stderr, level=logging.WARNING)
    token = os.environ.get("RESEARCHOS_TOKEN")
    if not token:
        sys.exit("RESEARCHOS_TOKEN is required for the stdio MCP server")
    settings = get_settings()
    init_engine(settings.sqlalchemy_url)
    from app.services.auth import verify_token

    with SessionLocal() as db:
        verify_token(db, token)  # fail fast on bad/expired tokens
    mcp.run("stdio")


if __name__ == "__main__":
    main()
