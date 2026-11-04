# 云服务器反向隧道部署模板

本目录提供 Nginx 和 systemd 模板，不包含实际部署地址。安装前替换以下占位符：

| 占位符 | 含义 |
|---|---|
| `<SERVER_PUBLIC_IP>` | 云服务器公网地址 |
| `<SERVER_PRIVATE_IP>` | 云服务器本地网卡地址，用于 Nginx 监听 |
| `<LOCAL_USER>` | 本机运行 SSH 隧道的用户 |
| `<SSH_HOST>` | 本机 SSH 配置中的服务器别名 |

## 访问链路

```text
浏览器 → 云服务器 Nginx :10001
       → 云服务器回环地址 :10001
       → SSH 反向隧道
       → 本机 ResearchOS :8000
```

Nginx 绑定服务器网卡地址，SSH 隧道绑定回环地址，避免端口冲突。本机 Docker 保持 `127.0.0.1:8000`，数据存放在持久化卷中。本机需要持续在线。

## 配置

- `researchos-tunnel.service`：替换用户和 SSH 别名，安装到本机 systemd 服务目录；SSH 连接须可非交互认证。
- `researchos-ip-http.conf`：替换公网和网卡地址，安装到云服务器 Nginx 站点目录。
- 实际配置、地址和运维记录放在 `.private/` 或仓库外，不要提交。

此模板的浏览器入口为 HTTP，登录 Cookie 需 `RESEARCHOS_COOKIE_SECURE=false`。远程日常使用优先采用 [HTTPS 或 Tailscale 部署](../../docs/deployment.md#3-远程访问)，HTTPS 下设为 `true`。

## 检查

本机：

```bash
systemctl status researchos-tunnel.service
docker compose ps
curl -fsS http://127.0.0.1:8000/api/v1/healthz
```

云服务器：

```bash
curl -fsS http://127.0.0.1:10001/api/v1/healthz
sudo nginx -t
```

修改 Nginx 配置后，先检查配置，通过后再执行 `sudo systemctl reload nginx`。
