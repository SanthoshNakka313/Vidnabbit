"""Rate limits, byte quotas and privacy-preserving client hashing (docs/03 section 4)."""

from __future__ import annotations

import datetime as dt

import pytest

from app.errors import ApiError
from app.ratelimit import ByteQuota, ClientHasher, RateLimiter, Rule, ip_bucket


class Clock:
    def __init__(self) -> None:
        self.t = 1000.0

    def __call__(self) -> float:
        return self.t


def test_sliding_window_and_retry_after() -> None:
    clock = Clock()
    rl = RateLimiter(clock)
    rules = [Rule("m", 2, 60)]
    rl.hit("c", rules)
    clock.t += 10
    rl.hit("c", rules)
    with pytest.raises(ApiError) as ei:
        rl.hit("c", rules)
    assert ei.value.code == "rate_limited" and ei.value.headers["Retry-After"] == "50"
    rl.hit("other", rules)  # independent client
    clock.t += 50
    rl.hit("c", rules)  # the first hit slid out


def test_refused_hit_is_not_recorded_against_any_rule() -> None:
    clock = Clock()
    rl = RateLimiter(clock)
    rl.hit("c", [Rule("tight", 1, 60)])
    with pytest.raises(ApiError):
        rl.hit("c", [Rule("loose", 10, 60), Rule("tight", 1, 60)])
    assert rl.count("loose:c", 60) == 0


@pytest.mark.parametrize(("ip", "bucket"), [
    ("203.0.113.9", "203.0.113.9"),
    ("2001:db8:1:2:3:4:5:6", "2001:db8:1:2::/64"),
    ("2001:db8:1:2:ffff::1", "2001:db8:1:2::/64"),
    ("::ffff:198.51.100.7", "198.51.100.7"),
    ("testclient", "raw:testclient"),
])
def test_ip_bucket(ip: str, bucket: str) -> None:
    assert ip_bucket(ip) == bucket


def test_client_hash_rotates_daily_and_hides_ip() -> None:
    day = [dt.date(2026, 10, 24)]
    h = ClientHasher(b"seed", today=lambda: day[0])
    a = h.client_id("203.0.113.9")
    assert "203" not in a and len(a) == 22
    assert h.client_id("203.0.113.9") == a
    assert h.client_id("2001:db8::1") == h.client_id("2001:db8::2")  # same /64
    assert h.log_id("203.0.113.9") != a[:12]  # logs can't be joined to rate-limit keys
    day[0] = dt.date(2026, 10, 25)
    assert h.client_id("203.0.113.9") != a


@pytest.mark.anyio
async def test_byte_quota() -> None:
    clock = Clock()
    q = ByteQuota(per_hour=100, per_day=150, clock=clock)
    await q.check("c", 100)
    await q.add("c", 90)
    with pytest.raises(ApiError):
        await q.check("c", 20)
    clock.t += 3600
    await q.check("c", 50)  # hour window reset, day still has 90
    with pytest.raises(ApiError):
        await q.check("c", 61)
