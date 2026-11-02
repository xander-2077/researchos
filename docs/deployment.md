# 部署

ResearchOS 使用一个容器提供网页、REST API 和 MCP，SQLite 数据保存在 Docker 数据卷中。支持 macOS（Docker Desktop / OrbStack）、Linux 和 VPS。

## 1. 环境要求

- Docker Engine 24+ 和 Compose 插件：`docker compose version`。
- 原部署估算：镜像约 300 MB，运行内存约 100 MB；以实际构建和运行占用为准。
- 不使用 Docker 开发时，需要 Python 3.11+ 和 Node 20+。

## 2. 本机部署

```bash
git clone <仓库地址> researchos && cd researchos
cp .env.example .env
# 编辑 .env，将 RESEARCHOS_ADMIN_PASSWORD 设置为至少 10 个字符的密码
docker compose up -d --build
docker compose ps           # 状态应为 healthy
```

打开 `http://127.0.0.1:8000`。默认仅监听本机，数据卷为 `researchos-data`。

管理员创建后可从 `.env` 删除初始密码。重置密码：

```bash
docker compose exec researchos python -m app.cli set-password
```

## 3. 远程访问

服务器先安装 Docker，再按“本机部署”启动应用。Ubuntu / Debian 可使用：

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
newgrp docker
```

检查应用状态：

```bash
curl -s http://127.0.0.1:8000/api/v1/healthz   # {"status":"ok"}
```

保留 `RESEARCHOS_BIND=127.0.0.1`，通过以下方式访问；不要直接将 8000 端口暴露到公网。

### 方案 A：Tailscale 内网 HTTPS

**宿主机已登录 Tailscale** 时，可直接转发本机服务。先检查已有规则，选择未占用端口：

```bash
tailscale serve status
tailscale serve --bg --https=8443 http://127.0.0.1:8000
```

使用命令输出的 HTTPS 地址。停止此入口：`tailscale serve --https=8443 off`。

**使用 Docker 独立节点** 时，启用 Compose 的 `tailscale` 配置。该容器以用户态网络运行，身份保存在 `researchos-tailscale-state` 卷中。

1. 在 [Tailscale 管理后台](https://login.tailscale.com/admin/dns)开启 **MagicDNS** 和 **HTTPS Certificates**。
2. 可在 `.env` 设置 `TS_HOSTNAME=researchos`。
3. 启动并打开日志中的登录链接完成授权：

   ```bash
   docker compose --profile tailscale up -d
   docker compose logs tailscale
   ```

   无人值守部署可在 `.env` 设置 `TS_AUTHKEY`，首次登录成功后移除。
4. 检查节点与访问地址：

   ```bash
   docker compose exec tailscale tailscale status
   docker compose exec tailscale tailscale serve status
   ```

5. 在同一 tailnet 的设备上打开 `https://researchos.<tailnet>.ts.net`。首次访问可能需要等待证书签发。

MCP 地址为访问地址加 `/mcp`。两种部署方式均使用 Serve 提供内网访问；启用 Funnel 会变为公网访问。

- HTTPS 部署设置 `RESEARCHOS_COOKIE_SECURE=true`，修改后运行 `docker compose up -d researchos`。
- 用 Tailscale ACL 限制可访问的设备或用户。节点标签可通过 `TS_EXTRA_ARGS=--advertise-tags=tag:researchos` 设置，认证密钥需允许该标签。
- 停止独立节点入口：`docker compose --profile tailscale stop tailscale`。
- 要让后续 Compose 命令持续管理独立节点，在 `.env` 设置 `COMPOSE_PROFILES=tailscale`。
- 删除独立节点时，先停止容器，再删除其状态卷及管理后台中的节点；保留 ResearchOS 数据卷。

### 方案 B：Caddy 公网 HTTPS

安装 Caddy，为域名配置 DNS，并在 `/etc/caddy/Caddyfile` 中设置：

```caddy
research.example.com {
    encode gzip
    reverse_proxy 127.0.0.1:8000
}
```

```bash
sudo apt install -y caddy
sudo systemctl reload caddy
```

Caddy 自动申请证书。应用 `.env` 配置：

```dotenv
RESEARCHOS_COOKIE_SECURE=true
RESEARCHOS_MCP_ALLOWED_HOSTS=["research.example.com","research.example.com:443"]
```

运行 `docker compose up -d researchos` 使配置生效。

### 方案 C：nginx 公网 HTTPS

