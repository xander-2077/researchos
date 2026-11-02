#!/usr/bin/env bash
# Restore a backup created by scripts/backup.sh. The current database is first saved as
# researchos.db.pre-restore-<timestamp> inside the data volume. Schema is upgraded afterwards.
#
#   scripts/restore.sh backups/researchos-20261102T120000Z.db           # Docker Compose
#   scripts/restore.sh backups/researchos-20261102T120000Z.db --local   # bare-metal/dev
set -euo pipefail
cd "$(dirname "$0")/.."
SRC="${1:?usage: scripts/restore.sh <backup.db> [--local]}"
[[ -f "$SRC" ]] || { echo "No such file: $SRC" >&2; exit 1; }
SRC_ABS="$(realpath "$SRC")"

if [[ "${2:-}" == "--local" ]]; then
  echo "Stop the ResearchOS server before restoring. Continue? [y/N]"; read -r ok; [[ "$ok" == "y" ]] || exit 1
  (cd backend && .venv/bin/python -m app.cli restore "$SRC_ABS" --yes)
else
  echo "Stopping ResearchOS…"
  docker compose stop researchos
  docker compose run --rm --no-deps -v "$SRC_ABS:/restore/backup.db:ro" researchos \
    python -m app.cli restore /restore/backup.db --yes
  docker compose start researchos
fi
echo "Restore complete."
