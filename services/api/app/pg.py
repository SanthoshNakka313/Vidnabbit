"""Postgres: takedown requests and the rights-holder blocklist (``DATABASE_URL`` set).

- :class:`Database`: async pool plus migrations (``app/migrations/*.sql``, applied in
  order under an advisory lock so concurrent starts can't race).
- :class:`PostgresBlocklist`: every process keeps an in-memory snapshot of the active
  entries, so policy checks stay synchronous and instant. It refreshes every
  ``BLOCKLIST_REFRESH_SECONDS`` and at once when another process publishes on
  ``vn:blocklist`` (Redis). If a refresh fails, the last good snapshot stays in
  force; startup fails if none can be loaded (never fail open).
- :class:`PostgresTakedownStore`: a takedown request and its provisional URL blocks
  are written in one transaction (docs/03 2.9: auto-apply provisionally).
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import Iterable
from importlib import resources
from typing import Any

from psycopg import AsyncConnection
from psycopg.types.json import Jsonb
from psycopg_pool import AsyncConnectionPool

from app.policy import InMemoryBlocklist, canonicalize_url
from app.takedown import TakedownRequest

log = logging.getLogger(__name__)

BLOCKLIST_CHANNEL = "vn:blocklist"
_MIGRATION_LOCK = 0x766E_6462  # "vndb"; any constant shared by all processes


class Database:
    def __init__(self, url: str, *, min_size: int = 1, max_size: int = 5) -> None:
        self.pool = AsyncConnectionPool(url, min_size=min_size, max_size=max_size, open=False,
                                        kwargs={"autocommit": True})

    async def start(self) -> None:
        await self.pool.open(wait=True, timeout=15)
        await self.migrate()

    async def stop(self) -> None:
        await self.pool.close()

    async def migrate(self) -> list[str]:
        """Apply pending migrations; returns the versions applied now."""
        files = sorted(
            (f.name, f.read_text(encoding="utf-8"))
            for f in resources.files("app.migrations").iterdir() if f.name.endswith(".sql")
        )
        applied: list[str] = []
        async with self.pool.connection() as conn:
            await conn.execute("SELECT pg_advisory_lock(%s)", (_MIGRATION_LOCK,))
            try:
                await conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations ("
                                   "version text PRIMARY KEY, "
                                   "applied_at timestamptz NOT NULL DEFAULT now())")
                cur = await conn.execute("SELECT version FROM schema_migrations")
                done = {r[0] for r in await cur.fetchall()}
                for name, sql in files:
                    if name in done:
                        continue
                    async with conn.transaction():
                        await conn.execute(sql)
                        await conn.execute(
                            "INSERT INTO schema_migrations (version) VALUES (%s)", (name,))
                    applied.append(name)
                    log.info("migration applied version=%s", name)
            finally:
                await conn.execute("SELECT pg_advisory_unlock(%s)", (_MIGRATION_LOCK,))
        return applied


# ---------------------------------------------------------------------- blocklist


class PostgresBlocklist:
    def __init__(self, db: Database, *, refresh_seconds: float = 30.0,
                 redis: Any | None = None) -> None:
        self.db = db
        self.refresh_seconds = refresh_seconds
        self.redis = redis  # RedisConnection or None
        self._data = InMemoryBlocklist()
        self._tasks: list[asyncio.Task[None]] = []

    async def start(self) -> None:
        await self.refresh()  # raises if the DB is unreachable: never start fail-open
        self._tasks.append(asyncio.create_task(self._poll()))
        if self.redis is not None:
            self._tasks.append(asyncio.create_task(self._listen()))

    async def stop(self) -> None:
        for t in self._tasks:
            t.cancel()
        for t in self._tasks:
            with contextlib.suppress(asyncio.CancelledError, Exception):
                await t
        self._tasks.clear()

    async def refresh(self) -> None:
        async with self.db.pool.connection() as conn:
            cur = await conn.execute(
                "SELECT kind::text, site, value FROM blocklist_entries WHERE active")
            rows = await cur.fetchall()
        fresh = InMemoryBlocklist()
        for kind, site, value in rows:
            if kind == "canonical_url":
                fresh.add_url(value)
            elif kind == "site_media_id":
                fresh.add_item(site, value)
            else:
                fresh.add_domain(value)
        self._data = fresh  # atomic swap; readers never see a half-built set

    async def changed(self) -> None:
        """After a write: refresh here and tell every other process."""
        await self.refresh()
        if self.redis is not None:
            with contextlib.suppress(Exception):  # the 30 s poll is the fallback
                await self.redis.pool.publish(BLOCKLIST_CHANNEL, "changed")

    async def _poll(self) -> None:
        while True:
            await asyncio.sleep(self.refresh_seconds)
            try:
                await self.refresh()
            except Exception:
                log.exception("blocklist refresh failed; keeping the previous snapshot")

    async def _listen(self) -> None:
        while True:
            try:
                pubsub = self.redis.pool.pubsub()
                await pubsub.subscribe(BLOCKLIST_CHANNEL)
                async for msg in pubsub.listen():
                    if msg.get("type") == "message":
                        await self.refresh()
            except asyncio.CancelledError:
                raise
            except Exception:
                log.warning("blocklist subscription lost; retrying in 5 s")
                await asyncio.sleep(5)

    # Synchronous lookups for Policy (the Blocklist protocol).
    def is_url_blocked(self, canonical_url: str) -> bool:
        return self._data.is_url_blocked(canonical_url)

    def is_item_blocked(self, site: str, item_id: str) -> bool:
        return self._data.is_item_blocked(site, item_id)

    def is_domain_excluded(self, host: str) -> bool:
        return self._data.is_domain_excluded(host)

    def add_urls(self, urls: Iterable[str]) -> None:
        raise NotImplementedError("write through PostgresTakedownStore or app.admin")


_UPSERT_ENTRY = """
INSERT INTO blocklist_entries (kind, site, value, takedown_id, reason, created_by)
VALUES (%s, %s, %s, %s, %s, %s)
ON CONFLICT ON CONSTRAINT blocklist_entries_unique DO UPDATE SET
    takedown_id = CASE WHEN blocklist_entries.active THEN blocklist_entries.takedown_id
                       ELSE EXCLUDED.takedown_id END,
    reason = CASE WHEN blocklist_entries.active THEN blocklist_entries.reason
                  ELSE EXCLUDED.reason END,
    active = true, revoked_at = NULL, revoked_by = NULL
