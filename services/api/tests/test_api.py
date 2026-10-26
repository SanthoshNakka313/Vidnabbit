"""API contract tests (docs/00 v1 contract) with a fake extractor: no subprocess, no network."""

from __future__ import annotations

import os
import stat
import time
from collections.abc import Iterator
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app import main as main_mod
from app.config import Settings
from app.errors import ApiError, ErrorCode
from app.main import create_app
from app.ssrf import validate_url

from .conftest import DUMMY, FakeExtractor, yt_like_info

URL = "https://www.youtube.com/watch?v=abc123"
CONTRACT_FORMAT_KEYS = {
    "format_id", "kind", "ext", "label", "width", "height", "fps", "audio_bitrate_kbps",
    "has_audio", "has_video", "filesize_bytes", "filesize_is_estimate",
}


@pytest.fixture(autouse=True)
def public_dns(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every hostname resolves to a public address (SSRF syntax rules still apply)."""

    async def fake_avalidate(raw: str, timeout: float = 3.0, **_: object):
        return validate_url(raw, resolver=lambda h, p: ["93.184.215.14"])

    monkeypatch.setattr(main_mod, "avalidate_url", fake_avalidate)


@pytest.fixture
def fake() -> FakeExtractor:
    return FakeExtractor()


@pytest.fixture
def client(settings: Settings, fake: FakeExtractor) -> Iterator[TestClient]:
    app = create_app(settings, extractor=fake)
    fake.policy = app.state.services.policy  # share the real blocklist/kill switches
    with TestClient(app) as c:
        yield c


def extract(client: TestClient, url: str = URL, **extra: Any):
    return client.post("/v1/extract", json={"url": url, **extra})


def start_job(client: TestClient, format_id: str = "mp4-720p", token: str | None = DUMMY):
    extract_id = extract(client).json()["id"]
    body = {"extract_id": extract_id, "format_id": format_id}
    if token is not None:
        body["turnstile_token"] = token
    return client.post("/v1/jobs", json=body)


def wait_job(client: TestClient, job_id: str, timeout: float = 5.0) -> dict[str, Any]:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        body = client.get(f"/v1/jobs/{job_id}").json()
        if body["status"] in ("done", "failed"):
            return body
        time.sleep(0.02)
    raise AssertionError("job did not finish")


def assert_error(resp, status: int, code: str) -> None:
    assert resp.status_code == status, resp.text
    body = resp.json()
    assert set(body) == {"error"} and body["error"]["code"] == code
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


# --------------------------------------------------------------------- basics


def test_health_and_security_headers(client: TestClient) -> None:
    r = client.get("/v1/health")
    assert r.status_code == 200 and r.json() == {"ok": True}
    assert r.headers["x-content-type-options"] == "nosniff"
    assert r.headers["cache-control"] == "no-store"
    assert r.headers["x-frame-options"] == "DENY"


def test_unknown_route_and_method_use_error_shape(client: TestClient) -> None:
    assert_error(client.get("/nope"), 404, "not_found")
    assert_error(client.get("/v1/extract"), 405, "not_found")


def test_cors_allows_only_configured_origin(client: TestClient) -> None:
    ok = client.options("/v1/extract", headers={
        "Origin": "http://localhost:3000", "Access-Control-Request-Method": "POST"})
    assert ok.headers.get("access-control-allow-origin") == "http://localhost:3000"
    bad = client.options("/v1/extract", headers={
        "Origin": "https://evil.example", "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in bad.headers


def test_post_must_be_json(client: TestClient) -> None:
    r = client.post("/v1/extract", content=b"url=x", headers={"content-type": "text/plain"})
    assert_error(r, 415, "invalid_request")


def test_body_size_cap(client: TestClient) -> None:
    r = client.post("/v1/extract", content=b'{"url":"' + b"a" * 5000 + b'"}',
                    headers={"content-type": "application/json"})
    assert_error(r, 413, "invalid_request")


def test_extra_fields_and_missing_url(client: TestClient) -> None:
    assert_error(client.post("/v1/extract", json={}), 400, "invalid_url")
    assert_error(client.post("/v1/extract", json={"url": URL, "cookies": "x"}), 422,
                 "invalid_request")


# -------------------------------------------------------------------- extract


def test_extract_contract_shape(client: TestClient, fake: FakeExtractor) -> None:
    r = extract(client)
    assert r.status_code == 200, r.text
    body = r.json()
    assert set(body) == {"id", "source", "title", "uploader", "duration_seconds",
                         "thumbnail_url", "media_type", "formats", "expires_at"}
    assert body["source"] == {"site": "YouTube", "url": "https://youtube.com/watch?v=abc123"}
    assert body["media_type"] == "video" and body["duration_seconds"] == 213
    assert body["expires_at"].endswith("Z")
    ids = [f["format_id"] for f in body["formats"]]
    assert ids == ["best", "mp4-1080p", "mp4-720p", "mp4-480p", "mp3-192", "m4a"]
    for f in body["formats"]:
        assert set(f) == CONTRACT_FORMAT_KEYS
    # Raw selectors and media URLs never reach the client.
    assert "spec" not in r.text and "googlevideo" not in r.text
    assert fake.extract_calls == ["https://www.youtube.com/watch?v=abc123"]


@pytest.mark.parametrize("url", [
    "http://169.254.169.254/latest/meta-data/", "http://127.0.0.1:8000/v1/health",
    "file:///etc/passwd", "http://localhost/", "https://user:pw@example.com/",
])
def test_extract_refuses_ssrf_without_fetching(client, fake, url) -> None:
    assert_error(extract(client, url), 400, "invalid_url")
    assert fake.extract_calls == []


@pytest.mark.parametrize("url", [
    "https://www.netflix.com/title/80100172", "https://open.spotify.com/track/x",
    "https://www.amazon.com/gp/video/detail/B0",
])
def test_extract_refuses_drm_services_up_front(client, fake, url) -> None:
    assert_error(extract(client, url), 422, "drm_protected")
    assert fake.extract_calls == []


@pytest.mark.parametrize(("over", "status", "code"), [
    ({"live_status": "is_live"}, 422, "live_not_supported"),
    ({"availability": "private"}, 422, "private_content"),
    ({"availability": "needs_auth"}, 422, "login_required"),
    ({"duration": 4 * 3600}, 422, "too_long"),
    ({"extractor_key": "KnownDRM"}, 422, "drm_protected"),
])
def test_extract_policy_after_metadata(client, fake, over, status, code) -> None:
    fake.info = yt_like_info(**over)
    assert_error(extract(client), status, code)


def test_extract_all_drm_formats_refused(client, fake) -> None:
    info = yt_like_info()
    for f in info["formats"]:
        f["has_drm"] = "maybe"
    fake.info = info
    assert_error(extract(client), 422, "drm_protected")


def test_extract_result_is_cached(client, fake) -> None:
    assert extract(client).status_code == 200
    assert extract(client, URL + "&utm_source=x").status_code == 200  # same canonical URL
    assert len(fake.extract_calls) == 1


def test_negative_results_are_cached(client, fake) -> None:
    fake.extract_error = ApiError(ErrorCode.LOGIN_REQUIRED)
    assert_error(extract(client), 422, "login_required")
    assert_error(extract(client), 422, "login_required")
    assert len(fake.extract_calls) == 1


def test_upstream_errors_are_not_cached(client, fake) -> None:
    fake.extract_error = ApiError(ErrorCode.UPSTREAM_ERROR)
    assert_error(extract(client), 502, "upstream_error")
    fake.extract_error = None
    assert extract(client).status_code == 200
    assert len(fake.extract_calls) == 2


def test_turnstile_required_after_soft_threshold(client, settings) -> None:
    for _ in range(settings.extract_soft_threshold):
        assert extract(client).status_code == 200
    assert_error(extract(client), 403, "challenge_required")
    assert_error(extract(client, turnstile_token="wrong"), 403, "challenge_required")
    assert extract(client, turnstile_token=DUMMY).status_code == 200


def test_extract_rate_limit_has_retry_after(settings, fake) -> None:
    settings = settings.model_copy(update={"rate_extract_per_minute": 2,
                                           "extract_soft_threshold": 100})
    with TestClient(create_app(settings, extractor=fake)) as c:
        assert extract(c).status_code == 200
        assert extract(c).status_code == 200
        r = extract(c)
        assert_error(r, 429, "rate_limited")
        assert int(r.headers["retry-after"]) >= 1


def test_kill_switch(settings, fake) -> None:
    settings = settings.model_copy(update={"extraction_enabled": False})
    with TestClient(create_app(settings, extractor=fake)) as c:
        assert_error(extract(c), 502, "upstream_error")
    assert fake.extract_calls == []


# ----------------------------------------------------------------------- jobs


def test_job_flow_end_to_end(client, fake) -> None:
    r = start_job(client)
    assert r.status_code == 202, r.text
    job = wait_job(client, r.json()["job_id"])
    assert job["status"] == "done" and job["progress"] == 1.0 and job["error"] is None
    assert job["filename"] == "A CC video part 1.mp4"  # "/" and the bidi override become spaces
    assert job["expires_at"].endswith("Z")
    assert fake.download_calls == [("https://www.youtube.com/watch?v=abc123", "mp4-720p")]

    path = job["download_url"].removeprefix("http://localhost:8000")
    f = client.get(path)
    assert f.status_code == 200 and f.content == b"\x00" * 1024
    assert f.headers["content-type"] == "video/mp4"
    cd = f.headers["content-disposition"]
    assert cd.startswith('attachment; filename="A CC video part 1.mp4"')


def test_job_requires_turnstile(client) -> None:
    assert_error(start_job(client, token=None), 403, "challenge_required")


def test_job_unknown_extract_or_format(client) -> None:
    r = client.post("/v1/jobs", json={"extract_id": "nope", "format_id": "best",
                                      "turnstile_token": DUMMY})
    assert_error(r, 404, "not_found")
    assert_error(start_job(client, format_id="bv*+ba"), 400, "invalid_request")


def test_job_failure_is_reported(client, fake) -> None:
    fake.download_error = ApiError(ErrorCode.TOO_LARGE)
    job = wait_job(client, start_job(client).json()["job_id"])
    assert job["status"] == "failed" and job["download_url"] is None
    assert job["error"]["code"] == "too_large"


def test_job_blocked_after_takedown_between_extract_and_job(client, fake) -> None:
    extract_id = extract(client).json()["id"]
    assert takedown(client, [URL]).status_code == 202
    r = client.post("/v1/jobs", json={"extract_id": extract_id, "format_id": "best",
                                      "turnstile_token": DUMMY})
    assert_error(r, 451, "blocked_by_rights_holder")
    assert fake.download_calls == []


def test_active_jobs_per_client_cap(client, fake, settings) -> None:
    import asyncio

    fake.hold = asyncio.Event()  # never set: jobs stay running until shutdown
    for _ in range(settings.max_active_jobs_per_client):
        assert start_job(client).status_code == 202
    assert_error(start_job(client), 429, "rate_limited")


@pytest.mark.parametrize("job_id", ["0" * 32, "../../etc/passwd", "x"])
def test_unknown_job(client, job_id) -> None:
    assert_error(client.get(f"/v1/jobs/{job_id}"), 404, "not_found")


def test_tampered_file_token(client) -> None:
    job = wait_job(client, start_job(client).json()["job_id"])
    token = job["download_url"].rsplit("/", 1)[1]
    payload, sig = token.split(".")
    assert_error(client.get(f"/v1/files/{payload}.{sig[:-2]}AA"), 404, "not_found")
    assert_error(client.get("/v1/files/garbage"), 404, "not_found")


# ------------------------------------------------------------------- takedown


def takedown(client: TestClient, urls: list[str], **over: Any):
    body = {"urls": urls, "name": "Rights Holder", "email": "legal@example.com",
            "statement_good_faith": True, "statement_accuracy": True, "signature": "R. Holder",
            **over}
    return client.post("/v1/takedown", json=body)


def test_takedown_blocks_url_and_stores_privately(client, fake, settings) -> None:
    assert extract(client).status_code == 200  # warm the cache first
    r = takedown(client, [URL + "&utm_campaign=x"])
    assert r.status_code == 202 and r.json()["ok"] is True
    assert_error(extract(client), 451, "blocked_by_rights_holder")
    mode = stat.S_IMODE(os.stat(settings.takedown_path).st_mode)
    assert mode == 0o600
    assert "legal@example.com" in settings.takedown_path.read_text()


@pytest.mark.parametrize("over", [
    {"statement_good_faith": False}, {"email": "not-an-email"}, {"name": "a\r\nBcc: x"},
    {"signature": ""}, {"extra": 1},
])
def test_takedown_validation(client, over) -> None:
    assert_error(takedown(client, [URL], **over), 422, "invalid_request")


def test_takedown_rejects_internal_urls(client) -> None:
    assert_error(takedown(client, ["http://127.0.0.1/"]), 400, "invalid_url")
