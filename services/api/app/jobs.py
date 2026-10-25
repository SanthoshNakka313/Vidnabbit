"""In-memory async job runner (local dev; Redis + arq workers in production).

- bounded concurrency (``worker_concurrency``), bounded queue depth, per-client
  cap on queued + running jobs,
- each download runs in the sandbox child with a hard wall-clock timeout,
- per-job work dir ``{work_dir}/{job_id}/`` and on-disk name ``{job_id}.{ext}``,
  removed in ``finally``,
- finished files go to a :class:`~app.storage.Storage` with a TTL of at most 1 h,
- a janitor deletes expired files, stale work dirs and old job records.
"""

from __future__ import annotations

import asyncio
import contextlib
import datetime as dt
import logging
import re
import shutil
import time
import uuid
from collections.abc import Callable
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol

from app.errors import ApiError, ErrorCode
from app.extractor import DownloadedFile, ResolvedPreset
from app.storage import Storage, StoredFile, sanitize_filename

log = logging.getLogger(__name__)

JOB_ID_RE = re.compile(r"^[0-9a-f]{32}$")
JOB_RECORD_TTL = 2 * 3600
STALE_WORKDIR_SECONDS = 2 * 3600

Status = Literal["queued", "running", "done", "failed"]


class Downloader(Protocol):
    async def download(
        self, url: str, preset: ResolvedPreset, workdir: Path, job_uuid: str, *,
        on_progress: Callable[[float], None] | None = None,
    ) -> DownloadedFile: ...


def iso(ts: float | None) -> str | None:
    if ts is None:
        return None
    return dt.datetime.fromtimestamp(ts, dt.UTC).isoformat().replace("+00:00", "Z")


@dataclass
class Job:
    id: str
    client: str
    url: str
    preset: ResolvedPreset
    created_at: float = field(default_factory=time.time)
    status: Status = "queued"
    progress: float = 0.0
    filename: str | None = None
    stored: StoredFile | None = None
    download_url: str | None = None
    error: dict[str, str] | None = None
    finished_at: float | None = None
    task: asyncio.Task[None] | None = field(default=None, repr=False)

    def public(self, now: float | None = None) -> dict[str, Any]:
        now = now if now is not None else time.time()
        expired = self.stored is not None and now >= self.stored.expires_at
        return {
            "status": self.status,
            "progress": round(self.progress, 3),
            "filename": self.filename,
            "download_url": None if expired else self.download_url,
            "expires_at": iso(self.stored.expires_at) if self.stored else None,
            "error": self.error,
        }


