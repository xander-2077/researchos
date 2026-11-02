#!/usr/bin/env bash
# One-time dev setup: Python venv (3.11+) + frontend deps.
set -euo pipefail
cd "$(dirname "$0")/.."
if command -v uv >/dev/null; then
  uv venv -p 3.12 backend/.venv && uv pip install -p backend/.venv/bin/python -r backend/requirements-dev.txt
else
  python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements-dev.txt
fi
(cd frontend && npm ci)
echo "Done. Next: RESEARCHOS_ADMIN_PASSWORD=... scripts/dev.sh"
