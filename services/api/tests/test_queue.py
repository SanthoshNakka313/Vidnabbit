"""Redis queue + arq worker against fakeredis (no network, no real Redis).

The API and the worker share one in-memory Redis server, and the worker runs on the
TestClient's event loop (``client.portal``), so this covers the real handoff:
API enqueues -> arq worker downloads -> API reports status from Redis.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import Iterator
from typing import Any

import arq.worker
import fakeredis
import pytest
from arq.connections import ArqRedis
from arq.worker import Worker
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app import main as main_mod
from app import worker as worker_mod
from app.config import Settings
from app.errors import ApiError, ErrorCode
from app.extractor import ResolvedPreset
from app.main import create_app
from app.queue import QUEUE_NAME, active_key, job_key
from app.redis_state import bytes_key
from app.ssrf import validate_url
from app.worker import startup, worker_options

from .conftest import DUMMY, FakeExtractor

URL = "https://www.youtube.com/watch?v=abc123"


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_avalidate(raw: str, timeout: float = 3.0, **_: object):
        return validate_url(raw, resolver=lambda h, p: ["93.184.215.14"])

    monkeypatch.setattr(main_mod, "avalidate_url", fake_avalidate)


@pytest.fixture(autouse=True)
def no_redis_info(monkeypatch: pytest.MonkeyPatch) -> None:
    async def noop(*args: Any, **kwargs: Any) -> None:  # fakeredis has no INFO command
        return None

    monkeypatch.setattr(arq.worker, "log_redis_info", noop)


@pytest.fixture
def pool() -> ArqRedis:
    server = fakeredis.FakeServer()
    return ArqRedis(connection_pool=fakeredis.aioredis.FakeRedis(server=server).connection_pool)


@pytest.fixture
def qsettings(settings: Settings) -> Settings:
    return settings.model_copy(update={"queue_backend": "redis"})


@pytest.fixture
def fake() -> FakeExtractor:
    return FakeExtractor()


@pytest.fixture
def client(qsettings, fake, pool) -> Iterator[TestClient]:
    app = create_app(qsettings, extractor=fake, redis_pool=pool)
    with TestClient(app) as c:
        yield c


def run_worker(client: TestClient, pool: ArqRedis, settings: Settings, fake: FakeExtractor,
               **ctx_extra: Any) -> None:
    """Drain the queue with a real arq Worker in burst mode, on the app's event loop."""
    storage = client.app.state.services.storage

    async def go() -> None:
        ctx: dict[str, Any] = {"extractor": fake, "storage": storage, **ctx_extra}
        await startup(ctx, settings)
        opts = {k: v for k, v in worker_options(settings).items() if k != "cron_jobs"}
        w = Worker(**opts, redis_pool=pool, burst=True, poll_delay=0.01, handle_signals=False,
                   ctx=ctx)
        await w.main()

    client.portal.call(go)


def redis(client: TestClient, coro_fn, *args):
    return client.portal.call(coro_fn, *args)


def start_job(client: TestClient, format_id: str = "mp4-720p"):
    extract_id = client.post("/v1/extract", json={"url": URL}).json()["id"]
    return client.post("/v1/jobs", json={"extract_id": extract_id, "format_id": format_id,
                                         "turnstile_token": DUMMY})


def test_api_enqueues_and_worker_completes(client, pool, qsettings, fake) -> None:
    r = start_job(client)
    assert r.status_code == 202, r.text
    job_id = r.json()["job_id"]
    assert client.get(f"/v1/jobs/{job_id}").json()["status"] == "queued"
    assert redis(client, pool.zcard, QUEUE_NAME) == 1
    assert fake.download_calls == []  # the API process never downloads in redis mode

    run_worker(client, pool, qsettings, fake)

    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "done" and body["progress"] == 1.0, body
    assert body["filename"] == "A CC video part 1.mp4" and body["expires_at"].endswith("Z")
    assert fake.download_calls == [(URL, "mp4-720p")]
    f = client.get(body["download_url"].removeprefix("http://localhost:8000"))
    assert f.status_code == 200 and f.content == b"\x00" * 1024
    # Bookkeeping: active set emptied, bytes recorded for the client's quota.
    record = redis(client, pool.hgetall, job_key(job_id))
    client_id = record[b"client"].decode()
    assert redis(client, pool.smembers, active_key(client_id)) == set()
    assert redis(client, pool.zcard, bytes_key(client_id)) == 1