先准备域名证书，再配置反向代理：

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
        proxy_buffering off;            # 允许 MCP 流式响应
        proxy_read_timeout 300s;
    }
}
```

应用与 Caddy 方案相同的 `.env` 设置。公网服务器应限制开放端口、使用强密码，并及时撤销不用的令牌。

## 4. 智能体令牌

在 **设置 → 新建令牌** 创建，或使用命令行：

```bash
docker compose exec researchos python -m app.cli create-token codex-vps --write --days 90
docker compose exec researchos python -m app.cli list-tokens
docker compose exec researchos python -m app.cli revoke-token 3
```

接入步骤见 [MCP 集成](mcp-integration.md)。

## 5. 备份与恢复

备份脚本使用 SQLite 在线备份接口。服务运行时不要直接用 `cp` 复制数据库文件。

```bash
scripts/backup.sh                         # 保存至 ./backups/researchos-<UTC时间>.db
scripts/restore.sh backups/researchos-20261102T120000Z.db
```

恢复脚本会停止应用，将当前数据库保存为 `researchos.db.pre-restore-<时间>`，再恢复备份、执行迁移并启动应用。

可在宿主机配置每日备份：

```cron
15 3 * * *  cd /opt/researchos && scripts/backup.sh >> backups/backup.log 2>&1
```

先创建 `backups` 目录；执行时间使用宿主机时区。定期将备份复制到其他机器。

科研数据 JSON 导出不含凭据，支持 **设置 → 导出 JSON**、`GET /api/v1/export` 或：

```bash
docker compose exec researchos python -m app.cli export
```

完整数据卷备份需先停止应用：

```bash
docker compose stop researchos
docker run --rm -v researchos-data:/data -v "$PWD:/b" alpine tar czf /b/researchos-data.tgz -C /data .
docker compose start researchos
```

## 6. 升级

```bash
cd /opt/researchos
git pull
scripts/update.sh   # 备份、重新构建并等待服务健康
docker compose exec researchos python -m app.cli db-version
```

默认启动时自动迁移数据库。手动迁移时设置 `RESEARCHOS_AUTO_MIGRATE=false`，再执行 `docker compose exec researchos python -m app.cli migrate`。

## 7. 开发模式

```bash
scripts/setup-dev.sh                         # 创建虚拟环境并安装依赖
export RESEARCHOS_ADMIN_PASSWORD='dev-password-123'
scripts/dev.sh                              # 后端 :8000，前端 :5173
```

打开 `http://127.0.0.1:5173`。Vite 将 `/api` 和 `/mcp` 转发到后端。数据默认存入 `backend/data/`，可通过 `RESEARCHOS_DATA_DIR` 修改。

## 8. 配置项

| 环境变量 | 默认值 | 用途 |
|---|---|---|
| `RESEARCHOS_DATA_DIR` | `./data`，Docker 内为 `/data` | 数据库、会话密钥和备份目录 |
| `RESEARCHOS_DATABASE_URL` | `sqlite:///<data_dir>/researchos.db` | 数据库连接地址 |
| `RESEARCHOS_AUTO_MIGRATE` | `true` | 启动时迁移数据库 |
| `RESEARCHOS_ADMIN_USERNAME` / `RESEARCHOS_ADMIN_PASSWORD` | `admin` / 无 | 首次创建管理员 |
| `RESEARCHOS_SECRET_KEY` | 自动生成 | 会话签名密钥，保存在数据目录 |
| `RESEARCHOS_COOKIE_SECURE` | `false` | HTTPS 部署设为 `true` |
| `RESEARCHOS_SESSION_MAX_AGE_DAYS` | `14` | 会话有效天数 |
| `RESEARCHOS_CORS_ORIGINS` | `[]` | 允许的额外浏览器来源，JSON 列表 |
| `RESEARCHOS_MCP_ALLOWED_HOSTS` | `[]` | MCP Host 白名单；空列表不启用检查 |
| `RESEARCHOS_RATE_LIMIT_PER_MINUTE` | `600` | 每个 IP 的 API/MCP 每分钟请求上限；0 表示关闭 |
| `RESEARCHOS_LOGIN_RATE_LIMIT_PER_MINUTE` | `10` | 每个 IP 的每分钟登录请求上限 |
| `RESEARCHOS_MAX_BODY_BYTES` | `1000000` | 请求体大小上限，字节 |
| `RESEARCHOS_BIND` / `RESEARCHOS_PORT` | `127.0.0.1` / `8000` | Compose 监听地址与端口 |
| `TS_HOSTNAME` / `TS_AUTHKEY` / `TS_EXTRA_ARGS` | `researchos` / 无 / 无 | Tailscale 独立节点名称、认证密钥和附加参数 |
| `PIP_INDEX_URL` | `https://pypi.tuna.tsinghua.edu.cn/simple` | 构建镜像时使用的 PyPI 镜像源 |
