"""File storage for finished downloads, plus HMAC-signed download tokens.

Files are never hosted long-term: every stored file expires after at most one
hour and is deleted by the janitor (local) or a bucket lifecycle rule (R2).
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import shutil
import time
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

log = logging.getLogger(__name__)

TOKEN_VERSION = 1


# ------------------------------------------------------------------- tokens


class TokenError(ValueError):
    pass


def _b64e(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64d(data: str) -> bytes:
    return base64.urlsafe_b64decode(data + "=" * (-len(data) % 4))


def sign_token(key: bytes, file_key: str, expires_at: int) -> str:
    payload = _b64e(
        json.dumps({"v": TOKEN_VERSION, "k": file_key, "e": int(expires_at)},
                   separators=(",", ":")).encode()
    )
    sig = _b64e(hmac.new(key, payload.encode("ascii"), hashlib.sha256).digest())
    return f"{payload}.{sig}"


def verify_token(key: bytes, token: str, now: float | None = None) -> str:
    """Return the file key if the token is authentic and unexpired."""
    if not token or len(token) > 1024 or token.count(".") != 1:
        raise TokenError("malformed token")
    payload, sig = token.split(".")
    expected = _b64e(hmac.new(key, payload.encode("ascii", "ignore"), hashlib.sha256).digest())
    if not hmac.compare_digest(sig, expected):
        raise TokenError("bad signature")
    try:
        data = json.loads(_b64d(payload))
        file_key, exp = str(data["k"]), int(data["e"])
        if data.get("v") != TOKEN_VERSION:
            raise TokenError("unsupported token version")
    except (ValueError, KeyError, TypeError) as e:
        raise TokenError("malformed token") from e
    if (now if now is not None else time.time()) >= exp:
        raise TokenError("expired")
    return file_key


# --------------------------------------------------------------- filenames

# Control chars, path/shell-special chars, bidi overrides and zero-width chars.
_UNSAFE = re.compile(
    r'[\x00-\x1f\x7f/\\:*?"<>|\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]+'
)
_WS = re.compile(r"\s+")


def sanitize_filename(title: str, ext: str, max_len: int = 120) -> str:
    """User-facing download filename: readable, no path or shell-special chars."""
    name = unicodedata.normalize("NFKC", title or "")
    name = _UNSAFE.sub(" ", name)
    name = _WS.sub(" ", name).strip(" .-_")
    if not name:
        name = "download"
    name = name[:max_len].rstrip(" .")
    ext = re.sub(r"[^a-z0-9]", "", (ext or "").lower())[:8] or "bin"
    return f"{name}.{ext}"


def content_disposition(filename: str) -> str:
    ascii_name = filename.encode("ascii", "ignore").decode("ascii").replace('"', "") or "download"
    return f"attachment; filename=\"{ascii_name}\"; filename*=UTF-8''{quote(filename)}"


# ------------------------------------------------------------------ storage


@dataclass(frozen=True)
class StoredFile:
    key: str  # backend-specific object key
    filename: str  # user-facing filename
    size: int
    expires_at: int  # unix seconds


class Storage(Protocol):
    def put(self, job_id: str, local_path: Path, filename: str, ttl_seconds: int) -> StoredFile:
        """Move a finished file into storage. ``local_path`` may be consumed."""

    def download_url(self, stored: StoredFile) -> str:
        """A short-lived URL the browser can download from."""

    def delete_expired(self, now: float | None = None) -> int:
        """Delete expired files; return how many were removed."""

    def delete(self, key: str) -> None: ...


class LocalStorage:
    """Local disk + a signed ``GET /v1/files/{token}`` route (dev only)."""

    def __init__(self, root: Path, signing_key: bytes, public_base_url: str) -> None:
        self.root = root.resolve()
        self.root.mkdir(parents=True, exist_ok=True)
        self.signing_key = signing_key
        self.public_base_url = public_base_url.rstrip("/")

    def _job_dir(self, job_id: str) -> Path:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", job_id):
            raise ValueError("invalid job id")
        return self.root / job_id

    def put(self, job_id: str, local_path: Path, filename: str, ttl_seconds: int) -> StoredFile:
        job_dir = self._job_dir(job_id)
        job_dir.mkdir(parents=True, exist_ok=True)
        dest = job_dir / f"{secrets.token_urlsafe(12)}{local_path.suffix.lower()}"
        shutil.move(str(local_path), dest)
        expires_at = int(time.time()) + ttl_seconds
        meta = {"filename": filename, "expires_at": expires_at}
        (job_dir / "meta.json").write_text(json.dumps(meta), encoding="utf-8")
        return StoredFile(
            key=f"{job_id}/{dest.name}", filename=filename, size=dest.stat().st_size,
            expires_at=expires_at,
        )

    def download_url(self, stored: StoredFile) -> str:
        token = sign_token(self.signing_key, stored.key, stored.expires_at)
        return f"{self.public_base_url}/v1/files/{token}"

    def resolve(self, file_key: str) -> tuple[Path, str] | None:
        """Map a verified token key to (path, filename); None if gone or unsafe."""
        path = (self.root / file_key).resolve()
        if not path.is_relative_to(self.root) or path.parent.parent != self.root:
            return None
        if not path.is_file():
            return None
        try:
            meta = json.loads((path.parent / "meta.json").read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return None
        if time.time() >= int(meta.get("expires_at", 0)):
            return None
        return path, str(meta.get("filename") or path.name)

    def delete(self, key: str) -> None:
        job_dir = (self.root / key).resolve().parent
        if job_dir.parent == self.root:
            shutil.rmtree(job_dir, ignore_errors=True)

    def delete_expired(self, now: float | None = None) -> int:
        now = now if now is not None else time.time()
        removed = 0
        for job_dir in self.root.iterdir():
            if not job_dir.is_dir():
                continue
            meta_path = job_dir / "meta.json"
            try:
                exp = int(json.loads(meta_path.read_text(encoding="utf-8"))["expires_at"])
            except (OSError, ValueError, KeyError):
                # Orphan (crash mid-write): remove once older than the max TTL.
                exp = int(job_dir.stat().st_mtime) + 3600
            if now >= exp:
                shutil.rmtree(job_dir, ignore_errors=True)
                removed += 1
        return removed


class R2Storage:  # pragma: no cover - stub
    """Cloudflare R2 backend (S3-compatible). Not implemented in the first slice.

    Intended implementation: upload with boto3/aioboto3 to ``{bucket}/{job_id}/{file}``
    with ``ContentDisposition`` set, return a presigned GET URL valid for <= 1 hour,
    and rely on a bucket lifecycle rule (expire after 1 day, the minimum R2 lifecycle
    granularity, plus an hourly sweeper that deletes objects older than 1 hour).
    """

    def __init__(self, *args: object, **kwargs: object) -> None:
        raise NotImplementedError("R2 storage is not implemented yet; use storage_backend=local")

    def put(self, job_id: str, local_path: Path, filename: str, ttl_seconds: int) -> StoredFile:
        raise NotImplementedError

    def download_url(self, stored: StoredFile) -> str:
        raise NotImplementedError

    def delete_expired(self, now: float | None = None) -> int:
        raise NotImplementedError

    def delete(self, key: str) -> None:
        raise NotImplementedError
