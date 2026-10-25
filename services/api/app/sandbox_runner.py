"""Child-process entrypoint for all yt-dlp work (docs/03 2.5, docs/02 ADR-003).

Started by ``app.sandbox`` with a scrubbed environment, rlimits and its own
process group, so the parent can SIGKILL it on timeout.

Protocol (JSON lines):
  parent -> child  stdin  line 1: task {"op": "extract"|"download", ...}
                          later (download only): "go" or "abort"
  child -> parent  stdout {"t": "progress", "v": 0.42}
                          {"t": "info", "info": {...}}         (download: awaiting go/abort)
                          {"t": "result", ...} | {"t": "error", "code": ..., "message": ...}

Anything else the child (or a library) prints goes to stderr, never to the
protocol channel.
"""

from __future__ import annotations

import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, TextIO


def _protocol_channel() -> TextIO:
    # Keep a private copy of the real stdout for the protocol, then point fd 1 at
    # stderr so stray prints from libraries can't corrupt the channel.
    fd = os.dup(1)
    os.dup2(2, 1)
    sys.stdout = sys.stderr
    return os.fdopen(fd, "w", buffering=1, encoding="utf-8")


def main() -> None:
    os.environ["YTDLP_NO_PLUGINS"] = "1"
    logging.basicConfig(level=os.environ.get("SANDBOX_LOG_LEVEL", "WARNING"), stream=sys.stderr)
    out = _protocol_channel()

    def send(msg: dict[str, Any]) -> None:
        out.write(json.dumps(msg, separators=(",", ":")) + "\n")
        out.flush()

    try:
        task = json.loads(sys.stdin.readline())
        send(_dispatch(task, send))
    except Exception as e:
        from app.errors import ApiError
        from app.ytdlp_core import map_ytdlp_error

        api = e if isinstance(e, ApiError) else map_ytdlp_error(e)
        if not isinstance(e, ApiError):
            logging.getLogger("sandbox").info("task failed: %s", type(e).__name__)
        send({"t": "error", "code": str(api.code), "message": api.message})


def _dispatch(task: dict[str, Any], send: Any) -> dict[str, Any]:
    from app.ssrf import install_ytdlp_guard, set_extra_denied_networks
    from app.ytdlp_core import run_download, run_extract

    cfg = dict(task.get("opts") or {})
    set_extra_denied_networks(cfg.pop("extra_denied", []) or [])
    install_ytdlp_guard(cfg.get("proxy"))
    op = task.get("op")
    if op == "extract":
        return {"t": "result", "info": run_extract(task["url"], cfg)}
    if op == "download":
        def approve(info: dict[str, Any]) -> bool:
            send({"t": "info", "info": info})
            return sys.stdin.readline().strip() == "go"

        result = run_download(
            task["url"], task["preset"], Path(task["workdir"]), task["job_uuid"], cfg,
            emit_progress=lambda v: send({"t": "progress", "v": round(v, 4)}),
            approve_info=approve,
        )
        return {"t": "result", **result}
    raise ValueError("unknown op")


if __name__ == "__main__":
    main()
