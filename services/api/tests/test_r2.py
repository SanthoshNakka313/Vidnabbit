"""R2 storage against moto's in-memory S3 (no network): keys, headers, presign, sweeping."""

from __future__ import annotations

import re
from collections.abc import Iterator
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

import boto3
import pytest
from botocore.config import Config
from moto import mock_aws

from app.config import Settings
from app.main import build_services
from app.storage import R2Storage, _key_expiry

BUCKET = "vidnabbit-test"
T0 = 1792886400.0  # 2026-10-25 00:00:00 UTC


class Clock:
    def __init__(self) -> None:
        self.t = T0

    def __call__(self) -> float:
        return self.t


@pytest.fixture
def s3() -> Iterator:
    with mock_aws():
        client = boto3.client("s3", region_name="us-east-1", aws_access_key_id="test",
                              aws_secret_access_key="test",
                              config=Config(signature_version="s3v4"))  # as from_settings
        client.create_bucket(Bucket=BUCKET)
        yield client


@pytest.fixture
def clock() -> Clock:
    return Clock()


@pytest.fixture
def r2(s3, clock) -> R2Storage:
    return R2Storage(bucket=BUCKET, client=s3, clock=clock, part_size=5 * 1024**2)


def media(tmp_path: Path, size: int = 1024, ext: str = ".mp4") -> Path:
    p = tmp_path / f"job{ext}"
    p.write_bytes(b"\x01" * size)
    return p


def keys(s3) -> list[str]:
    return [o["Key"] for o in s3.list_objects_v2(Bucket=BUCKET).get("Contents", [])]


def test_put_uploads_with_safe_headers(r2, s3, tmp_path) -> None:
    src = media(tmp_path)
    stored = r2.put("a" * 32, src, 'Café "1".mp4', ttl_seconds=3600)
    assert re.fullmatch(r"dl/2026102500/a{32}/1792890000-[\w-]{16}\.mp4", stored.key)
    assert stored.size == 1024 and stored.expires_at == int(T0) + 3600
    assert not src.exists()  # the local copy is consumed
    head = s3.head_object(Bucket=BUCKET, Key=stored.key)
    assert head["ContentType"] == "video/mp4"
    assert head["ContentDisposition"].startswith('attachment; filename="Caf 1.mp4"')
    assert head["CacheControl"] == "private, no-store"


def test_large_files_use_multipart(r2, s3, tmp_path) -> None:
    stored = r2.put("b" * 32, media(tmp_path, size=11 * 1024**2), "big.mp4", 3600)
    etag = s3.head_object(Bucket=BUCKET, Key=stored.key)["ETag"]
    assert etag.strip('"').endswith("-3")  # 5 + 5 + 1 MB parts


def test_put_refuses_bad_job_ids(r2, tmp_path) -> None:
    with pytest.raises(ValueError):
        r2.put("../../x", media(tmp_path), "x.mp4", 3600)


def test_presigned_url_expires_with_the_file(r2, clock, tmp_path) -> None:
    stored = r2.put("c" * 32, media(tmp_path), "x.mp4", ttl_seconds=3600)
    clock.t += 600
    url = r2.download_url(stored)
    q = parse_qs(urlsplit(url).query)
    assert q["X-Amz-Expires"] == ["3000"]  # remaining lifetime, not a fresh hour
    assert q["X-Amz-Algorithm"] == ["AWS4-HMAC-SHA256"]
    assert stored.key in urlsplit(url).path


def test_sweep_deletes_only_expired_objects_under_dl(r2, s3, clock, tmp_path) -> None:
    old = r2.put("d" * 32, media(tmp_path), "old.mp4", ttl_seconds=600)
    fresh = r2.put("e" * 32, media(tmp_path), "fresh.mp4", ttl_seconds=3600)
    s3.put_object(Bucket=BUCKET, Key="backups/db.dump", Body=b"x")
    s3.put_object(Bucket=BUCKET, Key="dl/junk-from-old-version", Body=b"x")

    clock.t += 601
    assert r2.delete_expired() == 2  # "old" and the unrecognised dl/ key
    assert set(keys(s3)) == {fresh.key, "backups/db.dump"}
    assert old.key not in keys(s3)


