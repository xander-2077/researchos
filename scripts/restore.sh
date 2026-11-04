#!/usr/bin/env bash
# Restore a backup created by scripts/backup.sh, including its sibling uploads/ archive.
# Validate images and upgrade a staged database before replacement. Save the current
# database as researchos.db.pre-restore-<timestamp> inside the data volume.
#
#   scripts/restore.sh backups/researchos-20261102T120000Z.db           # Docker Compose
#   scripts/restore.sh backups/researchos-20261102T120000Z.db --local   # bare-metal/dev
set -euo pipefail
SRC="${1:?usage: scripts/restore.sh <backup.db> [--local]}"
[[ -f "$SRC" ]] || { echo "No such file: $SRC" >&2; exit 1; }
SRC_ABS="$(realpath "$SRC")"
cd "$(dirname "$0")/.."

if [[ "${2:-}" == "--local" ]]; then
  echo "Stop the ResearchOS server before restoring. Continue? [y/N]"; read -r ok; [[ "$ok" == "y" ]] || exit 1
  (cd backend && .venv/bin/python -m app.cli restore "$SRC_ABS" --yes)
else
  echo "Stopping ResearchOS…"
  restart_after_restore() {
    status=$?
    if ! docker compose start researchos; then
      echo "Could not restart ResearchOS; run docker compose start researchos manually." >&2
      status=1
    fi
    exit "$status"
  }
  trap restart_after_restore EXIT
  trap 'exit 130' INT
  trap 'exit 143' TERM
  docker compose stop researchos
  # Stream private host files into container-owned staging. A bind mount cannot
  # be read by the app UID when the host backup directory uses mode 0700.
  ARCHIVE_FILES=("$(basename "$SRC_ABS")")
  if [[ -d "$(dirname "$SRC_ABS")/uploads" ]]; then ARCHIVE_FILES+=(uploads); fi
  tar -C "$(dirname "$SRC_ABS")" -cf - -- "${ARCHIVE_FILES[@]}" \
    | docker compose run --rm -T --no-deps researchos sh -c '
        set -eu
        stage=$(mktemp -d "/data/.restore-input-XXXXXX")
        trap '\''rm -rf -- "$stage"'\'' EXIT
        tar --no-same-owner -xf - -C "$stage"
        python -m app.cli restore "$stage/$1" --yes
      ' sh "$(basename "$SRC_ABS")"
  docker compose start researchos
  trap - EXIT INT TERM
fi
echo "Restore complete."