class JobRunner:
    def __init__(
        self,
        downloader: Downloader,
        storage: Storage,
        *,
        work_dir: Path,
        concurrency: int = 2,
        max_queue_depth: int = 200,
        max_active_per_client: int = 2,
        file_ttl_seconds: int = 3600,
        max_queue_wait_seconds: float = 600.0,
        janitor_interval_seconds: float = 60.0,
        on_complete: Callable[[str, int], None] | None = None,
    ) -> None:
        self.downloader = downloader
        self.storage = storage
        self.work_dir = work_dir.resolve()
        self.max_queue_depth = max_queue_depth
        self.max_active_per_client = max_active_per_client
        self.file_ttl_seconds = file_ttl_seconds
        self.max_queue_wait_seconds = max_queue_wait_seconds
        self.janitor_interval_seconds = janitor_interval_seconds
        self.on_complete = on_complete
        self._sem = asyncio.Semaphore(concurrency)
        self._jobs: dict[str, Job] = {}
        self._janitor: asyncio.Task[None] | None = None

    # ------------------------------------------------------------ lifecycle
    async def start(self) -> None:
        self.work_dir.mkdir(parents=True, exist_ok=True)
        for leftover in self.work_dir.iterdir():  # crash leftovers from a previous run
            if leftover.is_dir() and JOB_ID_RE.match(leftover.name):
                shutil.rmtree(leftover, ignore_errors=True)
        self._janitor = asyncio.create_task(self._janitor_loop())

    async def stop(self) -> None:
        tasks = [j.task for j in self._jobs.values() if j.task and not j.task.done()]
        if self._janitor:
            tasks.append(self._janitor)
        for t in tasks:
            t.cancel()
        for t in tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t

    # ----------------------------------------------------------------- API
    def active_count(self, client: str | None = None) -> int:
        return sum(
            1 for j in self._jobs.values()
            if j.status in ("queued", "running") and (client is None or j.client == client)
        )

    def check_capacity(self, client: str) -> None:
        if self.active_count(client) >= self.max_active_per_client:
            raise ApiError(ErrorCode.RATE_LIMITED,
                           "You already have downloads in progress. Wait for one to finish.",
                           headers={"Retry-After": "10"})
        if self.active_count() >= self.max_queue_depth:
            raise ApiError(ErrorCode.RATE_LIMITED, "We're busy right now. Try again shortly.",
                           status=503, headers={"Retry-After": "30"})

    def submit(self, client: str, url: str, preset: ResolvedPreset) -> Job:
        self.check_capacity(client)
        job = Job(id=uuid.uuid4().hex, client=client, url=url, preset=preset)
        self._jobs[job.id] = job
        job.task = asyncio.create_task(self._run(job))
        return job

    def get(self, job_id: str) -> Job | None:
        if not JOB_ID_RE.match(job_id or ""):
            return None
        return self._jobs.get(job_id)

    # -------------------------------------------------------------- worker
    async def _run(self, job: Job) -> None:
        async with self._sem:
            if time.time() - job.created_at > self.max_queue_wait_seconds:
                self._fail(job, ApiError(ErrorCode.UPSTREAM_ERROR,
                                         "The queue was too long. Please try again."))
                return
            job.status = "running"
            workdir = self.work_dir / job.id
            try:
                workdir.mkdir(mode=0o700)
                result = await self.downloader.download(
                    job.url, job.preset, workdir, job.id, on_progress=self._progress_cb(job)
                )
                filename = sanitize_filename(result.title, result.ext)
                stored = await asyncio.to_thread(
                    self.storage.put, job.id, result.path, filename, self.file_ttl_seconds
                )
                job.stored = stored
                job.filename = filename
                job.download_url = self.storage.download_url(stored)
                job.progress = 1.0
                job.status = "done"
                job.finished_at = time.time()
                if self.on_complete:
                    self.on_complete(job.client, stored.size)
                log.info("job done job=%s preset=%s bytes=%d", job.id, job.preset.format_id,
                         stored.size)
            except ApiError as e:
                self._fail(job, e)
            except asyncio.CancelledError:
                self._fail(job, ApiError(ErrorCode.INTERNAL, "The job was cancelled."))
                raise
            except Exception:
                log.exception("job crashed job=%s", job.id)
                self._fail(job, ApiError(ErrorCode.INTERNAL))
            finally:
                shutil.rmtree(workdir, ignore_errors=True)

    @staticmethod
    def _progress_cb(job: Job) -> Callable[[float], None]:
        def cb(v: float) -> None:
            job.progress = max(job.progress, min(0.99, float(v)))

        return cb

    @staticmethod
    def _fail(job: Job, err: ApiError) -> None:
        job.status = "failed"
        job.error = err.to_dict()
        job.finished_at = time.time()
        log.info("job failed job=%s code=%s", job.id, err.code)

    # ------------------------------------------------------------- janitor
    async def _janitor_loop(self) -> None:
        while True:
            await asyncio.sleep(self.janitor_interval_seconds)
            try:
                await asyncio.to_thread(self.sweep)
            except Exception:
                log.exception("janitor sweep failed")

    def sweep(self, now: float | None = None) -> None:
        now = now if now is not None else time.time()
        removed = self.storage.delete_expired(now)
        for job_id in [jid for jid, j in self._jobs.items()
                       if j.finished_at and now - j.finished_at > JOB_RECORD_TTL]:
            del self._jobs[job_id]
        for d in self.work_dir.iterdir():
            if d.is_dir() and now - d.stat().st_mtime > STALE_WORKDIR_SECONDS:
                shutil.rmtree(d, ignore_errors=True)
        if removed:
            log.info("janitor removed %d expired files", removed)
