"""Operator CLI for takedowns and the blocklist (docs/02 section 3.3). Run on the host:

    python -m app.admin takedowns [--open]
    python -m app.admin show <takedown_id>
    python -m app.admin decide <takedown_id> actioned|rejected|withdrawn|under_review [--notes ..]
    python -m app.admin block url <url> | item <site> <media_id> | domain <domain> [--takedown ID]
    python -m app.admin unblock url|item|domain ...
    python -m app.admin blocklist
    python -m app.admin purge

Needs DATABASE_URL. Domain exclusions are only added here, after the owner has
proved control of the domain (docs/03 2.9). Changes reach every API instance and
worker at once through Redis, or within BLOCKLIST_REFRESH_SECONDS without it.
"""

from __future__ import annotations

import argparse
import asyncio
import getpass
import json
import sys
from typing import Any

from app.config import get_settings
from app.pg import BLOCKLIST_CHANNEL, Database, purge_expired_takedowns, upsert_entry
from app.policy import canonicalize_url

_KINDS = {"url": "canonical_url", "item": "site_media_id", "domain": "domain"}


def _parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="python -m app.admin")
    sub = p.add_subparsers(dest="cmd", required=True)
    t = sub.add_parser("takedowns", help="list takedown requests")
    t.add_argument("--open", action="store_true", help="only received / under_review")
    sub.add_parser("show").add_argument("takedown_id")
    d = sub.add_parser("decide")
    d.add_argument("takedown_id")
    d.add_argument("status", choices=["under_review", "actioned", "rejected", "withdrawn"])
    d.add_argument("--notes")
    d.add_argument("--keep-blocks", action="store_true",
                   help="on rejected/withdrawn, keep the provisional URL blocks")
    for name in ("block", "unblock"):
        b = sub.add_parser(name)
        b.add_argument("kind", choices=list(_KINDS))
        b.add_argument("value", nargs="+", help="url | site media_id | domain")
        if name == "block":
            b.add_argument("--takedown")
            b.add_argument("--reason", choices=["dmca", "domain_exclusion", "operator"])
    sub.add_parser("blocklist", help="list active entries")
    sub.add_parser("purge", help="delete takedown requests past retention")
    return p


def _split(kind: str, values: list[str]) -> tuple[str | None, str]:
    if kind == "item":
        if len(values) != 2:
            raise SystemExit("item needs: <site> <media_id>")
        return values[0].lower(), values[1]
    if len(values) != 1:
        raise SystemExit(f"{kind} takes one value")
    return None, values[0]


async def _notify(redis_url: str | None) -> None:
    if not redis_url:
        return
    from redis.asyncio import Redis

    try:
        r = Redis.from_url(redis_url)
        await r.publish(BLOCKLIST_CHANNEL, "changed")
        await r.aclose()
    except Exception:
        print("note: Redis unreachable; instances pick this up on their next refresh",
              file=sys.stderr)


async def run(argv: list[str]) -> int:
    args = _parser().parse_args(argv)
    settings = get_settings()
    if settings.database_url is None:
        raise SystemExit("DATABASE_URL is not set")
    db = Database(settings.database_url.get_secret_value(), max_size=1)
    await db.start()
    who = f"admin:{getpass.getuser()}"
    changed = False
    try:
        if args.cmd == "purge":  # uses its own connection from the pool
            n = await purge_expired_takedowns(db, settings.takedown_retention_days)
            print(f"purged {n}")
            return 0
        async with db.pool.connection() as conn:
            if args.cmd == "takedowns":
                cur = await conn.execute(
                    "SELECT id, received_at, status, jsonb_array_length(urls) "
                    "FROM takedown_requests "
                    "WHERE NOT %s OR status IN ('received', 'under_review') "
                    "ORDER BY received_at DESC LIMIT 200", (args.open,))
                for row in await cur.fetchall():
                    print(f"{row[0]}  {row[1]:%Y-%m-%d %H:%M}  {row[2]:<12} urls={row[3]}")
            elif args.cmd == "show":
                cur = await conn.execute(
                    "SELECT row_to_json(t) FROM takedown_requests t WHERE id = %s",
                    (args.takedown_id,))
                row = await cur.fetchone()
                if row is None:
                    raise SystemExit("not found")
                print(json.dumps(row[0], indent=2, default=str))
            elif args.cmd == "decide":
                async with conn.transaction():
                    cur = await conn.execute(
                        "UPDATE takedown_requests SET status = %s, "
                        "reviewer_notes = COALESCE(%s, reviewer_notes), decided_at = now() "
                        "WHERE id = %s", (args.status, args.notes, args.takedown_id))
                    if cur.rowcount != 1:
                        raise SystemExit("not found")
                    if args.status in ("rejected", "withdrawn") and not args.keep_blocks:
                        await conn.execute(
                            "UPDATE blocklist_entries SET active = false, revoked_at = now(), "
                            "revoked_by = %s WHERE takedown_id = %s AND active",
                            (who, args.takedown_id))
                        changed = True
                print("ok")
            elif args.cmd == "block":
                site, value = _split(args.kind, args.value)
                reason = args.reason or ("domain_exclusion" if args.kind == "domain"
                                         else "dmca" if args.takedown else "operator")
                await upsert_entry(conn, _KINDS[args.kind], value, site=site,
                                   takedown_id=args.takedown, reason=reason, created_by=who)
                changed = True
                print("blocked")
            elif args.cmd == "unblock":
                site, value = _split(args.kind, args.value)
                if args.kind == "url":
                    value = canonicalize_url(value)
                elif args.kind == "domain":
                    value = value.strip().lower().rstrip(".")
                cur = await conn.execute(
                    "UPDATE blocklist_entries SET active = false, revoked_at = now(), "
                    "revoked_by = %s WHERE kind = %s AND site IS NOT DISTINCT FROM %s "
                    "AND value = %s AND active", (who, _KINDS[args.kind], site, value))
                changed = bool(cur.rowcount)
                print("unblocked" if changed else "no active entry")
            elif args.cmd == "blocklist":
                cur = await conn.execute(
                    "SELECT kind::text, site, value, reason, created_at FROM blocklist_entries "
                    "WHERE active ORDER BY created_at DESC")
                for kind, site, value, reason, created in await cur.fetchall():
                    label = f"{site}:{value}" if site else value
                    print(f"{created:%Y-%m-%d}  {kind:<13} {reason:<16} {label}")
    finally:
        await db.stop()
    if changed:
        await _notify(settings.redis_url if settings.queue_backend == "redis" else None)
    return 0


def main(argv: list[str] | None = None) -> Any:
    return asyncio.run(run(sys.argv[1:] if argv is None else argv))


if __name__ == "__main__":
    sys.exit(main())
