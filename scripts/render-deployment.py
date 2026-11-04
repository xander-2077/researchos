#!/usr/bin/env python3
"""Render the optional reverse-tunnel deployment from a local .env; no dependencies."""
from __future__ import annotations

import argparse
import ipaddress
import os
from pathlib import Path
import re
import shlex
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEMPLATES = ROOT / "docker/aliyun"
DEFAULTS = {"PROXY_PORT": "10001", "TUNNEL_PORT": "10001",
            "TUNNEL_TARGET_HOST": "127.0.0.1", "TUNNEL_TARGET_PORT": "8000"}
REQUIRED = ("SERVER_NAME", "PROXY_LISTEN_IP", "TUNNEL_LOCAL_USER", "TUNNEL_SSH_HOST")
KEYS = (*REQUIRED, *DEFAULTS)
HOST = re.compile(r"[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?")


def load_values(path: Path) -> dict[str, str]:
    values = DEFAULTS.copy()
    if path.exists():
        for number, line in enumerate(path.read_text().splitlines(), 1):
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            key, separator, raw = line.removeprefix("export ").partition("=")
            key = key.strip()
            if not separator:
                raise ValueError(f"环境文件第 {number} 行需要 KEY=value")
            if key not in KEYS:
                continue
            try:
                parts = shlex.split(raw, comments=True)
            except ValueError:
                raise ValueError(f"{key} 的引号不完整") from None
            if len(parts) > 1:
                raise ValueError(f"{key} 的值不能包含未加引号的空格")
            values[key] = parts[0] if parts else ""
    values.update({key: os.environ[key] for key in KEYS if key in os.environ})
    for key in REQUIRED:
        if not values.get(key):
            raise ValueError(f"请在环境变量或配置文件中设置 {key}")
    for key in ("SERVER_NAME", "TUNNEL_TARGET_HOST", "PROXY_LISTEN_IP"):
        if "%" in values[key]:
            raise ValueError(f"{key} 不支持带接口标识的 IPv6 地址")
    for key in ("PROXY_PORT", "TUNNEL_PORT", "TUNNEL_TARGET_PORT"):
        if not values[key].isascii() or not values[key].isdigit() or not 1 <= int(values[key]) <= 65535:
            raise ValueError(f"{key} 必须是 1–65535 的端口号")
        values[key] = str(int(values[key]))
    for key in ("SERVER_NAME", "TUNNEL_TARGET_HOST"):
        try:
            ipaddress.ip_address(values[key])
        except ValueError:
            if not HOST.fullmatch(values[key]):
                raise ValueError(f"{key} 必须是域名或 IP 地址") from None
    if not re.fullmatch(r"[a-z_][a-z0-9_-]*\$?", values["TUNNEL_LOCAL_USER"]):
        raise ValueError("TUNNEL_LOCAL_USER 必须是有效的本地用户名")
    if not re.fullmatch(r"[a-zA-Z0-9_][a-zA-Z0-9_.-]*", values["TUNNEL_SSH_HOST"]):
        raise ValueError("TUNNEL_SSH_HOST 必须是 SSH 主机别名，不能包含选项或命令")
    try:
        listen = ipaddress.ip_address(values["PROXY_LISTEN_IP"])
    except ValueError:
        raise ValueError("PROXY_LISTEN_IP 必须是云服务器网卡的 IP 地址") from None
    if values["PROXY_PORT"] == values["TUNNEL_PORT"] and (listen.is_unspecified or listen.is_loopback):
        raise ValueError("Nginx 与 SSH 隧道端口冲突：指定云服务器网卡地址，或使用不同的 PROXY_PORT")
    for key in ("PROXY_LISTEN_IP", "TUNNEL_TARGET_HOST"):
        if ":" in values[key]:
            values[key] = f"[{values[key]}]"
    return values


def render(env_file: Path, output: Path) -> None:
    values = load_values(env_file)
    rendered = {}
    for name in ("researchos-ip-http.conf", "researchos-tunnel.service"):
        # Replace only our ${UPPER_CASE} placeholders, preserving $http_host, etc.
        rendered[name] = re.sub(r"\$\{([A-Z][A-Z0-9_]*)\}",
                                lambda m: values[m[1]], (TEMPLATES / name).read_text())
    output.mkdir(parents=True, exist_ok=True, mode=0o700)
    for name, content in rendered.items():
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=output, delete=False) as file:
                temporary = Path(file.name)
                file.write(content)
            temporary.replace(output / name)
        finally:
            if temporary:
                temporary.unlink(missing_ok=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--env-file", type=Path, default=TEMPLATES / ".env")
    parser.add_argument("--output", type=Path, default=ROOT / ".private/deployment")
    args = parser.parse_args()
    try:
        render(args.env_file, args.output)
    except (ValueError, OSError) as error:
        parser.exit(1, f"配置生成失败：{error}\n")
    print(f"配置已生成：{args.output}（尚未安装或重启服务）")


if __name__ == "__main__":
    main()
