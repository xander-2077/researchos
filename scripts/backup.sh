#!/usr/bin/env bash
# Consistent online backup of the ResearchOS SQLite database (SQLite backup API; safe in WAL mode
# while the server is running). Writes ./backups/researchos-<UTC timestamp>.db on the host.
#
#   scripts/backup.sh                # Docker Compose deployment (default)
#   scripts/backup.sh --local        # bare-metal/dev (uses backend/.venv and RESEARCHOS_DATA_DIR)
set -euo pipefail
cd "$(dirname "$0")/.."
OUT_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NAME="researchos-$STAMP.db"

if [[ "${1:-}" == "--local" ]]; then
  (cd backend && .venv/bin/python -m app.cli backup "$(realpath -m "../$OUT_DIR/$NAME")")
else
  docker compose exec -T researchos python -m app.cli backup "/data/backups/$NAME" >/dev/null
  docker compose cp "researchos:/data/backups/$NAME" "$OUT_DIR/$NAME"
fi
echo "Backup written to $OUT_DIR/$NAME"
# Keep the newest 30 local backups
ls -1t "$OUT_DIR"/researchos-*.db 2>/dev/null | tail -n +31 | xargs -r rm --