def test_status_never_exposes_internal_fields(client, pool, qsettings, fake) -> None:
    job_id = start_job(client).json()["job_id"]
    run_worker(client, pool, qsettings, fake)
    body = client.get(f"/v1/jobs/{job_id}")
    assert set(body.json()) == {"status", "progress", "filename", "download_url", "expires_at",
                                "error"}
    assert "youtube.com" not in body.text and "client" not in body.text


def test_worker_reports_download_errors(client, pool, qsettings, fake) -> None:
    fake.download_error = ApiError(ErrorCode.TOO_LARGE)
    job_id = start_job(client).json()["job_id"]
    run_worker(client, pool, qsettings, fake)
    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "failed" and body["download_url"] is None
    assert body["error"]["code"] == "too_large"


def test_worker_fails_jobs_that_waited_too_long(client, pool, qsettings, fake) -> None:
    job_id = start_job(client).json()["job_id"]
    old = str(time.time() - qsettings.job_queue_max_wait_seconds - 1)
    redis(client, pool.hset, job_key(job_id), "created_at", old)
    run_worker(client, pool, qsettings, fake)
    body = client.get(f"/v1/jobs/{job_id}").json()
    assert body["status"] == "failed" and body["error"]["code"] == "upstream_error"
    assert fake.download_calls == []


def test_worker_crash_is_reported_as_internal(client, pool, qsettings, fake) -> None:
    class Boom(FakeExtractor):
        async def download(self, *args, **kwargs):
            raise RuntimeError("bug")

    job_id = start_job(client).json()["job_id"]
    run_worker(client, pool, qsettings, Boom())
    assert client.get(f"/v1/jobs/{job_id}").json()["error"]["code"] == "internal"


def test_expired_record_is_skipped(client, pool, qsettings, fake) -> None:
    job_id = start_job(client).json()["job_id"]
    redis(client, pool.delete, job_key(job_id))
    run_worker(client, pool, qsettings, fake)
    assert fake.download_calls == []
    assert client.get(f"/v1/jobs/{job_id}").status_code == 404


def test_active_jobs_cap_counts_only_live_jobs(qsettings, fake, pool) -> None:
    s = qsettings.model_copy(update={"rate_jobs_per_minute": 100})
    with TestClient(create_app(s, extractor=fake, redis_pool=pool)) as c:
        for _ in range(s.max_active_jobs_per_client):
            assert start_job(c).status_code == 202
        r = start_job(c)
        assert r.status_code == 429 and "in progress" in r.json()["error"]["message"]
        run_worker(c, pool, s, fake)  # both finish
        assert start_job(c).status_code == 202


def test_stale_active_members_are_pruned(client, pool) -> None:
    job_id = start_job(client).json()["job_id"]
    client_id = redis(client, pool.hget, job_key(job_id), "client").decode()
    redis(client, pool.delete, job_key(job_id))  # e.g. TTL expired after a worker died
    redis(client, pool.sadd, active_key(client_id), "f" * 32)
    assert start_job(client).status_code == 202
    assert start_job(client).status_code == 202  # cap is 2; the dead entries didn't count
    assert redis(client, pool.scard, active_key(client_id)) == 2


def test_queue_depth_sheds_load(qsettings, fake, pool) -> None:
    s = qsettings.model_copy(update={"max_queue_depth": 1})
    with TestClient(create_app(s, extractor=fake, redis_pool=pool)) as c:
        assert start_job(c).status_code == 202
        r = start_job(c)
        assert r.status_code == 503 and r.json()["error"]["code"] == "rate_limited"
        assert r.headers["retry-after"] == "30"


def test_byte_quota_is_shared_through_redis(qsettings, fake, pool) -> None:
    # Room for one m4a estimate (3.4 MB) plus 500 bytes: the worker's 1024 recorded
    # bytes, visible to the API only through Redis, are what tip the second job over.
    s = qsettings.model_copy(update={"bytes_per_client_hour": 3_400_500})
    with TestClient(create_app(s, extractor=fake, redis_pool=pool)) as c:
        job_id = start_job(c, "m4a").json()["job_id"]
        run_worker(c, pool, s, fake)  # delivers 1024 bytes
        assert c.get(f"/v1/jobs/{job_id}").json()["status"] == "done"
        r = start_job(c, "m4a")
        assert r.status_code == 429 and "download limit" in r.json()["error"]["message"]


