"""Shared fixtures. Unit tests never touch the network (docs/03 section 8)."""

from __future__ import annotations

import socket
from pathlib import Path
from typing import Any

import pytest

from app.config import Settings
from app.errors import ApiError
from app.extractor import DownloadedFile, ExtractResult, FormatSelector, result_from_info
from app.policy import InMemoryBlocklist, Policy

DUMMY = "XXXX.DUMMY.TOKEN.XXXX"


def yt_like_info(**over: Any) -> dict[str, Any]:
    """A canned slim info dict shaped like a YouTube video."""
    # Ordered worst -> best, as yt-dlp sorts them before they leave the sandbox.
    fmts = [
        {"format_id": "140", "ext": "m4a", "vcodec": "none", "acodec": "mp4a.40.2", "abr": 129,
         "tbr": 129, "filesize": 3_400_000, "protocol": "https", "url_ok": True},
        {"format_id": "251", "ext": "webm", "vcodec": "none", "acodec": "opus", "abr": 140,
         "tbr": 140, "filesize": 3_600_000, "protocol": "https", "url_ok": True},
        {"format_id": "18", "ext": "mp4", "vcodec": "avc1.42001E", "acodec": "mp4a.40.2",
         "width": 640, "height": 360, "fps": 30, "tbr": 600, "filesize": 15_000_000,
         "protocol": "https", "url_ok": True},
        {"format_id": "135", "ext": "mp4", "vcodec": "avc1.4d401e", "acodec": "none",
         "width": 854, "height": 480, "fps": 30, "tbr": 1100, "filesize": 27_000_000,
         "protocol": "https", "url_ok": True},
        {"format_id": "136", "ext": "mp4", "vcodec": "avc1.4d401f", "acodec": "none",
         "width": 1280, "height": 720, "fps": 30, "tbr": 2300, "filesize": 55_000_000,
         "protocol": "https", "url_ok": True},
        {"format_id": "137", "ext": "mp4", "vcodec": "avc1.640028", "acodec": "none",
         "width": 1920, "height": 1080, "fps": 30, "tbr": 4400, "filesize": 110_000_000,
         "protocol": "https", "url_ok": True},
        {"format_id": "248", "ext": "webm", "vcodec": "vp9", "acodec": "none", "width": 1920,
         "height": 1080, "fps": 30, "tbr": 3000, "filesize": 80_000_000, "protocol": "https",
         "url_ok": True},
    ]
    info = {
        "id": "abc123", "extractor_key": "Youtube", "title": "A CC video",
        "uploader": "Someone", "duration": 213, "availability": "public",
        "live_status": "not_live", "webpage_url": "https://www.youtube.com/watch?v=abc123",
        "thumbnail": "https://i.ytimg.com/vi/abc123/hq.jpg", "formats": fmts,
    }
    info.update(over)
    return info


class FakeExtractor:
    """Stands in for the sandboxed Extractor in API tests (no subprocess, no network)."""

    def __init__(self, policy: Policy | None = None) -> None:
        self.policy = policy or Policy(InMemoryBlocklist())
        self.selector = FormatSelector()
        self.info: dict[str, Any] = yt_like_info()
        self.extract_calls: list[str] = []
        self.download_calls: list[tuple[str, str]] = []
        self.extract_error: ApiError | None = None
        self.download_error: ApiError | None = None
        self.hold = None  # optional asyncio.Event to keep downloads "running"

    async def extract(self, url: str) -> ExtractResult:
        self.extract_calls.append(url)
        if self.extract_error:
            raise self.extract_error
        return result_from_info(self.info, url, self.policy, self.selector)

    async def download(self, url, preset, workdir: Path, job_uuid: str, *, on_progress=None):
        self.download_calls.append((url, preset.format_id))
        if self.hold is not None:
            await self.hold.wait()
        if self.download_error:
            raise self.download_error
        if on_progress:
            on_progress(0.5)
        path = workdir / f"{job_uuid}.{preset.ext}"
        path.write_bytes(b"\x00" * 1024)
        return DownloadedFile(path=path, title="A CC video / part\u202e1", ext=preset.ext,
                              size=1024)


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    return Settings(app_env="test", data_dir=tmp_path / "data", allowed_extractors="*",
                    _env_file=None)


@pytest.fixture(autouse=True)
def no_network(monkeypatch: pytest.MonkeyPatch, request: pytest.FixtureRequest) -> None:
    """Fail loudly if a unit test tries to resolve a real hostname."""
    if request.node.get_closest_marker("network"):
        return

    def guard(host, *args, **kwargs):
        if host in ("localhost", "127.0.0.1", "::1", "testserver", None):
            return real(host, *args, **kwargs)
        raise AssertionError(f"unexpected DNS lookup in unit test: {host}")

    real = socket.getaddrinfo
    monkeypatch.setattr(socket, "getaddrinfo", guard)


@pytest.fixture
def anyio_backend() -> str:
    return "asyncio"
