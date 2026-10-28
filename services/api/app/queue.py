"""Redis-backed jobs (``QUEUE_BACKEND=redis``): the API enqueues, arq workers download.

Keys (all ephemeral, docs/02 section 2):
- ``vn:job:<job_id>``: hash with the job record, TTL 2 h. The API reads only this
  for ``GET /v1/jobs/{id}``; the worker writes status and progress (at most once
  per second).
- ``vn:active:<client>``: set of the client's job ids, for the per-client cap.
  Members whose job finished or expired are pruned on read, so a crashed worker
  can't lock a client out.
- ``vn:bytes:<client>``: delivered bytes for the byte quota (see ``redis_state``).
- ``arq:queue:download``: the arq queue; its length drives load shedding.

The URL and the hashed client id are stored but never returned to clients.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from arq.connections import ArqRedis

from app.errors import ApiError, ErrorCode
from app.extractor import ResolvedPreset
from app.jobs import (
    FINISHED_JOB_TTL,
    JOB_ID_RE,
    JOB_RECORD_TTL,
    public_status,
    queue_full,
    too_many_active,
)
from app.redis_state import RedisConnection

log = logging.getLogger(__name__)

QUEUE_NAME = "arq:queue:download"
TASK_NAME = "download_job"


def job_key(job_id: str) -> str:
    return f"vn:job:{job_id}"


def active_key(client: str) -> str:
    return f"vn:active:{client}"


def _s(v: Any) -> str | None:
    if v is None:
        return None
    return v.decode() if isinstance(v, bytes) else str(v)


def decode_record(raw: dict[Any, Any]) -> dict[str, str]:
    return {_s(k) or "": _s(v) or "" for k, v in raw.items()}


def public_from_record(rec: dict[str, str], now: float | None = None) -> dict[str, Any]:
    expires = rec.get("expires_at")
    return public_status(
        rec.get("status", "queued"), float(rec.get("progress") or 0.0),
        rec.get("filename") or None, rec.get("download_url") or None,
        int(expires) if expires else None,
        json.loads(rec["error"]) if rec.get("error") else None, now,
    )


class RedisJobQueue:
    """API side of the Redis queue. Same interface as :class:`app.jobs.JobRunner`."""

    def __init__(self, conn: RedisConnection, *, max_queue_depth: int = 200,
                 max_active_per_client: int = 2) -> None:
        self.conn = conn
        self.max_queue_depth = max_queue_depth
        self.max_active_per_client = max_active_per_client

    async def start(self) -> None:  # the connection is opened by the app lifespan
        return None

    async def stop(self) -> None:
        return None

    def _redis(self) -> ArqRedis:
        return self.conn.pool

    async def active_count(self, client: str) -> int:
        r = self._redis()
        members = [_s(m) for m in await r.smembers(active_key(client))]
        live = 0
        for job_id in members:
            status = _s(await r.hget(job_key(job_id or ""), "status"))
            if status in ("queued", "running"):
                live += 1
            else:
                await r.srem(active_key(client), job_id)
        return live

    async def check_capacity(self, client: str) -> None:
        if await self.active_count(client) >= self.max_active_per_client:
            raise too_many_active()
        if await self._redis().zcard(QUEUE_NAME) >= self.max_queue_depth:
            raise queue_full()

    async def submit(self, client: str, url: str, preset: ResolvedPreset) -> str:
        await self.check_capacity(client)
        r = self._redis()
        job_id = uuid.uuid4().hex
        record = {"client": client, "url": url, "preset": json.dumps(preset.to_dict()),
                  "created_at": str(time.time()), "status": "queued", "progress": "0"}
        async with r.pipeline(transaction=True) as pipe:
            pipe.hset(job_key(job_id), mapping=record)
            pipe.expire(job_key(job_id), JOB_RECORD_TTL)
            pipe.sadd(active_key(client), job_id)
            pipe.expire(active_key(client), JOB_RECORD_TTL)
            await pipe.execute()
        job = await r.enqueue_job(TASK_NAME, job_id, _job_id=job_id, _queue_name=QUEUE_NAME)
        if job is None:  # arq refuses duplicate ids; a fresh uuid4 never collides
            raise ApiError(ErrorCode.INTERNAL)
        log.info("job queued job=%s preset=%s", job_id, preset.format_id)
        return job_id

    async def status(self, job_id: str) -> dict[str, Any] | None:
        if not JOB_ID_RE.match(job_id or ""):
            return None
        raw = await self._redis().hgetall(job_key(job_id))
        return public_from_record(decode_record(raw)) if raw else None


# ------------------------------------------------------------------ worker writes


async def mark_running(r: ArqRedis, job_id: str) -> None:
    await r.hset(job_key(job_id), mapping={"status": "running"})


async def set_progress(r: ArqRedis, job_id: str, value: float) -> None:
    await r.hset(job_key(job_id), "progress", f"{value:.4f}")


async def mark_done(r: ArqRedis, job_id: str, *, filename: str, download_url: str,
                    expires_at: int) -> None:
    async with r.pipeline(transaction=True) as pipe:
        pipe.hset(job_key(job_id), mapping={
            "status": "done", "progress": "1", "filename": filename,
            "download_url": download_url, "expires_at": str(expires_at),
            "finished_at": str(time.time())})
        pipe.expire(job_key(job_id), FINISHED_JOB_TTL)
        await pipe.execute()


async def mark_failed(r: ArqRedis, job_id: str, err: ApiError) -> None:
    async with r.pipeline(transaction=True) as pipe:
        pipe.hset(job_key(job_id), mapping={
            "status": "failed", "error": json.dumps(err.to_dict()),
            "finished_at": str(time.time())})
        pipe.expire(job_key(job_id), FINISHED_JOB_TTL)
        await pipe.execute()
    log.info("job failed job=%s code=%s", job_id, err.code)
