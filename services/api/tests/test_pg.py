"""Takedowns and the blocklist on a real Postgres.

Set ``VN_TEST_DATABASE_URL`` to an empty, throwaway database to run these (every
test drops and recreates its schema); they are skipped otherwise.
"""

from __future__ import annotations

import asyncio
import os
from collections.abc import Iterator
from typing import Any

import fakeredis
import psycopg
import pytest
from arq.connections import ArqRedis
from fastapi.testclient import TestClient
from pydantic import SecretStr

from app import admin
from app import main as main_mod
from app.config import Settings
from app.main import create_app
from app.pg import Database, PostgresBlocklist
from app.policy import canonicalize_url
from app.ssrf import validate_url

from .conftest import DUMMY, FakeExtractor

DB_URL = os.environ.get("VN_TEST_DATABASE_URL")
pytestmark = pytest.mark.skipif(not DB_URL, reason="VN_TEST_DATABASE_URL not set")

URL = "https://www.youtube.com/watch?v=abc123"
CANON = canonicalize_url(URL)


@pytest.fixture(autouse=True)
def clean_db() -> None:
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE")
        conn.execute("CREATE SCHEMA public")


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_avalidate(raw: str, timeout: float = 3.0):
        return validate_url(raw, resolver=lambda h, p: ["93.184.215.14"])

    monkeypatch.setattr(main_mod, "avalidate_url", fake_avalidate)


@pytest.fixture
def pg_settings(settings: Settings) -> Settings:
    return settings.model_copy(update={"database_url": SecretStr(DB_URL or "")})


def sql(query: str, *params: Any) -> list[tuple[Any, ...]]:
    with psycopg.connect(DB_URL, autocommit=True) as conn:
        cur = conn.execute(query, params)
        return cur.fetchall() if cur.description else []


def takedown(client: TestClient, urls: list[str]):
    return client.post("/v1/takedown", json={
        "urls": urls, "name": "Rights Holder", "email": "legal@example.com",
        "statement_good_faith": True, "statement_accuracy": True, "signature": "R. Holder"})


def extract(client: TestClient):
    return client.post("/v1/extract", json={"url": URL})


@pytest.fixture
def client(pg_settings: Settings) -> Iterator[TestClient]:
    with TestClient(create_app(pg_settings, extractor=FakeExtractor())) as c:
        yield c


def test_migrations_apply_once(client) -> None:
    rows = sql("SELECT version FROM schema_migrations")
    assert rows == [("0001_takedowns_blocklist.sql",)]

    async def again() -> list[str]:
        db = Database(DB_URL or "")
        await db.pool.open()
        try:
            return await db.migrate()
        finally:
            await db.stop()

    assert asyncio.run(again()) == []


def test_takedown_is_stored_and_blocks_provisionally(client, pg_settings) -> None:
    assert extract(client).status_code == 200  # warm the extract cache
    r = takedown(client, [URL + "&utm_source=x"])
    assert r.status_code == 202, r.text
    takedown_id = r.json()["id"]
    assert extract(client).status_code == 451
    (row,) = sql("SELECT name, email, status::text, urls FROM takedown_requests")
    assert row == ("Rights Holder", "legal@example.com", "received", [URL + "&utm_source=x"])
    (entry,) = sql("SELECT kind::text, value, reason, takedown_id::text, active "
                   "FROM blocklist_entries")
    assert entry == ("canonical_url", CANON, "dmca", takedown_id, True)
    # Nothing is written to the JSON files any more.
    assert not pg_settings.takedown_path.exists()
    assert not pg_settings.blocklist_path.exists()


def test_two_instances_share_blocks_through_redis(pg_settings) -> None:
    """A takedown on instance A blocks on instance B at once (pub/sub), no poll wait."""
    server = fakeredis.FakeServer()
    s = pg_settings.model_copy(update={"queue_backend": "redis",
                                       "blocklist_refresh_seconds": 3600})

    def instance() -> TestClient:
        pool = ArqRedis(connection_pool=fakeredis.aioredis.FakeRedis(server=server)
                        .connection_pool)
        return TestClient(create_app(s, extractor=FakeExtractor(), redis_pool=pool))

    with instance() as a, instance() as b:
        assert extract(b).status_code == 200
        assert takedown(a, [URL]).status_code == 202
        for _ in range(100):
            if extract(b).status_code == 451:
                break
            b.portal.call(asyncio.sleep, 0.02)
        assert extract(b).status_code == 451


def test_refresh_picks_up_out_of_band_writes(client) -> None:
    """Without a Redis message (e.g. Redis down), the periodic refresh still applies blocks."""
    assert extract(client).status_code == 200
    sql("INSERT INTO blocklist_entries (kind, site, value, reason, created_by) "
        "VALUES ('site_media_id', 'youtube', 'abc123', 'operator', 'test')")
    blocklist = client.app.state.services.policy.blocklist
    client.portal.call(blocklist.refresh)
    assert extract(client).status_code == 451


