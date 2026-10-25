"""In-memory rate limiting, byte quotas and client hashing (docs/03 section 4).

Single-process only (local dev / one API instance). Production uses Redis with
the same key scheme (docs/02). Full IPs are never stored: keys are
``HMAC(daily_pepper, ip_bucket)``, where the daily pepper is derived from a
master secret and the UTC date, and IPv6 clients are bucketed by /64.
"""

from __future__ import annotations

import base64
import datetime as dt
import hashlib
import hmac
import ipaddress
import math
import threading
import time
from collections import deque
from collections.abc import Callable, Iterable
from dataclasses import dataclass

from app.errors import ApiError, ErrorCode

MINUTE, HOUR, DAY = 60.0, 3600.0, 86400.0


def ip_bucket(ip: str) -> str:
    try:
        addr = ipaddress.ip_address(ip)
    except ValueError:
        return f"raw:{ip[:64]}"
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.IPv6Network(f"{addr}/64", strict=False))
    return str(addr)


class ClientHasher:
    """Daily-rotating keyed hashes of client IP buckets."""

    def __init__(self, master_key: bytes, today: Callable[[], dt.date] | None = None) -> None:
        self._master = master_key
        self._today = today or (lambda: dt.datetime.now(dt.UTC).date())

    def _pepper(self, purpose: str) -> bytes:
        info = f"{purpose}:{self._today().isoformat()}".encode()
        return hmac.new(self._master, info, hashlib.sha256).digest()

    def client_id(self, ip: str) -> str:
        """Rate-limit key (22 chars)."""
        mac = hmac.new(self._pepper("rl"), ip_bucket(ip).encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(mac).decode()[:22]

    def log_id(self, ip: str) -> str:
        """Separate, shorter hash for logs, so logs can't be joined with rate-limit keys."""
        mac = hmac.new(self._pepper("log"), ip_bucket(ip).encode(), hashlib.sha256).digest()
        return base64.urlsafe_b64encode(mac).decode()[:12]


@dataclass(frozen=True)
class Rule:
    name: str
    limit: int
    window: float


class RateLimiter:
    """Sliding-window log per key. Thread-safe; memory bounded by limits."""

    def __init__(self, clock: Callable[[], float] = time.monotonic) -> None:
        self._clock = clock
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()
        self._last_sweep = clock()

    def _prune(self, key: str, window: float, now: float) -> deque[float]:
        q = self._hits.setdefault(key, deque())
        while q and now - q[0] >= window:
            q.popleft()
        return q

    def count(self, key: str, window: float) -> int:
        with self._lock:
            now = self._clock()
            q = self._hits.get(key)
            if not q:
                return 0
            return sum(1 for t in q if now - t < window)

    def hit(self, client: str, rules: Iterable[Rule], *, message: str | None = None) -> None:
        """Record one hit against every rule, or raise rate_limited without recording."""
        rules = list(rules)
        with self._lock:
            now = self._clock()
            self._maybe_sweep(now, max((r.window for r in rules), default=DAY))
            retry = 0.0
            queues = []
            for r in rules:
                q = self._prune(f"{r.name}:{client}", r.window, now)
                if len(q) >= r.limit:
                    retry = max(retry, r.window - (now - q[0]))
                queues.append(q)
            if retry > 0:
                raise ApiError(ErrorCode.RATE_LIMITED, message,
                               headers={"Retry-After": str(max(1, math.ceil(retry)))})
            for q in queues:
                q.append(now)

    def _maybe_sweep(self, now: float, max_window: float) -> None:
        if now - self._last_sweep < 300:
            return
        self._last_sweep = now
        for key in [k for k, q in self._hits.items() if not q or now - q[-1] >= DAY]:
            del self._hits[key]


class ByteQuota:
    """Bytes delivered per client over sliding windows (8 GB/h, 20 GB/day by default)."""

    def __init__(self, per_hour: int, per_day: int, clock: Callable[[], float] = time.monotonic):
        self.per_hour, self.per_day = per_hour, per_day
        self._clock = clock
        self._log: dict[str, deque[tuple[float, int]]] = {}
        self._lock = threading.Lock()

    def add(self, client: str, nbytes: int) -> None:
        with self._lock:
            self._log.setdefault(client, deque()).append((self._clock(), int(nbytes)))

    def check(self, client: str, upcoming: int = 0) -> None:
        with self._lock:
            now = self._clock()
            q = self._log.get(client, deque())
            while q and now - q[0][0] >= DAY:
                q.popleft()
            day = sum(b for _, b in q)
            hour = sum(b for t, b in q if now - t < HOUR)
        if hour + upcoming > self.per_hour or day + upcoming > self.per_day:
            raise ApiError(ErrorCode.RATE_LIMITED,
                           "You've reached the download limit for now. Please try again later.",
                           headers={"Retry-After": "3600"})
