# 阿里云公网入口

链路：`research.example.com:443 → Nginx → 阿里云 127.0.0.1:10001 → SSH 隧道 → 本机 127.0.0.1:8000`。

- Cloudflare：`research` 的 A 记录为 `<SERVER_PUBLIC_IP>`，仅 DNS。
- 本机：`researchos-tunnel.service` 以 `<LOCAL_USER>` 运行，使用 SSH 配置中的 `<SSH_HOST>`，开机启动、断线自动重连。
- 阿里云：Nginx 站点文件 `/etc/nginx/sites-available/researchos`；10001 不向公网开放。
- 证书：`/etc/letsencrypt/live/research.example.com/`；`researchos-cert-renew.timer` 每日两次检查续期，成功后校验并重载 Nginx。
- 保留 Tailscale 8443 及现有 Codex MCP 地址。公网入口独立配置，不运行 `tailscale serve ... off`。

## 当前部署阶段

2026-11-02：DNS、SSH 隧道、域名证书及续期定时器已配置。等待确认备案状态，公网 HTTPS 暂时返回 503 待上线提示，尚未代理应用。

## 启用应用代理

确认可以上线后，将 `researchos-https.conf` 安装到阿里云 `/etc/nginx/sites-available/researchos`，执行 `sudo nginx -t`，通过后执行 `sudo systemctl reload nginx`。

应用保持 `RESEARCHOS_COOKIE_SECURE=true`。如果配置了 `RESEARCHOS_MCP_ALLOWED_HOSTS`，增加 `research.example.com` 和 `research.example.com:443`，保留已有 Tailscale 主机名。

验证 HTTPS 证书、健康接口、网页登录，以及 `/api/v1/projects` 和 `/mcp` 的未授权访问返回 401。再使用现有凭据验证授权访问，勿将令牌写入命令行或日志。

## 排查

本机：`systemctl status researchos-tunnel.service`。

阿里云：`curl -fsS http://127.0.0.1:10001/api/v1/healthz`、`sudo nginx -t`、`systemctl list-timers researchos-cert-renew.timer`。

`researchos-http.conf` 仅用于首次签发证书前的 HTTP-01 验证。已有有效证书时使用 HTTPS 配置。
