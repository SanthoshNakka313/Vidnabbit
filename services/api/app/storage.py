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
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import quote

log = logging.getLogger(__name__)

TOKEN_VERSION = 1
MEDIA_TYPES = {
    "mp4": "video/mp4", "webm": "video/webm", "mkv": "video/x-matroska", "m4a": "audio/mp4",
    "mp3": "audio/mpeg", "opus": "audio/ogg", "ogg": "audio/ogg", "jpg": "image/jpeg",
    "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
}


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


class R2Storage:
    """Cloudflare R2 (S3 API). Files are served by presigned GET, never a public URL.

    Keys are ``dl/<upload yyyymmddhh>/<job_id>/<expires_at>-<random>.<ext>``, so the
    sweeper can tell expiry from a listing alone. Links stop working at expiry
    because the presigned URL expires then; the sweeper deletes objects soon after,
    and a bucket lifecycle rule on ``dl/`` (1 day, R2's finest granularity) is
    only a backstop (docs/02 2.4).
    """

    PREFIX = "dl/"
    PART_SIZE = 64 * 1024**2  # fewer Class A operations than the 8 MB default
    SWEEP_HOURS = 3  # upload-hour prefixes listed on each sweep (TTL <= 1 h)

    def __init__(self, *, bucket: str, client: Any, sweep_interval_seconds: float = 300,
                 part_size: int = PART_SIZE, clock: Callable[[], float] = time.time) -> None:
        from boto3.s3.transfer import TransferConfig

        self.bucket = bucket
        self.client = client
        self.sweep_interval_seconds = sweep_interval_seconds
        self._clock = clock
        self._last_sweep: float | None = None  # None: first sweep lists all of dl/
        self._transfer = TransferConfig(multipart_threshold=part_size,
                                        multipart_chunksize=part_size, use_threads=False)

    @classmethod
    def from_settings(cls, *, account_id: str, access_key_id: str, secret_access_key: str,
                      bucket: str, endpoint_url: str | None = None,
                      proxy_url: str | None = None) -> R2Storage:
        import boto3
        from botocore.config import Config

        config = Config(
            signature_version="s3v4",
            retries={"max_attempts": 3, "mode": "standard"},
            # R2 doesn't accept every default checksum newer boto3 sends.
            request_checksum_calculation="when_required",
            response_checksum_validation="when_required",
            proxies={"https": proxy_url} if proxy_url else None,
        )
        client = boto3.client(
            "s3", region_name="auto", config=config,
            endpoint_url=endpoint_url or f"https://{account_id}.r2.cloudflarestorage.com",
            aws_access_key_id=access_key_id, aws_secret_access_key=secret_access_key,
        )
        return cls(bucket=bucket, client=client)

    def put(self, job_id: str, local_path: Path, filename: str, ttl_seconds: int) -> StoredFile:
        if not re.fullmatch(r"[A-Za-z0-9_-]{8,64}", job_id):
            raise ValueError("invalid job id")
        now = self._clock()
        expires_at = int(now) + ttl_seconds
        hour = time.strftime("%Y%m%d%H", time.gmtime(now))
        ext = local_path.suffix.lower()
        key = f"{self.PREFIX}{hour}/{job_id}/{expires_at}-{secrets.token_urlsafe(12)}{ext}"
        size = local_path.stat().st_size
        self.client.upload_file(
            str(local_path), self.bucket, key, Config=self._transfer,
            ExtraArgs={"ContentType": MEDIA_TYPES.get(ext.lstrip("."), "application/octet-stream"),
                       "ContentDisposition": content_disposition(filename),
                       "CacheControl": "private, no-store"},
        )
        local_path.unlink(missing_ok=True)
        return StoredFile(key=key, filename=filename, size=size, expires_at=expires_at)

    def download_url(self, stored: StoredFile) -> str:
        expires_in = max(1, stored.expires_at - int(self._clock()))
        return self.client.generate_presigned_url(
            "get_object", Params={"Bucket": self.bucket, "Key": stored.key},
            ExpiresIn=expires_in)

    def delete(self, key: str) -> None:
        if key.startswith(self.PREFIX):
            self.client.delete_object(Bucket=self.bucket, Key=key)

    def delete_expired(self, now: float | None = None) -> int:
        now = now if now is not None else self._clock()
        if self._last_sweep is not None and now - self._last_sweep < self.sweep_interval_seconds:
            return 0
        if self._last_sweep is None:
            prefixes = [self.PREFIX]  # after a restart: catch anything a crash left behind
        else:
            prefixes = [self.PREFIX + time.strftime("%Y%m%d%H", time.gmtime(now - h * 3600)) + "/"
                        for h in range(self.SWEEP_HOURS)]
        self._last_sweep = now
        expired = [key for prefix in prefixes for key in self._keys(prefix)
                   if _key_expiry(key) is None or now >= _key_expiry(key)]
        for i in range(0, len(expired), 1000):  # DeleteObjects takes up to 1000 keys
            self.client.delete_objects(Bucket=self.bucket, Delete={
                "Objects": [{"Key": k} for k in expired[i:i + 1000]], "Quiet": True})
        return len(expired)

    def _keys(self, prefix: str) -> Iterator[str]:
        for page in self.client.get_paginator("list_objects_v2").paginate(
                Bucket=self.bucket, Prefix=prefix):
            for obj in page.get("Contents", []):
                yield obj["Key"]


def _key_expiry(key: str) -> int | None:
    """Expiry from ``.../<expires_at>-<random>.<ext>``; None for unrecognised keys."""
    m = re.fullmatch(r"dl/\d{10}/[A-Za-z0-9_-]+/(\d{9,11})-[A-Za-z0-9_-]+(\.[a-z0-9]+)?", key)
    return int(m.group(1)) if m else None
