"""Redis-backed jobs (``QUEUE_BACKEND=redis``): the API enqueues, arq workers download.

Keys (all ephemeral, docs/02 section 2):
- ``vn:job:<job_id>``: hash with the job record, TTL 2 h. The API reads only this
  for ``GET /v1/jobs/{id}``; the worker writes status and progress (at most once
  per second).
- ``vn:active:<client>``: set of the client's job ids, for the per-client cap.
  Members whose job finished or expired are pruned on read, so a crashed worker
  can't lock a client out.
- ``vn:bytes:<client>``: sorted set of delivered bytes (score = time), for the
  hourly/daily byte quota; written by workers, checked by the API.
- ``arq:queue:download``: the arq queue; its length drives load shedding.

The URL and the hashed client id are stored but never returned to clients.
"""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from arq.connections import ArqRedis, RedisSettings, create_pool

from app.errors import ApiError, ErrorCode
from app.extractor import ResolvedPreset
from app.jobs import JOB_ID_RE, JOB_RECORD_TTL, public_status, queue_full, too_many_active
from app.ratelimit import DAY, HOUR

log = logging.getLogger(__name__)

QUEUE_NAME = "arq:queue:download"
TASK_NAME = "download_job"


def job_key(job_id: str) -> str:
    return f"vn:job:{job_id}"


def active_key(client: str) -> str:
    return f"vn:active:{client}"


def bytes_key(client: str) -> str:
    return f"vn:bytes:{client}"


async def connect(redis_url: str) -> ArqRedis:
    return await create_pool(RedisSettings.from_dsn(redis_url))


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

    def __init__(self, *, redis_url: str | None = None, pool: ArqRedis | None = None,
                 max_queue_depth: int = 200, max_active_per_client: int = 2) -> None:
        if pool is None and not redis_url:
            raise ValueError("redis_url or pool is required")
        self.redis_url = redis_url
        self.pool = pool
        self._owns_pool = pool is None
        self.max_queue_depth = max_queue_depth
        self.max_active_per_client = max_active_per_client

    async def start(self) -> None:
        if self.pool is None:
            self.pool = await connect(self.redis_url or "")

    async def stop(self) -> None:
        if self._owns_pool and self.pool is not None:
            await self.pool.aclose()
            self.pool = None

    def _redis(self) -> ArqRedis:
        if self.pool is None:
            raise RuntimeError("queue not started")
        return self.pool

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
        pipe.expire(job_key(job_id), JOB_RECORD_TTL)
        await pipe.execute()


async def mark_failed(r: ArqRedis, job_id: str, err: ApiError) -> None:
    async with r.pipeline(transaction=True) as pipe:
        pipe.hset(job_key(job_id), mapping={
            "status": "failed", "error": json.dumps(err.to_dict()),
            "finished_at": str(time.time())})
        pipe.expire(job_key(job_id), JOB_RECORD_TTL)
        await pipe.execute()
    log.info("job failed job=%s code=%s", job_id, err.code)


# -------------------------------------------------------------------- byte quota


class RedisByteQuota:
    """Shared version of :class:`app.ratelimit.ByteQuota` (same limits and messages)."""

    def __init__(self, pool_ref: Any, per_hour: int, per_day: int) -> None:
        self._pool_ref = pool_ref  # object with a .pool attribute (the started queue)
        self.per_hour, self.per_day = per_hour, per_day

    def _redis(self) -> ArqRedis:
        return self._pool_ref.pool

    async def add(self, client: str, nbytes: int) -> None:
        await add_bytes(self._redis(), client, nbytes)

    async def check(self, client: str, upcoming: int = 0) -> None:
        r = self._redis()
        now = time.time()
        await r.zremrangebyscore(bytes_key(client), 0, now - DAY)
        entries = await r.zrangebyscore(bytes_key(client), now - DAY, "+inf", withscores=True)
        day = hour = 0
        for member, score in entries:
            n = int((_s(member) or "0:0").rsplit(":", 1)[1])
            day += n
            if now - score < HOUR:
                hour += n
        if hour + upcoming > self.per_hour or day + upcoming > self.per_day:
            raise ApiError(ErrorCode.RATE_LIMITED,
                           "You've reached the download limit for now. Please try again later.",
                           headers={"Retry-After": "3600"})


async def add_bytes(r: ArqRedis, client: str, nbytes: int) -> None:
    now = time.time()
    async with r.pipeline(transaction=True) as pipe:
        pipe.zadd(bytes_key(client), {f"{uuid.uuid4().hex}:{int(nbytes)}": now})
        pipe.expire(bytes_key(client), int(DAY))
        await pipe.execute()
