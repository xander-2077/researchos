#!/usr/bin/env bash
# Rebuild and restart ResearchOS after code changes (data volume is kept).
#   scripts/update.sh            # backup → rebuild image → recreate changed containers → wait until healthy
#   scripts/update.sh --no-backup
# Equivalent manual command:  docker compose up -d --build
set -euo pipefail
cd "$(dirname "$0")/.."
if [[ "${1:-}" != "--no-backup" ]] && docker compose ps -q researchos 2>/dev/null | grep -q .; then
  scripts/backup.sh || echo "warning: backup failed, continuing" >&2
fi
docker compose up -d --build
CID="$(docker compose ps -q researchos)"
for _ in $(seq 1 60); do
  [[ "$(docker inspect -f '{{.State.Health.Status}}' "$CID" 2>/dev/null)" == "healthy" ]] && { echo "✔ ResearchOS is healthy"; docker compose ps; exit 0; }
  sleep 2
done
echo "ResearchOS did not become healthy; logs:" >&2
docker compose logs --tail 40 researchos >&2
exit 1
