"""State shared by every API instance and worker (``QUEUE_BACKEND=redis``).

Same interfaces as the in-process versions, so the API code doesn't care which
it has:
- :class:`RedisRateLimiter` ~ :class:`app.ratelimit.RateLimiter` (sliding window,
  checked and recorded atomically in one Lua script),
- :class:`RedisByteQuota` ~ :class:`app.ratelimit.ByteQuota`,
- :class:`RedisExtractStore` ~ :class:`MemoryExtractStore` (``extract_id`` records).

Keys hold hashed client ids only (never IPs) and all expire (Safeguard 8).
"""

from __future__ import annotations

import json
import math
import time
import uuid
from collections.abc import Callable, Iterable
from typing import Any

from arq.connections import ArqRedis, RedisSettings, create_pool

from app.cache import TTLCache
from app.errors import ApiError, ErrorCode
from app.extractor import ExtractRecord
from app.ratelimit import DAY, HOUR, Rule


class RedisConnection:
    """One pool per process, opened in the app lifespan and shared by all users."""

    def __init__(self, redis_url: str | None = None, pool: ArqRedis | None = None) -> None:
        if pool is None and not redis_url:
            raise ValueError("redis_url or pool is required")
        self.redis_url = redis_url
        self._pool = pool
        self._owns_pool = pool is None

    async def start(self) -> None:
        if self._pool is None:
            self._pool = await create_pool(RedisSettings.from_dsn(self.redis_url or ""))

    async def stop(self) -> None:
        if self._owns_pool and self._pool is not None:
            await self._pool.aclose()
            self._pool = None

    @property
    def pool(self) -> ArqRedis:
        if self._pool is None:
            raise RuntimeError("redis connection not started")
        return self._pool


def _s(v: Any) -> str:
    return v.decode() if isinstance(v, bytes) else str(v)


# ------------------------------------------------------------------ rate limits

# KEYS: one sorted set per rule. ARGV: now_ms, member, then (limit, window_ms) per rule.
# Returns 0 when the hit was recorded on every rule, else the retry delay in ms
# (and records nothing), matching RateLimiter.hit.
_HIT_SCRIPT = """
local now = tonumber(ARGV[1])
local retry = 0
for i, key in ipairs(KEYS) do
  local limit = tonumber(ARGV[1 + 2 * i])
  local window = tonumber(ARGV[2 + 2 * i])
  redis.call('ZREMRANGEBYSCORE', key, '-inf', now - window)
  if redis.call('ZCARD', key) >= limit then
    local oldest = redis.call('ZRANGE', key, 0, 0, 'WITHSCORES')
    local wait = window - (now - tonumber(oldest[2]))
    if wait > retry then retry = wait end
  end
end
if retry > 0 then return retry end
for i, key in ipairs(KEYS) do
  redis.call('ZADD', key, now, ARGV[2])
  redis.call('PEXPIRE', key, tonumber(ARGV[2 + 2 * i]))
end
return 0
"""


class RedisRateLimiter:
    PREFIX = "vn:rl:"

    def __init__(self, conn: RedisConnection,
                 clock: Callable[[], float] = time.time) -> None:
        self.conn = conn
        self._clock = clock

    async def count(self, key: str, window: float) -> int:
        now_ms = int(self._clock() * 1000)
        return int(await self.conn.pool.zcount(self.PREFIX + key,
                                               f"({now_ms - int(window * 1000)}", "+inf"))

    async def hit(self, client: str, rules: Iterable[Rule], *,
                  message: str | None = None) -> None:
        rules = list(rules)
        if not rules:
            return
        now_ms = int(self._clock() * 1000)
        keys = [f"{self.PREFIX}{r.name}:{client}" for r in rules]
        args: list[Any] = [now_ms, uuid.uuid4().hex]
        for r in rules:
            args += [r.limit, int(r.window * 1000)]
        retry_ms = int(await self.conn.pool.eval(_HIT_SCRIPT, len(keys), *keys, *args))
        if retry_ms > 0:
            raise ApiError(ErrorCode.RATE_LIMITED, message,
                           headers={"Retry-After": str(max(1, math.ceil(retry_ms / 1000)))})


# ------------------------------------------------------------------ byte quota


def bytes_key(client: str) -> str:
    return f"vn:bytes:{client}"


async def add_bytes(r: ArqRedis, client: str, nbytes: int) -> None:
    async with r.pipeline(transaction=True) as pipe:
        pipe.zadd(bytes_key(client), {f"{uuid.uuid4().hex}:{int(nbytes)}": time.time()})
        pipe.expire(bytes_key(client), int(DAY))
        await pipe.execute()


class RedisByteQuota:
    """Workers record delivered bytes; every API instance checks the same totals."""

    def __init__(self, conn: RedisConnection, per_hour: int, per_day: int) -> None:
        self.conn = conn
        self.per_hour, self.per_day = per_hour, per_day

    async def add(self, client: str, nbytes: int) -> None:
        await add_bytes(self.conn.pool, client, nbytes)

    async def check(self, client: str, upcoming: int = 0) -> None:
        r = self.conn.pool
        now = time.time()
        await r.zremrangebyscore(bytes_key(client), 0, now - DAY)
        day = hour = 0
        for member, score in await r.zrangebyscore(bytes_key(client), now - DAY, "+inf",
                                                   withscores=True):
            n = int(_s(member).rsplit(":", 1)[1])
            day += n
            if now - score < HOUR:
                hour += n
        if hour + upcoming > self.per_hour or day + upcoming > self.per_day:
            raise ApiError(ErrorCode.RATE_LIMITED,
                           "You've reached the download limit for now. Please try again later.",
                           headers={"Retry-After": "3600"})


# --------------------------------------------------------------- extract records


class MemoryExtractStore:
    def __init__(self, ttl: float, max_entries: int) -> None:
        self._cache = TTLCache[ExtractRecord](ttl, max_entries)

    async def get(self, extract_id: str) -> ExtractRecord | None:
        return self._cache.get(extract_id)

    async def set(self, extract_id: str, record: ExtractRecord) -> None:
        self._cache.set(extract_id, record)


class RedisExtractStore:
    def __init__(self, conn: RedisConnection, ttl: float) -> None:
        self.conn = conn
        self.ttl = int(ttl)

    @staticmethod
    def _key(extract_id: str) -> str:
        return f"vn:extract:{extract_id}"

    async def get(self, extract_id: str) -> ExtractRecord | None:
        raw = await self.conn.pool.get(self._key(extract_id))
        if raw is None:
            return None
        try:
            return ExtractRecord.from_dict(json.loads(raw))
        except (ValueError, KeyError, TypeError):
            return None  # written by an incompatible version: treat as expired

    async def set(self, extract_id: str, record: ExtractRecord) -> None:
        await self.conn.pool.set(self._key(extract_id), json.dumps(record.to_dict()),
                                 ex=self.ttl)