def test_unknown_job_ids(client) -> None:
    for job_id in ("0" * 32, "../x", "nope"):
        assert client.get(f"/v1/jobs/{job_id}").status_code == 404


def test_progress_is_flushed_at_most_once_per_interval(monkeypatch) -> None:
    monkeypatch.setattr(worker_mod, "PROGRESS_FLUSH_SECONDS", 0.05)
    writes: list[str] = []

    class Recorder:
        async def hset(self, key, field, value):
            writes.append(value)

    async def go() -> None:
        flusher = worker_mod._ProgressFlusher(Recorder(), "a" * 32)
        for i in range(200):
            flusher.update(i / 200)
        await asyncio.sleep(0.12)
        flusher.update(0.999)  # capped at 0.99 until the job is done
        await flusher.close()

    asyncio.run(go())
    assert 1 <= len(writes) <= 4
    assert writes[-1] == "0.9900"


def test_preset_roundtrip_and_validation() -> None:
    p = ResolvedPreset("item2-best", "video", "137+140/bv*+ba", "mp4", {"format_id": "x"}, 2)
    assert ResolvedPreset.from_dict(json.loads(json.dumps(p.to_dict()))) == p
    with pytest.raises(ValueError):
        ResolvedPreset.from_dict({**p.to_dict(), "mode": "shell"})


def test_production_requires_redis_queue() -> None:
    with pytest.raises(ValidationError, match="QUEUE_BACKEND=redis"):
        Settings(app_env="production", _env_file=None)


def test_two_api_instances_share_state(qsettings, fake) -> None:
    """Extract on instance A, start the job on B, read status on A; limits are shared."""
    server = fakeredis.FakeServer()
    s = qsettings.model_copy(update={"rate_jobs_per_minute": 2})
    seeded = Settings(**{**s.model_dump(), "ip_hash_key_seed": "shared-seed"}, _env_file=None)

    def instance() -> TestClient:
        pool = ArqRedis(connection_pool=fakeredis.aioredis.FakeRedis(server=server)
                        .connection_pool)
        return TestClient(create_app(seeded, extractor=fake, redis_pool=pool))

    with instance() as a, instance() as b:
        extract_id = a.post("/v1/extract", json={"url": URL}).json()["id"]
        body = {"extract_id": extract_id, "format_id": "m4a", "turnstile_token": DUMMY}
        r = b.post("/v1/jobs", json=body)
        assert r.status_code == 202, r.text
        assert a.get(f"/v1/jobs/{r.json()['job_id']}").json()["status"] == "queued"
        assert a.post("/v1/jobs", json=body).status_code == 202
        # The third job request in a minute is refused wherever it lands.
        r = b.post("/v1/jobs", json=body)
        assert r.status_code == 429, r.text


def test_finished_job_records_expire_with_the_file(pool: ArqRedis) -> None:
    """A finished job's record holds the link and download URL: it lives no longer than the file."""
    from app.queue import mark_done, mark_failed

    async def run() -> tuple[int, int]:
        await pool.hset(job_key("a" * 32), mapping={"status": "running", "url": URL})
        await pool.hset(job_key("b" * 32), mapping={"status": "running", "url": URL})
        await mark_done(pool, "a" * 32, filename="x.mp4", download_url="https://x/y",
                        expires_at=int(time.time()) + 180)
        await mark_failed(pool, "b" * 32, ApiError(ErrorCode.INTERNAL))
        return await pool.ttl(job_key("a" * 32)), await pool.ttl(job_key("b" * 32))

    done_ttl, failed_ttl = asyncio.run(run())
    assert 0 < done_ttl <= 180
    assert 0 < failed_ttl <= 180


def test_files_last_three_minutes_by_default() -> None:
    assert Settings(_env_file=None).file_ttl_seconds == 180
    assert Settings(_env_file=None).extract_ttl_seconds <= 180