def test_sweeps_are_throttled_and_later_ones_list_recent_hours(r2, s3, clock, tmp_path) -> None:
    assert r2.delete_expired() == 0  # first sweep: full dl/ listing
    r2.put("f" * 32, media(tmp_path), "x.mp4", ttl_seconds=3600)  # uploaded in hour 00
    clock.t += 3600  # hour 01; the recent-hours window still covers hour 00
    assert r2.delete_expired() == 1 and keys(s3) == []
    kept = r2.put("g" * 32, media(tmp_path), "y.mp4", ttl_seconds=60)
    clock.t += 120
    assert r2.delete_expired() == 0  # throttled: the last sweep ran 120 s ago
    assert keys(s3) == [kept.key]


def test_delete_ignores_keys_outside_dl(r2, s3) -> None:
    s3.put_object(Bucket=BUCKET, Key="backups/db.dump", Body=b"x")
    r2.delete("backups/db.dump")
    assert keys(s3) == ["backups/db.dump"]


@pytest.mark.parametrize(("key", "expiry"), [
    ("dl/2026102500/" + "a" * 32 + "/1792890000-abcDEF_-12.mp4", 1792890000),
    ("dl/2026102500/x/1792890000-abc", 1792890000),
    ("dl/oops", None), ("dl/2026102500/x/notanumber-abc.mp4", None),
])
def test_key_expiry(key: str, expiry: int | None) -> None:
    assert _key_expiry(key) == expiry


def test_build_services_uses_r2_when_configured(tmp_path) -> None:
    settings = Settings(app_env="test", data_dir=tmp_path, storage_backend="r2",
                        r2_bucket=BUCKET, r2_access_key_id="k", r2_secret_access_key="s",
                        r2_account_id="acct", _env_file=None)
    storage = build_services(settings).storage
    assert isinstance(storage, R2Storage)
    assert storage.client.meta.endpoint_url == "https://acct.r2.cloudflarestorage.com"


def test_r2_settings_are_required() -> None:
    with pytest.raises(ValueError, match=r"R2_BUCKET.*R2_ACCOUNT_ID"):
        Settings(storage_backend="r2", r2_access_key_id="k", r2_secret_access_key="s",
                 _env_file=None)
    Settings(storage_backend="r2", r2_bucket="b", r2_access_key_id="k",
             r2_secret_access_key="s", r2_endpoint_url="http://127.0.0.1:9000", _env_file=None)


def test_sweep_after_restart_lists_everything(s3, clock, tmp_path) -> None:
    first = R2Storage(bucket=BUCKET, client=s3, clock=clock)
    stale = first.put("h" * 32, media(tmp_path), "x.mp4", ttl_seconds=60)
    clock.t += 10 * 3600  # far older than the recent-hours window
    restarted = R2Storage(bucket=BUCKET, client=s3, clock=clock)
    assert restarted.delete_expired() == 1
    assert stale.key not in keys(s3)


def test_job_flow_with_r2(s3, settings, monkeypatch) -> None:
    from fastapi.testclient import TestClient

    from app import main as main_mod
    from app.main import create_app
    from app.ssrf import validate_url

    from .conftest import DUMMY, FakeExtractor
    from .test_api import wait_job

    async def public(raw: str, timeout: float = 3.0, **_: object):
        return validate_url(raw, resolver=lambda h, p: ["93.184.215.14"])

    monkeypatch.setattr(main_mod, "avalidate_url", public)
    storage = R2Storage(bucket=BUCKET, client=s3)
    with TestClient(create_app(settings, extractor=FakeExtractor(), storage=storage)) as c:
        ex = c.post("/v1/extract", json={"url": "https://www.youtube.com/watch?v=abc123"})
        r = c.post("/v1/jobs", json={"extract_id": ex.json()["id"], "format_id": "m4a",
                                     "turnstile_token": DUMMY})
        job = wait_job(c, r.json()["job_id"])
        assert job["status"] == "done", job
        assert "X-Amz-Signature=" in job["download_url"]
        assert c.get("/v1/files/anything").status_code == 404  # local route is off with R2
    (key,) = keys(s3)
    assert key.endswith(".m4a")
    assert s3.head_object(Bucket=BUCKET, Key=key)["ContentType"] == "audio/mp4"
