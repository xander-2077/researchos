#!/usr/bin/env bash
# Development: backend with auto-reload on :8000 and Vite dev server on :5173 (proxies /api and /mcp).
set -euo pipefail
cd "$(dirname "$0")/.."
export RESEARCHOS_DATA_DIR="${RESEARCHOS_DATA_DIR:-$PWD/backend/data}"
(cd backend && .venv/bin/uvicorn app.main:create_app --factory --reload --host 127.0.0.1 --port 8000) &
BACK=$!
trap 'kill $BACK 2>/dev/null' EXIT
(cd frontend && npm run dev)
