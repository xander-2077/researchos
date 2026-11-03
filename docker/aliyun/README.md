# 阿里云 IP 访问

公网入口：`http://<SERVER_PUBLIC_IP>:10001`。

```text
手机 / 浏览器
  │ HTTP
  ▼
阿里云公网 IP <SERVER_PUBLIC_IP>:10001
  │ ECS 公网地址映射
  ▼
Nginx <SERVER_PRIVATE_IP>:10001
  │ 本机 HTTP 代理
  ▼
阿里云 127.0.0.1:10001
  │ SSH 加密反向隧道（本机主动连接 <SSH_HOST>:22）
  ▼
<LOCAL_HOST> 127.0.0.1:8000
  │ Docker 端口映射
  ▼
ResearchOS 容器 :8000
  ├─ 前端页面
  ├─ REST API /api/v1
  ├─ MCP /mcp
  └─ SQLite 数据库 /data（持久化数据卷）
```

## 保留的服务与配置

- 本机 `researchos-tunnel.service`：以 `<LOCAL_USER>` 运行，使用 SSH 配置中的 `<SSH_HOST>`，开机启动、断线自动重连。安装源：`researchos-tunnel.service`。
- 阿里云 Nginx：站点 `/etc/nginx/sites-available/researchos-ip-http`，通过 `sites-enabled` 链接启用。安装源：`researchos-ip-http.conf`。
- Nginx 与 SSH 分别绑定私网网卡、回环地址上的 10001，互不冲突。ECS 私网 IP 变化时需更新 Nginx 配置。
- 本机 Docker：`researchos` 服务仅发布 `127.0.0.1:8000`，数据库保存在持久化数据卷中。
- Tailscale：`https://<LOCAL_HOST>.<TAILNET>.ts.net:8443 → 本机 127.0.0.1:8000`，与公网 IP 入口并行。Codex MCP 地址仍使用该 HTTPS 地址加 `/mcp`。

应用使用 `RESEARCHOS_COOKIE_SECURE=false` 以支持 HTTP 登录，该设置也影响 Tailscale 会话 Cookie。浏览器到阿里云为明文 HTTP，阿里云到本机为 SSH 加密链路。本机需要持续在线。

## 已清理的域名 HTTPS 配置

2026-11-03 清理 ResearchOS 专属的 `research.example.com` Nginx 站点、证书、续期定时器及服务、ACME 验证目录和部署临时文件，并移除仓库中对应模板。

其他网站使用的 Nginx、Certbot 和证书保留；Tailscale 的 HTTPS 配置保留。Cloudflare 的 `research` DNS 记录不参与 IP 访问，尚未删除，若不再使用可在 Cloudflare 删除。

## 检查与维护

本机：

```bash
systemctl status researchos-tunnel.service
docker compose ps
curl -fsS http://127.0.0.1:8000/api/v1/healthz
```

阿里云：

```bash
curl -fsS http://127.0.0.1:10001/api/v1/healthz
sudo nginx -t
ss -ltn '( sport = :10001 )'
```

外部设备：

```bash
curl -fsS http://<SERVER_PUBLIC_IP>:10001/api/v1/healthz
```

更新 Nginx 配置后，先执行 `sudo nginx -t`，通过后执行 `sudo systemctl reload nginx`。
