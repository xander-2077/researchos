# Deployment

ResearchOS runs as **one container** (web UI + REST + MCP) with one Docker volume for the SQLite
database. It works the same on macOS (Docker Desktop / OrbStack), a Linux workstation, or a VPS.

## 1. Requirements

* Docker Engine 24+ with the Compose plugin (`docker compose version`)
* ~300 MB disk for the image, ~100 MB RAM at runtime
* For development without Docker: Python 3.11+ and Node 20+

## 2. Local machine (macOS / Linux)

```bash
git clone <your-repo-url> researchos && cd researchos
cp .env.example .env
# edit .env: set RESEARCHOS_ADMIN_PASSWORD to a long password (≥10 chars)
docker compose up -d --build
docker compose ps            # STATUS should become "healthy"
open http://127.0.0.1:8000   # Linux: xdg-open
```

The port is bound to `127.0.0.1` only. Data lives in the named volume `researchos-data`.

After the first successful login you may delete `RESEARCHOS_ADMIN_PASSWORD` from `.env`; the
admin user stays in the database. Reset a password any time:

```bash
docker compose exec researchos python -m app.cli set-password
```

## 3. VPS (fresh Ubuntu/Debian server)

```bash
# 1. Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER && newgrp docker

# 2. App
git clone <your-repo-url> /opt/researchos && cd /opt/researchos
cp .env.example .env
nano .env        # set RESEARCHOS_ADMIN_PASSWORD; set RESEARCHOS_COOKIE_SECURE=true if you use HTTPS
docker compose up -d --build
curl -s http://127.0.0.1:8000/api/v1/healthz     # {"status":"ok"}
```

Keep `RESEARCHOS_BIND=127.0.0.1` and put one of the following in front. **Never publish port
8000 directly to the internet.**

### Option A — Tailscale Serve (Docker sidecar)

Recommended: private HTTPS access from your own devices only, no open ports, no root on the
server. The `tailscale` service in `docker-compose.yml` (profile `tailscale`) joins your tailnet
as its own machine and uses **Tailscale Serve** to proxy `https://<name>.<tailnet>.ts.net` to the
ResearchOS container. It runs in userspace networking mode (no `/dev/net/tun`, no host changes)
and keeps its identity in the `researchos-tailscale-state` volume.

