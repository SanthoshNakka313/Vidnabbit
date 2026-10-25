"""Presets, slim info, format safety and yt-dlp error mapping (no network)."""

from __future__ import annotations

from typing import Any

import pytest
from yt_dlp.utils import DownloadError, ExtractorError, GeoRestrictedError, UnsupportedError

from app.errors import ApiError
from app.extractor import FormatSelector, result_from_info
from app.policy import InMemoryBlocklist, Limits, Policy
from app.ssrf import SSRFBlockedConnection
from app.ytdlp_core import (
    build_ydl_opts,
    clean_text,
    is_safe_format,
    map_ytdlp_error,
    slim_info,
)

from .conftest import yt_like_info

URL = "https://www.youtube.com/watch?v=abc123"


@pytest.fixture(scope="module")
def selector() -> FormatSelector:
    return FormatSelector()


def build(info: dict[str, Any], selector: FormatSelector, policy: Policy | None = None):
    return result_from_info(info, URL, policy or Policy(InMemoryBlocklist()), selector)


def test_video_presets(selector) -> None:
    r = build(yt_like_info(), selector)
    by_id = {p.format_id: p for p in r.presets}
    assert list(by_id) == ["best", "mp4-1080p", "mp4-720p", "mp4-480p", "mp3-192", "m4a"]
    assert by_id["mp4-1080p"].spec.startswith("137+140/")  # H.264 preferred at a fixed height
    assert by_id["mp4-720p"].public["label"] == "720p · MP4"
    assert by_id["mp4-720p"].public["filesize_bytes"] == 55_000_000 + 3_400_000
    assert by_id["mp3-192"].mode == "audio_mp3" and by_id["mp3-192"].ext == "mp3"
    assert by_id["m4a"].spec.startswith("140/")
    assert r.media_type == "video" and r.title == "A CC video"


def test_heights_above_source_are_not_offered(selector) -> None:
    info = yt_like_info()
    info["formats"] = [f for f in info["formats"] if (f.get("height") or 0) <= 480]
    ids = [p.format_id for p in build(info, selector).presets]
    assert "mp4-1080p" not in ids and "mp4-720p" not in ids


def test_oversized_presets_are_dropped(selector) -> None:
    policy = Policy(InMemoryBlocklist(), Limits(max_filesize_bytes=60_000_000))
    ids = [p.format_id for p in build(yt_like_info(), selector, policy).presets]
    assert "best" not in ids and "mp4-1080p" not in ids and "mp4-720p" in ids


def test_unsafe_formats_are_excluded(selector) -> None:
    info = yt_like_info()
    for f in info["formats"]:
        if f["format_id"] in ("248", "137"):
            f["has_drm"] = True
    by_id = {p.format_id: p for p in build(info, selector).presets}
    assert "248" not in by_id["best"].spec.split("/")[0]
    assert "137" not in by_id["best"].spec.split("/")[0]


def test_audio_only_source(selector) -> None:
    info = yt_like_info(extractor_key="Soundcloud")
    info["formats"] = [f for f in info["formats"] if f["vcodec"] == "none"]
    r = build(info, selector)
    assert r.media_type == "audio" and r.source_site == "SoundCloud"
    assert [p.format_id for p in r.presets] == ["mp3-192", "m4a"]


def test_image_source(selector) -> None:
    info = {"id": "img", "extractor_key": "Generic", "title": "Photo",
            "webpage_url": "https://example.com/p.jpg",
            "formats": [{"format_id": "0", "ext": "jpg", "width": 4000, "height": 3000,
                         "url_ok": True}]}
    r = build(info, selector)
    assert r.media_type == "image" and r.source_site == "example.com"
    assert [(p.format_id, p.mode, p.public["width"]) for p in r.presets] == \
        [("image", "image", 4000)]


def test_gallery_items_are_prefixed(selector) -> None:
    entry = yt_like_info()
    info = {"_type": "playlist", "id": "g", "extractor_key": "Instagram", "title": "Post",
            "webpage_url": "https://www.instagram.com/p/x/", "entries": [entry, entry]}
    r = build(info, selector)
    assert r.media_type == "gallery"
    assert [p.format_id for p in r.presets] == ["item1-best", "item2-best"]
    assert r.presets[1].playlist_index == 2 and r.presets[1].public["label"].startswith("Item 2")


