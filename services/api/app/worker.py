"""Download worker for ``QUEUE_BACKEND=redis`` (docs/02 section 2.2).

Run: ``arq app.worker.WorkerSettings`` (same image as the API, different command).

Each job reads its record from Redis, runs the same sandboxed download as the
in-process runner (:func:`app.jobs.perform_download`), stores the file for at most
1 hour and writes the result back. Progress is flushed to Redis at most once per
second. A cron task sweeps expired files and stale work dirs every 5 minutes.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import logging
import time
from typing import Any

from arq import cron
from arq.connections import RedisSettings
from arq.worker import func

from app.config import Settings, get_settings
from app.errors import ApiError, ErrorCode
from app.extractor import ResolvedPreset
from app.jobs import perform_download, queue_wait_exceeded, sweep_work_dir, wipe_work_dir
from app.main import build_extractor, build_policy, build_storage
from app.queue import (
    QUEUE_NAME,
    TASK_NAME,
    active_key,
    decode_record,
    job_key,
    mark_done,
    mark_failed,
    mark_running,
    set_progress,
)
from app.redis_state import add_bytes

log = logging.getLogger("vidnabbit.worker")
PROGRESS_FLUSH_SECONDS = 1.0


async def startup(ctx: dict[str, Any], settings: Settings | None = None) -> None:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper(),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    ctx["settings"] = settings
    ctx.setdefault("extractor", build_extractor(settings, build_policy(settings)))
    ctx.setdefault("storage", build_storage(settings))
    ctx["work_dir"] = settings.work_dir.resolve()
    wipe_work_dir(ctx["work_dir"])


async def download_job(ctx: dict[str, Any], job_id: str) -> str:
    r = ctx["redis"]
    settings: Settings = ctx["settings"]
    rec = decode_record(await r.hgetall(job_key(job_id)))
    if not rec:
        return "expired"  # the record outlived its TTL before a worker got to it
    if rec.get("status") in ("done", "failed"):
        return rec["status"]
    client = rec.get("client", "")
    try:
        if time.time() - float(rec.get("created_at") or 0) > settings.job_queue_max_wait_seconds:
            await mark_failed(r, job_id, queue_wait_exceeded())
            return "failed"
        preset = ResolvedPreset.from_dict(json.loads(rec["preset"]))
        await mark_running(r, job_id)
        progress = _ProgressFlusher(r, job_id)
        try:
            stored, filename = await perform_download(
                ctx["extractor"], ctx["storage"], ctx["work_dir"], job_id, rec["url"], preset,
                settings.file_ttl_seconds, on_progress=progress.update)
        finally:
            await progress.close()
        url = await asyncio.to_thread(ctx["storage"].download_url, stored)
        await mark_done(r, job_id, filename=filename, download_url=url,
                        expires_at=stored.expires_at)
        await add_bytes(r, client, stored.size)
        log.info("job done job=%s preset=%s bytes=%d", job_id, preset.format_id, stored.size)
        return "done"
    except ApiError as e:
        await mark_failed(r, job_id, e)
        return "failed"
    except asyncio.CancelledError:  # job timeout or shutdown after the grace period
        with contextlib.suppress(Exception):
            await asyncio.shield(mark_failed(r, job_id, ApiError(
                ErrorCode.UPSTREAM_ERROR, "The download took too long.")))
        raise
    except Exception:
        log.exception("job crashed job=%s", job_id)
        await mark_failed(r, job_id, ApiError(ErrorCode.INTERNAL))
        return "failed"
    finally:
        with contextlib.suppress(Exception):
            await r.srem(active_key(client), job_id)


class _ProgressFlusher:
    """yt-dlp reports progress many times a second; Redis gets it at most once a second."""

    def __init__(self, r: Any, job_id: str) -> None:
        self.r, self.job_id = r, job_id
        self.latest = 0.0
        self.written = 0.0
        self._task = asyncio.create_task(self._loop())

    def update(self, v: float) -> None:
        self.latest = max(self.latest, min(0.99, float(v)))

    async def _loop(self) -> None:
        while True:
            await asyncio.sleep(PROGRESS_FLUSH_SECONDS)
            await self._flush()

    async def _flush(self) -> None:
        if self.latest > self.written:
            self.written = self.latest
            await set_progress(self.r, self.job_id, self.written)

    async def close(self) -> None:
        self._task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await self._task
        with contextlib.suppress(Exception):
            await self._flush()


async def sweep(ctx: dict[str, Any]) -> None:
    now = time.time()
    removed = await asyncio.to_thread(ctx["storage"].delete_expired, now)
    await asyncio.to_thread(sweep_work_dir, ctx["work_dir"], now)
    if removed:
        log.info("sweeper removed %d expired files", removed)


def worker_options(settings: Settings) -> dict[str, Any]:
    """Everything arq needs except the Redis connection (shared with tests)."""
    return {
        "functions": [func(download_job, name=TASK_NAME)],
        "cron_jobs": [cron(sweep, minute=set(range(0, 60, 5)), run_at_startup=True)],
        "queue_name": QUEUE_NAME,
        "max_jobs": settings.worker_concurrency,
        # The sandbox enforces job_timeout itself; this is the outer backstop.
        "job_timeout": int(settings.job_timeout_seconds) + 120,
        "max_tries": 2,  # one retry if a worker dies mid-job; failures are not retried
        "keep_result": 60,
        "job_completion_wait": settings.worker_shutdown_grace_seconds,
    }


_settings = get_settings()
_options = worker_options(_settings)


class WorkerSettings:
    """Entry point for ``arq app.worker.WorkerSettings``."""

    on_startup = startup
    redis_settings = RedisSettings.from_dsn(_settings.redis_url)
    functions = _options["functions"]
    cron_jobs = _options["cron_jobs"]
    queue_name = _options["queue_name"]
    max_jobs = _options["max_jobs"]
    job_timeout = _options["job_timeout"]
    max_tries = _options["max_tries"]
    keep_result = _options["keep_result"]
    job_completion_wait = _options["job_completion_wait"]
