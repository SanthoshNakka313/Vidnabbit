"""Sandbox child protocol, timeouts and environment scrubbing (real subprocesses, no network)."""

from __future__ import annotations

import sys
import textwrap
import time
from pathlib import Path

import pytest

from app.errors import ApiError
from app.sandbox import Sandbox, scrubbed_env

pytestmark = pytest.mark.anyio


def child(tmp_path: Path, body: str) -> Sandbox:
    script = tmp_path / "child.py"
    script.write_text("import json, os, sys, time\n" + textwrap.dedent(body))
    return Sandbox(home=tmp_path / "home", argv=[sys.executable, "-I", str(script)])


async def test_result_and_messages(tmp_path: Path) -> None:
    sb = child(tmp_path, """
        task = json.loads(sys.stdin.readline())
        print(json.dumps({"t": "progress", "v": 0.5}), flush=True)
        print(json.dumps({"t": "info", "info": {}}), flush=True)
        answer = sys.stdin.readline().strip()
        print(json.dumps({"t": "result", "echo": task["op"], "answer": answer}), flush=True)
    """)
    seen = []

    async def on_message(msg):
        seen.append(msg["t"])
        return "go" if msg["t"] == "info" else None

    res = await sb.run({"op": "ping"}, timeout=10, on_message=on_message)
    assert res == {"t": "result", "echo": "ping", "answer": "go"}
    assert seen == ["progress", "info"]


async def test_error_message_maps_to_api_error(tmp_path: Path) -> None:
    sb = child(tmp_path, """
        sys.stdin.readline()
        print(json.dumps({"t": "error", "code": "private_content", "message": "nope"}), flush=True)
    """)
    with pytest.raises(ApiError) as ei:
        await sb.run({"op": "x"}, timeout=10)
    assert ei.value.code == "private_content"


async def test_unknown_error_code_is_internal(tmp_path: Path) -> None:
    sb = child(tmp_path, """
        sys.stdin.readline()
        print(json.dumps({"t": "error", "code": "made_up"}), flush=True)
    """)
    with pytest.raises(ApiError) as ei:
        await sb.run({"op": "x"}, timeout=10)
    assert ei.value.code == "internal"


@pytest.mark.parametrize("body", ["print('not json', flush=True)", "sys.exit(3)"])
async def test_malformed_or_silent_child(tmp_path: Path, body: str) -> None:
    sb = child(tmp_path, "sys.stdin.readline()\n" + body + "\n")
    with pytest.raises(ApiError) as ei:
        await sb.run({"op": "x"}, timeout=10)
    assert ei.value.code == "internal"


async def test_timeout_kills_child(tmp_path: Path) -> None:
    pidfile = tmp_path / "pid"
    sb = child(tmp_path, f"""
        open({str(pidfile)!r}, "w").write(str(os.getpid()))
        time.sleep(60)
    """)
    start = time.monotonic()
    with pytest.raises(ApiError) as ei:
        await sb.run({"op": "x"}, timeout=1)
    assert ei.value.code == "upstream_error" and time.monotonic() - start < 10
    import os

    with pytest.raises(ProcessLookupError):
        os.kill(int(pidfile.read_text()), 0)


async def test_child_env_has_no_secrets(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("SIGNING_SECRET", "top-secret")
    monkeypatch.setenv("AWS_SECRET_ACCESS_KEY", "aws")
    sb = child(tmp_path, """
        sys.stdin.readline()
        print(json.dumps({"t": "result", "env": dict(os.environ)}), flush=True)
    """)
    env = (await sb.run({"op": "x"}, timeout=10))["env"]
    assert "SIGNING_SECRET" not in env and "AWS_SECRET_ACCESS_KEY" not in env
    assert env["YTDLP_NO_PLUGINS"] == "1"


def test_scrubbed_env_sets_proxy_only_when_configured(tmp_path: Path) -> None:
    assert "HTTPS_PROXY" not in scrubbed_env(tmp_path, None)
    env = scrubbed_env(tmp_path, "http://egress:4750", tmpdir=tmp_path)
    assert env["HTTPS_PROXY"] == env["http_proxy"] == "http://egress:4750"
    assert env["NO_PROXY"] == "" and env["TMPDIR"] == str(tmp_path)
