"""Deployment templates must work without interpreting environment files as shell code."""
import importlib.util
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("deployment", ROOT / "scripts/render-deployment.py")
deployment = importlib.util.module_from_spec(spec)
spec.loader.exec_module(deployment)


def config(tmp_path, monkeypatch, extra=""):
    for key in deployment.KEYS:
        monkeypatch.delenv(key, raising=False)
    env = tmp_path / ".env"
    env.write_text("SERVER_NAME=research.example.com\nPROXY_LISTEN_IP=192.0.2.10\n"
                   "TUNNEL_LOCAL_USER=researcher\nTUNNEL_SSH_HOST=research-server\n" + extra)
    return env


def test_render_preserves_nginx_variables_and_applies_environment_override(tmp_path, monkeypatch):
    env = config(tmp_path, monkeypatch, "TUNNEL_TARGET_PORT='8100' # custom application port\n")
    monkeypatch.setenv("TUNNEL_TARGET_PORT", "8200")
    output = tmp_path / "generated"
    deployment.render(env, output)
    proxy = (output / "researchos-ip-http.conf").read_text()
    service = (output / "researchos-tunnel.service").read_text()
    assert "listen 192.0.2.10:10001" in proxy
    assert "proxy_set_header Host $http_host;" in proxy
    assert "proxy_set_header X-Real-IP $remote_addr;" in proxy
    assert "-R 127.0.0.1:10001:127.0.0.1:8200 research-server" in service
    assert "User=researcher" in service
    assert (output / "researchos-ip-http.conf").stat().st_mode & 0o777 == 0o600


@pytest.mark.parametrize("line", [
    "TUNNEL_TARGET_PORT=0", "PROXY_PORT=65536", "PROXY_LISTEN_IP=not-an-ip",
    "SERVER_NAME='example.com; include /tmp/other;'", "TUNNEL_SSH_HOST=-oProxyCommand=bad",
    "TUNNEL_LOCAL_USER='name%value'", "PROXY_LISTEN_IP=0.0.0.0",
    "TUNNEL_TARGET_HOST=fe80::1%eth0", "PROXY_LISTEN_IP=fe80::1%eth0",
])
def test_invalid_config_is_rejected_before_any_output(tmp_path, monkeypatch, line):
    env = config(tmp_path, monkeypatch, line + "\n")
    with pytest.raises(ValueError):
        deployment.render(env, tmp_path / "generated")
    assert not (tmp_path / "generated").exists()


def test_env_file_is_data_and_missing_values_are_reported(tmp_path, monkeypatch):
    marker = tmp_path / "executed"
    env = config(tmp_path, monkeypatch, f"TUNNEL_SSH_HOST='$(touch {marker})'\n")
    with pytest.raises(ValueError):
        deployment.render(env, tmp_path / "generated")
    assert not marker.exists()
    env.write_text("SERVER_NAME=research.example.com\n")
    with pytest.raises(ValueError, match="PROXY_LISTEN_IP"):
        deployment.render(env, tmp_path / "generated")


def test_ipv6_addresses_are_bracketed_for_nginx_and_ssh(tmp_path, monkeypatch):
    env = config(tmp_path, monkeypatch, "PROXY_LISTEN_IP=2001:db8::1\nTUNNEL_TARGET_HOST=::1\n")
    output = tmp_path / "generated"
    deployment.render(env, output)
    assert "listen [2001:db8::1]:10001" in (output / "researchos-ip-http.conf").read_text()
    assert "-R 127.0.0.1:10001:[::1]:8000" in (output / "researchos-tunnel.service").read_text()
