"""Run yt-dlp work in a killable child process (docs/03 2.5).

Each task runs ``app.sandbox_runner`` in a fresh Python process with:
- its own session/process group (killed as a group on timeout or cancellation),
- rlimits (CPU, file size, open files, no core dumps; address space and process
  count on Linux),
- a scrubbed environment (no secrets; ``YTDLP_NO_PLUGINS=1``; proxy vars only),
- Python isolated mode (``-I``: ignores PYTHON* env vars and user site-packages).
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import os
import signal
import sys
from collections.abc import Awaitable, Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from app.errors import ApiError, ErrorCode

log = logging.getLogger(__name__)

SERVICE_ROOT = Path(__file__).resolve().parent.parent
_BOOTSTRAP = (
    "import sys; sys.path.insert(0, sys.argv[1]); "
    "from app.sandbox_runner import main; main()"
)
MAX_LINE_BYTES = 16 * 1024 * 1024


@dataclass(frozen=True)
class SandboxLimits:
    cpu_seconds: int = 1800
    file_size_bytes: int = int(4 * 1024**3 * 1.05)
    address_space_bytes: int = 2 * 1024**3  # Linux only
    max_processes: int = 256  # Linux only; counts all threads of the uid
    open_files: int = 256


def _make_preexec(limits: SandboxLimits) -> Callable[[], None]:
    def preexec() -> None:  # runs in the child between fork and exec
        import resource

        def setlim(name: str, value: int) -> None:
            res = getattr(resource, name, None)
            if res is None:
                return
            with contextlib.suppress(ValueError, OSError):
                _soft, hard = resource.getrlimit(res)
                v = value if hard == resource.RLIM_INFINITY else min(value, hard)
                resource.setrlimit(res, (v, v))

        setlim("RLIMIT_CORE", 0)
        setlim("RLIMIT_CPU", limits.cpu_seconds)
        setlim("RLIMIT_FSIZE", limits.file_size_bytes)
        setlim("RLIMIT_NOFILE", limits.open_files)
        if sys.platform.startswith("linux"):
            setlim("RLIMIT_AS", limits.address_space_bytes)
            setlim("RLIMIT_NPROC", limits.max_processes)

    return preexec


def scrubbed_env(home: Path, proxy_url: str | None, tmpdir: Path | None = None) -> dict[str, str]:
    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": str(home),
        "LANG": "C.UTF-8",
        "LC_ALL": "C.UTF-8",
        "YTDLP_NO_PLUGINS": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "SANDBOX_LOG_LEVEL": "WARNING",
    }
    if tmpdir is not None:
        env["TMPDIR"] = str(tmpdir)
    if proxy_url:
        env.update(HTTP_PROXY=proxy_url, HTTPS_PROXY=proxy_url, http_proxy=proxy_url,
                   https_proxy=proxy_url, NO_PROXY="", no_proxy="")
    return env


class SandboxTimeout(Exception):
    pass


Message = dict[str, Any]
Handler = Callable[[Message], Awaitable[str | None]]


class Sandbox:
    """Spawns one child per task and speaks the JSON-lines protocol."""

    def __init__(
        self,
        *,
        home: Path,
        proxy_url: str | None = None,
        limits: SandboxLimits | None = None,
        argv: Sequence[str] | None = None,
    ) -> None:
        self.home = home
        self.proxy_url = proxy_url
        self.limits = limits or SandboxLimits()
        self.argv = list(argv) if argv else [sys.executable, "-I", "-c", _BOOTSTRAP,
                                             str(SERVICE_ROOT)]

    async def run(
        self,
        task: Message,
        *,
        timeout: float,
        on_message: Handler | None = None,
        tmpdir: Path | None = None,
    ) -> Message:
        """Run ``task``; return the final result message or raise ApiError.

        ``on_message`` receives intermediate messages (progress, info). If it
        returns a string, that line is written to the child's stdin.
        """
        self.home.mkdir(parents=True, exist_ok=True)
        proc = await asyncio.create_subprocess_exec(
            *self.argv,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
            env=scrubbed_env(self.home, self.proxy_url, tmpdir),
            cwd=str(tmpdir or self.home),
            start_new_session=True,
            preexec_fn=_make_preexec(self.limits),
            limit=MAX_LINE_BYTES,
        )
        stderr_task = asyncio.create_task(self._drain_stderr(proc))
        try:
            async with asyncio.timeout(timeout):
                return await self._converse(proc, task, on_message)
        except TimeoutError as e:
            raise ApiError(ErrorCode.UPSTREAM_ERROR, "The source took too long to respond.") from e
        finally:
            self._kill(proc)
            with contextlib.suppress(ProcessLookupError, TimeoutError):
                await asyncio.wait_for(proc.wait(), 5)
            stderr_task.cancel()
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await stderr_task

    async def _converse(
        self, proc: asyncio.subprocess.Process, task: Message, on_message: Handler | None
    ) -> Message:
        if proc.stdin is None or proc.stdout is None:
            raise ApiError(ErrorCode.INTERNAL)
        proc.stdin.write((json.dumps(task) + "\n").encode())
        await proc.stdin.drain()
        while True:
            line = await proc.stdout.readline()
            if not line:
                code = await proc.wait()
                log.warning("sandbox exited without result rc=%s", code)
                if code == -signal.SIGXFSZ:
                    raise ApiError(ErrorCode.TOO_LARGE)
                if code in (-signal.SIGXCPU, -signal.SIGKILL):
                    raise ApiError(ErrorCode.UPSTREAM_ERROR, "The download took too long.")
                raise ApiError(ErrorCode.INTERNAL)
            try:
                msg = json.loads(line)
            except ValueError:
                log.warning("sandbox sent a malformed line")
                raise ApiError(ErrorCode.INTERNAL) from None
            kind = msg.get("t")
            if kind == "result":
                return msg
            if kind == "error":
                try:
                    code_enum = ErrorCode(msg.get("code"))
                except ValueError:
                    code_enum = ErrorCode.INTERNAL
                raise ApiError(code_enum, str(msg.get("message") or "")[:300] or None)
            if on_message is not None:
                reply = await on_message(msg)
                if reply is not None:
                    proc.stdin.write((reply + "\n").encode())
                    await proc.stdin.drain()

    @staticmethod
    async def _drain_stderr(proc: asyncio.subprocess.Process) -> None:
        if proc.stderr is None:
            return
        kept = 0
        while True:
            line = await proc.stderr.readline()
            if not line:
                return
            if kept < 50:  # bounded; the child logs redacted text only
                log.debug("sandbox: %s", line.decode(errors="replace").rstrip()[:500])
                kept += 1

    @staticmethod
    def _kill(proc: asyncio.subprocess.Process) -> None:
        # Always kill the whole group: also reaps orphaned ffmpeg grandchildren.
        with contextlib.suppress(ProcessLookupError, PermissionError):
            os.killpg(proc.pid, signal.SIGKILL)
