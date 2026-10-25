"""Takedown (DMCA-style) requests: validation and local JSONL storage.

Submissions contain personal data (name, email, signature). They are written
to a file with 0600 permissions, never logged, and their URLs are added to the
blocklist provisionally (docs/03 2.9, 7.2 A). Domain exclusions are never
automatic. Production: Postgres, encrypted at rest (docs/02 ADR-006).
"""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import secrets
import threading
from pathlib import Path
from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field, StringConstraints, field_validator

from app.ssrf import SSRFError, normalize_url

_EMAIL = re.compile(
    r"^[^@\s]{1,64}@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9-]{1,63})+$"
)
ShortText = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


class TakedownRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    urls: list[Annotated[str, StringConstraints(max_length=2048)]] = Field(
        min_length=1, max_length=50
    )
    name: ShortText
    email: Annotated[str, StringConstraints(strip_whitespace=True, max_length=254)]
    organisation: (
        Annotated[str, StringConstraints(strip_whitespace=True, max_length=200)] | None
    ) = None
    statement_good_faith: Literal[True]
    statement_accuracy: Literal[True]
    signature: ShortText
    turnstile_token: Annotated[str, StringConstraints(max_length=2048)] | None = None

    @field_validator("name", "email", "organisation", "signature")
    @classmethod
    def _no_newlines(cls, v: str | None) -> str | None:
        if v is not None and re.search(r"[\r\n\x00]", v):
            raise ValueError("must not contain line breaks")
        return v

    @field_validator("email")
    @classmethod
    def _email(cls, v: str) -> str:
        if not _EMAIL.match(v):
            raise ValueError("invalid email address")
        return v

    @field_validator("urls")
    @classmethod
    def _urls(cls, v: list[str]) -> list[str]:
        out = []
        for u in v:
            try:
                out.append(normalize_url(u).url)
            except SSRFError as e:
                raise ValueError("each url must be a public http(s) link") from e
        return out


class TakedownStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.Lock()

    def save(self, req: TakedownRequest) -> str:
        record_id = secrets.token_urlsafe(12)
        record = {
            "id": record_id,
            "received_at": dt.datetime.now(dt.UTC).isoformat(),
            "status": "provisionally_blocked",
            **req.model_dump(exclude={"turnstile_token"}),
        }
        line = json.dumps(record, ensure_ascii=False) + "\n"
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(self.path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(line)
        return record_id
