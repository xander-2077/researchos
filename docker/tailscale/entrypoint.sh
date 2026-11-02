#!/bin/sh
# ResearchOS Tailscale sidecar entrypoint.
#
# Why not the stock containerboot? Its `tailscale up` gives up after 60 s when no auth key is set,
# the container restarts and prints a *new* login URL every minute — you can never finish logging in.
# This script waits for the interactive login indefinitely (the URL stays valid), then publishes
# ResearchOS with Tailscale Serve (tailnet-only HTTPS; Funnel/public internet is never enabled).
set -u
SOCK=/var/run/tailscale/tailscaled.sock
TARGET="${TS_SERVE_TARGET:-http://researchos:8000}"

tailscaled --tun=userspace-networking --statedir=/var/lib/tailscale --socket="$SOCK" &
TSD=$!
trap 'kill "$TSD" 2>/dev/null; wait "$TSD"; exit 0' TERM INT

until [ -S "$SOCK" ]; do sleep 1; done

echo "== Logging in to Tailscale (hostname: ${TS_HOSTNAME:-researchos})."
echo "== If a login URL is printed below, open it once to approve this machine. Waiting as long as needed…"
# shellcheck disable=SC2086
tailscale up --hostname="${TS_HOSTNAME:-researchos}" ${TS_AUTHKEY:+--authkey="$TS_AUTHKEY"} ${TS_EXTRA_ARGS:-}
echo "== Logged in."

# `tailscale serve` fails until HTTPS certificates / Serve are enabled for the tailnet (it prints a
# link to enable them). Keep retrying so it completes right after you enable it.
until OUT=$(tailscale serve --bg --https=443 "$TARGET" 2>&1); do
  echo "== tailscale serve not ready yet — retrying in 20 s:"
  echo "$OUT"
  sleep 20
done
echo "$OUT"
tailscale serve status
tailscale funnel status 2>&1 | head -3

wait "$TSD"