def test_flat_playlist_is_refused(selector) -> None:
    info = {"_type": "playlist", "id": "pl", "webpage_url": URL,
            "entries": [{"_type": "url", "url": "https://www.youtube.com/watch?v=x"}]}
    with pytest.raises(ApiError) as ei:
        build(info, selector)
    assert ei.value.code == "unsupported_site"


def test_no_formats_maps_to_unsupported(selector) -> None:
    with pytest.raises(ApiError) as ei:
        build(yt_like_info(formats=[]), selector)
    assert ei.value.code == "unsupported_site"


def test_thumbnail_must_be_https(selector) -> None:
    assert build(yt_like_info(thumbnail="http://x.test/t.jpg"), selector).thumbnail_url is None


# --------------------------------------------------------------- format safety


@pytest.mark.parametrize(("over", "safe"), [
    ({}, True), ({"has_drm": "maybe"}, False), ({"protocol": "rtmp"}, False),
    ({"protocol": "m3u8_native+https"}, True), ({"protocol": "f4m"}, False),
    ({"ext": "exe"}, False), ({"n_fragments": 50_000}, False), ({"url_ok": False}, False),
])
def test_is_safe_format(over, safe) -> None:
    f = {"format_id": "1", "ext": "mp4", "protocol": "https", "url_ok": True, **over}
    assert is_safe_format(f) is safe


def test_is_safe_format_checks_raw_urls() -> None:
    assert not is_safe_format({"ext": "mp4", "url": "http://10.0.0.1/v.mp4"})
    assert is_safe_format({"ext": "mp4", "url": "https://cdn.example.com/v.mp4"})


def test_slim_info_never_leaks_media_urls() -> None:
    raw = {"id": "1", "title": "T\u202eitle\x00", "webpage_url": URL, "duration": 5,
           "thumbnail": "https://i.example.com/t.jpg", "http_headers": {"Cookie": "x"},
           "formats": [{"format_id": "a", "ext": "mp4", "url": "https://cdn.example.com/v.mp4",
                        "fragments": [{"url": "http://127.0.0.1/f1"}]}]}
    slim = slim_info(raw)
    text = repr(slim)
    assert "cdn.example.com" not in text and "Cookie" not in text and "127.0.0.1" not in text
    assert slim["title"] == "Title" and slim["formats"][0]["url_ok"] is False


def test_clean_text() -> None:
    assert clean_text("a\u200bb\u2066c\x1b", 10) == "abc"
    assert clean_text("   ", 10) is None and clean_text("x" * 20, 5) == "xxxxx"


# ------------------------------------------------------------------ options


def test_ydl_opts_never_enable_bypasses() -> None:
    opts = build_ydl_opts(logger=None)
    assert opts["allow_unplayable_formats"] is False  # Safeguard 1
    for key in ("cookiefile", "cookiesfrombrowser", "username", "password", "videopassword",
                "netrc_cmd", "ap_username", "ap_password", "client_certificate"):
        assert opts[key] is None, key
    assert opts["usenetrc"] is False and opts["ignoreconfig"] is True
    assert opts["enable_file_urls"] is False and opts["nocheckcertificate"] is False
    assert opts["external_downloader"] == {"default": "native"}
    assert opts["proxy"] == ""  # env proxies off: the SSRF guard sees real destinations


# ------------------------------------------------------------- error mapping


@pytest.mark.parametrize(("exc", "code"), [
    (DownloadError("ERROR: [youtube] x: Private video. Sign in if you've been granted access"),
     "private_content"),
    (DownloadError("ERROR: Sign in to confirm your age"), "login_required"),
    (DownloadError("ERROR: This video is only available to Music Premium members"),
     "login_required"),
    (DownloadError("ERROR: [Netflix] This video is DRM protected"), "drm_protected"),
    (UnsupportedError("https://example.com/"), "unsupported_site"),
    (DownloadError("ERROR: Video unavailable"), "upstream_error"),
    (GeoRestrictedError("not available in your country"), "upstream_error"),
    (ExtractorError("HTTP Error 404: Not Found"), "upstream_error"),
    (DownloadError("File is larger than max-filesize"), "too_large"),
    (SSRFBlockedConnection("vidnabbit-ssrf-blocked: refused connection"), "invalid_url"),
    (RuntimeError("weird"), "internal"),
])
def test_map_ytdlp_error(exc: BaseException, code: str) -> None:
    err = map_ytdlp_error(exc)
    assert err.code == code
    assert "ERROR:" not in err.message  # raw upstream text never reaches users