"""


async def upsert_entry(conn: AsyncConnection, kind: str, value: str, *, site: str | None = None,
                       takedown_id: Any = None, reason: str, created_by: str) -> None:
    if kind == "canonical_url":
        value = canonicalize_url(value)
    elif kind == "domain":
        value = value.strip().lower().rstrip(".")
    elif kind == "site_media_id":
        site = (site or "").strip().lower()
        if not site:
            raise ValueError("site_media_id entries need a site (yt-dlp extractor key)")
    else:
        raise ValueError(f"unknown kind {kind!r}")
    await conn.execute(_UPSERT_ENTRY, (kind, site if kind == "site_media_id" else None, value,
                                       takedown_id, reason, created_by))


# ---------------------------------------------------------------------- takedowns


class PostgresTakedownStore:
    def __init__(self, db: Database, blocklist: PostgresBlocklist) -> None:
        self.db = db
        self.blocklist = blocklist

    async def save(self, req: TakedownRequest) -> str:
        async with self.db.pool.connection() as conn, conn.transaction():
            cur = await conn.execute(
                "INSERT INTO takedown_requests (name, email, organisation, urls, "
                "statement_good_faith, statement_accuracy, signature) "
                "VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                (req.name, req.email, req.organisation, Jsonb(req.urls),
                 req.statement_good_faith, req.statement_accuracy, req.signature))
            row = await cur.fetchone()
            takedown_id = row[0] if row else None
            for url in req.urls:  # provisional blocks (docs/03 2.9, 7.2 A step 2)
                await upsert_entry(conn, "canonical_url", url, takedown_id=takedown_id,
                                   reason="dmca", created_by="takedown-form")
        await self.blocklist.changed()
        return str(takedown_id)


async def purge_expired_takedowns(db: Database, retention_days: int) -> int:
    """Delete takedown requests (personal data) past retention. Blocks stay in force."""
    async with db.pool.connection() as conn:
        cur = await conn.execute(
            "DELETE FROM takedown_requests WHERE received_at < now() - make_interval(days => %s)",
            (retention_days,))
        removed = cur.rowcount or 0
    if removed:
        log.info("purged %d takedown requests past retention", removed)
    return removed
