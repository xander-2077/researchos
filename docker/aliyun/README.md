# 云服务器反向隧道

访问链路：浏览器 → 云服务器 Nginx → 回环端口上的 SSH 隧道 → 本机 ResearchOS。本机需要持续在线。

## 生成配置

在仓库根目录执行，需要 Python 3.10+：

```bash
cp docker/aliyun/.env.example docker/aliyun/.env
chmod 600 docker/aliyun/.env
# 编辑 docker/aliyun/.env，填入实际网卡地址、域名/IP、用户名和 SSH 别名
python3 scripts/render-deployment.py
```

实际参数保存在被忽略的 `.env` 中。脚本不会执行文件内容；同名进程环境变量优先。结果写入 `.private/deployment/`，不自动安装或重启服务。

| 变量 | 用途 |
|---|---|
| `SERVER_NAME` | 浏览器访问的域名或公网 IP |
| `PROXY_LISTEN_IP` / `PROXY_PORT` | Nginx 监听的云服务器网卡地址与端口 |
| `TUNNEL_LOCAL_USER` | 本机运行 SSH 的用户 |
| `TUNNEL_SSH_HOST` | 该用户 SSH 配置中的主机别名，须可非交互认证 |
| `TUNNEL_PORT` | 云服务器回环地址上的隧道端口 |
| `TUNNEL_TARGET_HOST` / `TUNNEL_TARGET_PORT` | 本机 ResearchOS 地址与端口；端口需与应用 `RESEARCHOS_PORT` 一致 |

也可以指定另一份环境文件和输出目录：

```bash
python3 scripts/render-deployment.py --env-file /path/to/deployment.env --output .private/deployment
```

不要直接安装仓库中的模板。Nginx/systemd 不会自行读取项目 `.env`；必须先生成配置。仅修改环境文件后，也需要重新生成并安装。

## 安装

本机：

```bash
sudo install -m 644 .private/deployment/researchos-tunnel.service /etc/systemd/system/researchos-tunnel.service
sudo systemd-analyze verify /etc/systemd/system/researchos-tunnel.service
sudo systemctl daemon-reload
sudo systemctl enable --now researchos-tunnel.service
# 已运行的服务需重启才能应用新参数
sudo systemctl restart researchos-tunnel.service
```

把生成的 `researchos-ip-http.conf` 复制到云服务器后，安装到 `/etc/nginx/sites-available/`，在 `sites-enabled/` 建立对应链接。运行 `sudo nginx -t`，通过后再 `sudo systemctl reload nginx`。

Nginx 与 SSH 隧道使用同一端口时，Nginx 必须绑定网卡地址，不能绑定通配或回环地址。脚本会拒绝此类端口冲突。

此模板的浏览器入口为 HTTP，应用需设置 `RESEARCHOS_COOKIE_SECURE=false`。采用 [HTTPS 或 Tailscale](../../docs/deployment.md#3-远程访问) 时设为 `true`。

## 检查

本机执行 `systemctl status researchos-tunnel.service` 和 `docker compose ps`；云服务器执行 `sudo nginx -t`。应用健康接口为 `/api/v1/healthz`，按配置的地址和端口访问。