1. In the [Tailscale admin console](https://login.tailscale.com/admin/dns) enable **MagicDNS** and
   **HTTPS Certificates** (one time per tailnet).
2. Optionally set the machine name in `.env`: `TS_HOSTNAME=researchos` (default).
3. Start it:

   ```bash
   docker compose --profile tailscale up -d
   docker compose logs tailscale | grep -A1 "To authenticate"   # open this URL and approve (it stays valid; no timeout)
   ```

   For unattended setups put a pre-auth key in `.env` instead (`TS_AUTHKEY=tskey-auth-…`,
   create it under *Settings → Keys*) and remove it after the first start.
4. Check status and the URL:

   ```bash
   docker compose exec tailscale tailscale status
   docker compose exec tailscale tailscale serve status
   ```

5. Open `https://researchos.<your-tailnet>.ts.net` on any device logged into the same tailnet
   (laptop, phone with the Tailscale app). The first HTTPS request can take a few seconds while the
   certificate is issued.

Agents on tailnet machines use `https://researchos.<your-tailnet>.ts.net/mcp`.

Notes:

* Serve is tailnet-only. **Funnel (public internet) is explicitly disabled** in
  `docker/tailscale/serve.json`; keep it that way.
* Traffic is end-to-end encrypted (WireGuard + HTTPS). You may set `RESEARCHOS_COOKIE_SECURE=true`;
  if you also use an `ssh -L` tunnel to `http://127.0.0.1`, most browsers still accept Secure
  cookies on localhost, but Safari may not — leave it `false` in that case.
* To restrict which tailnet users/devices can reach it, use Tailscale ACLs (tag the machine, e.g.
  `TS_EXTRA_ARGS=--advertise-tags=tag:researchos` with a pre-auth key that allows the tag).
* Stop remote access: `docker compose --profile tailscale stop tailscale` (ResearchOS keeps running).
  Remove the machine from the tailnet: `docker compose --profile tailscale down` + delete the
  `researchos-tailscale-state` volume + remove it in the admin console.

Alternative without Docker: install Tailscale on the host (`curl -fsSL https://tailscale.com/install.sh | sh`,
`sudo tailscale up`, `sudo tailscale serve --bg <RESEARCHOS_PORT>`).

### Option B — Public HTTPS with Caddy

`/etc/caddy/Caddyfile`:

```caddy
research.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8000
}
```

```bash
sudo apt install -y caddy && sudo systemctl reload caddy
```

Caddy obtains certificates automatically. In `.env` set:

```
RESEARCHOS_COOKIE_SECURE=true
RESEARCHOS_MCP_ALLOWED_HOSTS=["research.example.com","research.example.com:443"]
```

### Option C — nginx

```nginx
server {
    listen 443 ssl http2;
    server_name research.example.com;
    ssl_certificate     /etc/letsencrypt/live/research.example.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/research.example.com/privkey.pem;
    client_max_body_size 2m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_buffering off;            # MCP may stream responses
        proxy_read_timeout 300s;
    }
}
```

Recommended for public hosts: firewall (`ufw allow 22,80,443/tcp`), strong admin password,
short token expiries, revoke tokens you no longer use.

## 4. Tokens for agents

Create them in the UI (**Settings → New token**) or on the server:

```bash
docker compose exec researchos python -m app.cli create-token codex-vps --write --days 90
docker compose exec researchos python -m app.cli list-tokens
docker compose exec researchos python -m app.cli revoke-token 3
```

Then follow [mcp-integration.md](mcp-integration.md).

## 5. Backup & restore

Backups use SQLite's online backup API, which is consistent even while the server is writing
(WAL mode). Never copy `researchos.db` with `cp` while the server runs.

```bash
scripts/backup.sh                                   # → ./backups/researchos-<UTC>.db
scripts/restore.sh backups/researchos-20261102T120000Z.db
```

`restore.sh` stops the container, saves the current DB as `researchos.db.pre-restore-<ts>` in
the volume, restores, runs migrations and starts the container again.

Nightly backups via cron (host):

```cron
15 3 * * *  cd /opt/researchos && scripts/backup.sh >> backups/backup.log 2>&1
```

Copy `./backups` off the machine (e.g. `rclone`, `restic`, `rsync`). A JSON export (for
migration/inspection, no credentials) is available in **Settings → Export JSON**, at
`GET /api/v1/export`, or via `docker compose exec researchos python -m app.cli export`.

Volume-level copy (server stopped): `docker run --rm -v researchos-data:/data -v $PWD:/b alpine tar czf /b/researchos-data.tgz -C /data .`

## 6. Upgrading

```bash
cd /opt/researchos
scripts/backup.sh                 # always back up first
git pull
docker compose up -d --build      # migrations run automatically on start (RESEARCHOS_AUTO_MIGRATE=true)
docker compose exec researchos python -m app.cli db-version
```

To run migrations manually instead, set `RESEARCHOS_AUTO_MIGRATE=false` and run
`docker compose exec researchos python -m app.cli migrate`.

## 7. Development mode (no Docker)

```bash
scripts/setup-dev.sh                                  # venv + npm ci
export RESEARCHOS_ADMIN_PASSWORD='dev-password-123'
scripts/dev.sh                                        # API :8000 (reload) + Vite :5173
```

Open http://127.0.0.1:5173 (Vite proxies `/api` and `/mcp` to the backend). Data goes to
`backend/data/` (override with `RESEARCHOS_DATA_DIR`).

## 8. Configuration reference

| Variable | Default | Meaning |
|---|---|---|
| `RESEARCHOS_DATA_DIR` | `./data` (`/data` in Docker) | Database, session key, in-volume backups |
| `RESEARCHOS_DATABASE_URL` | `sqlite:///<data_dir>/researchos.db` | SQLAlchemy URL |
| `RESEARCHOS_AUTO_MIGRATE` | `true` | Run Alembic upgrade on startup |
| `RESEARCHOS_ADMIN_USERNAME` / `_PASSWORD` | `admin` / – | Bootstrap admin if no user exists |
| `RESEARCHOS_SECRET_KEY` | generated | Session signing key (persisted in data dir) |
| `RESEARCHOS_COOKIE_SECURE` | `false` | `Secure` cookies (set `true` behind HTTPS) |
| `RESEARCHOS_SESSION_MAX_AGE_DAYS` | `14` | Session lifetime |
| `RESEARCHOS_CORS_ORIGINS` | `[]` | Extra browser origins (JSON list) |
| `RESEARCHOS_MCP_ALLOWED_HOSTS` | `[]` | MCP Host allow-list; empty disables the check |
| `RESEARCHOS_RATE_LIMIT_PER_MINUTE` | `600` | Per-IP limit for `/api` and `/mcp` (0 = off) |
| `RESEARCHOS_LOGIN_RATE_LIMIT_PER_MINUTE` | `10` | Per-IP login attempts |
| `RESEARCHOS_MAX_BODY_BYTES` | `1000000` | Max request body |
| `RESEARCHOS_BIND` / `RESEARCHOS_PORT` | `127.0.0.1` / `8000` | Compose port binding |
| `TS_HOSTNAME` / `TS_AUTHKEY` / `TS_EXTRA_ARGS` | `researchos` / – / – | Tailscale sidecar (profile `tailscale`) |
| `PIP_INDEX_URL` | `https://pypi.tuna.tsinghua.edu.cn/simple` | PyPI mirror used by `docker compose build` (use `https://pypi.org/simple` outside mainland China) |