def test_startup_fails_closed_without_the_database(settings) -> None:
    bad = settings.model_copy(update={
        "database_url": SecretStr("postgresql://vn@127.0.0.1:1/nope?connect_timeout=1")})
    import app.pg as pg_mod

    real_open = pg_mod.AsyncConnectionPool.open

    async def quick_open(self, wait: bool = False, timeout: float = 30.0) -> None:
        await real_open(self, wait=wait, timeout=1.0)

    mp = pytest.MonkeyPatch()
    mp.setattr(pg_mod.AsyncConnectionPool, "open", quick_open)
    app = create_app(bad, extractor=FakeExtractor())
    try:
        with pytest.raises(Exception), TestClient(app):  # noqa: B017 - any startup error
            pass
    finally:
        mp.undo()


def test_failed_refresh_keeps_last_snapshot(client) -> None:
    assert takedown(client, [URL]).status_code == 202
    blocklist: PostgresBlocklist = client.app.state.services.policy.blocklist

    async def broken() -> None:
        raise psycopg.OperationalError("db gone")

    original = blocklist.refresh
    blocklist.refresh = broken  # type: ignore[method-assign]
    try:
        with pytest.raises(psycopg.OperationalError):
            client.portal.call(blocklist.refresh)
        assert extract(client).status_code == 451  # still blocked
    finally:
        blocklist.refresh = original  # type: ignore[method-assign]


def run_admin(pg_settings: Settings, monkeypatch: pytest.MonkeyPatch,
              capsys: pytest.CaptureFixture[str], *argv: str) -> str:
    monkeypatch.setattr(admin, "get_settings", lambda: pg_settings)
    assert admin.main(list(argv)) == 0
    return capsys.readouterr().out


def test_admin_block_unblock_and_reject(client, pg_settings, monkeypatch, capsys) -> None:
    blocklist = client.app.state.services.policy.blocklist
    assert extract(client).status_code == 200  # cached: the block must apply on reuse
    out = run_admin(pg_settings, monkeypatch, capsys, "block", "item", "YouTube", "abc123")
    assert out.strip() == "blocked"
    client.portal.call(blocklist.refresh)
    assert extract(client).status_code == 451

    run_admin(pg_settings, monkeypatch, capsys, "unblock", "item", "youtube", "abc123")
    client.portal.call(blocklist.refresh)
    assert extract(client).status_code == 200

    takedown_id = takedown(client, [URL]).json()["id"]
    listing = run_admin(pg_settings, monkeypatch, capsys, "takedowns", "--open")
    assert takedown_id in listing and "received" in listing
    assert "legal@example.com" in run_admin(pg_settings, monkeypatch, capsys,
                                            "show", takedown_id)
    run_admin(pg_settings, monkeypatch, capsys, "decide", takedown_id, "rejected",
              "--notes", "not the rights holder")
    client.portal.call(blocklist.refresh)
    assert extract(client).status_code == 200  # rejecting lifts the provisional block
    assert sql("SELECT status::text, decided_at IS NOT NULL FROM takedown_requests") == [
        ("rejected", True)]
    assert run_admin(pg_settings, monkeypatch, capsys, "takedowns", "--open").strip() == ""


def test_admin_domain_exclusion(client, pg_settings, monkeypatch, capsys) -> None:
    run_admin(pg_settings, monkeypatch, capsys, "block", "domain", "YouTube.com.")
    assert sql("SELECT value, reason FROM blocklist_entries") == [
        ("youtube.com", "domain_exclusion")]
    client.portal.call(client.app.state.services.policy.blocklist.refresh)
    assert extract(client).status_code == 451
    assert "youtube.com" in run_admin(pg_settings, monkeypatch, capsys, "blocklist")


def test_purge_removes_personal_data_but_keeps_blocks(client, pg_settings, monkeypatch,
                                                      capsys) -> None:
    takedown(client, [URL])
    takedown(client, ["https://vimeo.com/1"])
    sql("UPDATE takedown_requests SET received_at = now() - interval '4 years' "
        "WHERE urls ? %s", URL)
    out = run_admin(pg_settings, monkeypatch, capsys, "purge")
    assert out.strip() == "purged 1"
    assert sql("SELECT count(*) FROM takedown_requests") == [(1,)]
    rows = dict(sql("SELECT value, takedown_id IS NULL FROM blocklist_entries"))
    assert rows == {canonicalize_url("https://vimeo.com/1"): False, CANON: True}
    client.portal.call(client.app.state.services.policy.blocklist.refresh)
    assert extract(client).status_code == 451  # the block outlives the request


def test_reblocking_a_revoked_entry_reactivates_it(client, pg_settings, monkeypatch,
                                                   capsys) -> None:
    run_admin(pg_settings, monkeypatch, capsys, "block", "url", URL)
    run_admin(pg_settings, monkeypatch, capsys, "unblock", "url", URL)
    assert takedown(client, [URL]).status_code == 202
    assert sql("SELECT active, reason, revoked_at IS NULL FROM blocklist_entries") == [
        (True, "dmca", True)]


def test_job_is_refused_after_takedown_between_extract_and_job(client) -> None:
    extract_id = extract(client).json()["id"]
    assert takedown(client, [URL]).status_code == 202
    r = client.post("/v1/jobs", json={"extract_id": extract_id, "format_id": "best",
                                      "turnstile_token": DUMMY})
    assert r.status_code == 451
