#!/usr/bin/env bash
# Full acceptance run against Docker Compose with a FRESH, isolated volume:
#   empty DB → browser/REST/MCP scenario (scripts/e2e_acceptance.py) → docker compose down/up →
#   data still present → read-only token still rejected.
# Requires: built image (docker compose build), backend/.venv with requirements-dev.txt + `playwright install chromium`.
set -euo pipefail
cd "$(dirname "$0")/.."
export COMPOSE_PROJECT_NAME=researchos-acceptance
export RESEARCHOS_VOLUME=researchos-acceptance-data
export RESEARCHOS_PORT="${RESEARCHOS_PORT:-8100}"
PW="acceptance-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
ENVF="$(mktemp)"; printf 'RESEARCHOS_ADMIN_PASSWORD=%s\n' "$PW" > "$ENVF"
BASE="http://127.0.0.1:$RESEARCHOS_PORT"
STATE="$(mktemp)"
cleanup() { docker compose --env-file "$ENVF" down -v >/dev/null 2>&1 || true; rm -f "$ENVF" "$STATE"; }
trap cleanup EXIT

wait_healthy() {
  for _ in $(seq 1 60); do
    curl -fsS "$BASE/api/v1/healthz" >/dev/null 2>&1 && return 0; sleep 1
  done
  echo "server did not become healthy" >&2; docker compose logs --tail 50; return 1
}

docker compose --env-file "$ENVF" down -v >/dev/null 2>&1 || true
docker compose --env-file "$ENVF" up -d --no-build
wait_healthy
(cd backend && .venv/bin/python ../scripts/e2e_acceptance.py --base "$BASE" --password "$PW" --state-file "$STATE")

echo "--- 8. restart: docker compose down && up (volume kept)"
docker compose --env-file "$ENVF" down
docker compose --env-file "$ENVF" up -d --no-build
wait_healthy
RO=$(python3 -c "import json,sys;print(json.load(open('$STATE'))['ro_token'])")
N=$(curl -fsS "$BASE/api/v1/projects" -H "Authorization: Bearer $RO" | python3 -c "import json,sys;print(json.load(sys.stdin)['total'])")
E=$(curl -fsS "$BASE/api/v1/experiments" -H "Authorization: Bearer $RO" | python3 -c "import json,sys;print(json.load(sys.stdin)['total'])")
[[ "$N" == "3" && "$E" == "1" ]] || { echo "persistence check failed: projects=$N experiments=$E" >&2; exit 1; }
echo "✔ 8. after restart: $N projects and $E experiment persisted"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$BASE/api/v1/projects" -H "Authorization: Bearer $RO" -H 'Content-Type: application/json' -d '{"title":"x"}')
[[ "$CODE" == "403" ]] || { echo "read-only write returned $CODE" >&2; exit 1; }
echo "✔ 9. read-only token still rejected after restart (HTTP $CODE)"
docker compose --env-file "$ENVF" ps
echo "DOCKER ACCEPTANCE: PASSED"
