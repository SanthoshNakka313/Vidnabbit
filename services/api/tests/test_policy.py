"""Policy: canonical URLs, DRM denylist, blocklist file, metadata checks (docs/03 section 5)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from app.config import Settings
from app.errors import ApiError, ErrorCode
from app.policy import (
    InMemoryBlocklist,
    JsonFileBlocklist,
    KillSwitches,
    Limits,
    Policy,
    canonicalize_url,
    is_drm_url,
)

from .conftest import yt_like_info


@pytest.mark.parametrize(("raw", "canonical"), [
    ("https://www.youtube.com/watch?v=abc&utm_source=x&si=1", "https://youtube.com/watch?v=abc"),
    ("http://m.example.com:80/a/?b=2&a=1#frag", "https://example.com/a?a=1&b=2"),
    ("https://Example.COM./", "https://example.com/"),
    ("https://example.com:8443/x", "https://example.com:8443/x"),
    ("https://mobile.example.com/x?fbclid=1&gclid=2&ref=3", "https://example.com/x"),
])
def test_canonicalize_url(raw: str, canonical: str) -> None:
    assert canonicalize_url(raw) == canonical


@pytest.mark.parametrize(("url", "drm"), [
    ("https://www.netflix.com/title/1", True), ("https://music.apple.com/x", True),
    ("https://www.amazon.co.uk/gp/video/detail/x", True),
    ("https://www.amazon.com/dp/B000", False), ("https://apple.com/", False),
    ("https://notnetflix.com/", False), ("https://www.youtube.com/watch?v=x", False),
])
def test_is_drm_url(url: str, drm: bool) -> None:
    assert is_drm_url(url) is drm


def code_of(fn, *args) -> str | None:
    try:
        fn(*args)
    except ApiError as e:
        return str(e.code)
    return None


def test_check_info_order_and_codes() -> None:
    bl = InMemoryBlocklist()
    policy = Policy(bl, Limits(max_duration_seconds=600))
    assert code_of(policy.check_info, yt_like_info()) is None
    assert code_of(policy.check_info, yt_like_info(duration=601)) == "too_long"
    assert code_of(policy.check_info, yt_like_info(live_status="is_upcoming")) == \
        "live_not_supported"
    assert code_of(policy.check_info, yt_like_info(_has_drm=True)) == "drm_protected"
    assert code_of(policy.check_info, yt_like_info(availability="premium_only")) == \
        "login_required"
    # A redirect to a DRM service is caught by webpage_url even from a neutral link.
    assert code_of(policy.check_info,
                   yt_like_info(webpage_url="https://www.netflix.com/watch/1")) == "drm_protected"
    bl.add_item("youtube", "abc123")
    assert code_of(policy.check_info, yt_like_info()) == "blocked_by_rights_holder"


def test_some_drm_formats_are_fine_but_all_is_refused() -> None:
    policy = Policy(InMemoryBlocklist())
    info = yt_like_info()
    info["formats"][0]["has_drm"] = True
    assert code_of(policy.check_info, info) is None
    for f in info["formats"]:
        f["has_drm"] = True
    assert code_of(policy.check_info, info) == "drm_protected"


def test_kill_switches() -> None:
    policy = Policy(InMemoryBlocklist(), kill=KillSwitches(
        disabled_extractors=frozenset({"youtube"}), disabled_domains=frozenset({"vimeo.com"})))
    assert code_of(policy.check_url, "https://player.vimeo.com/x") == "unsupported_site"
    assert code_of(policy.check_info, yt_like_info()) == "unsupported_site"


def test_domain_exclusion_covers_subdomains() -> None:
    bl = InMemoryBlocklist()
    bl.add_domain("example.org.")
    policy = Policy(bl)
    assert code_of(policy.check_url, "https://media.example.org/v") == "blocked_by_rights_holder"
    assert code_of(policy.check_url, "https://example.org.evil.test/v") is None


def test_json_blocklist_reloads_and_survives_corruption(tmp_path: Path) -> None:
    path = tmp_path / "bl.json"
    bl = JsonFileBlocklist(path)
    assert not bl.is_url_blocked(canonicalize_url("https://example.com/a"))  # missing file

    path.write_text(json.dumps({"urls": ["https://www.example.com/a?utm_x=1"],
                                "items": [{"site": "YouTube", "id": "abc"}],
                                "domains": ["blocked.test"]}))
    assert bl.is_url_blocked(canonicalize_url("https://example.com/a"))
    assert bl.is_item_blocked("youtube", "abc")
    assert bl.is_domain_excluded("cdn.blocked.test")

    path.write_text("{not json")
    os.utime(path, (1, 1))  # force a different mtime
    assert bl.is_url_blocked(canonicalize_url("https://example.com/a"))  # last good copy kept


def test_json_blocklist_add_urls_persists(tmp_path: Path) -> None:
    path = tmp_path / "sub" / "bl.json"
    JsonFileBlocklist(path).add_urls(["https://example.com/x/"])
    fresh = JsonFileBlocklist(path)
    assert fresh.is_url_blocked("https://example.com/x")
    assert json.loads(path.read_text())["urls"] == ["https://example.com/x"]


def test_reused_extract_is_rechecked_for_item_blocks() -> None:
    """A cached/stored extract must honour item blocks added after it was made."""
    from app.extractor import ExtractResult, FormatSelector, result_from_info

    bl = InMemoryBlocklist()
    policy = Policy(bl)
    result = result_from_info(yt_like_info(), "https://youtu.be/abc123", policy,
                              FormatSelector())
    assert result.item_keys == [("youtube", "abc123")]
    assert code_of(policy.check_reuse, result.webpage_url, result.item_keys) is None
    bl.add_item("Youtube", "abc123")  # e.g. a takedown for a different URL variant
    assert code_of(policy.check_reuse, result.webpage_url,
                   result.item_keys) == "blocked_by_rights_holder"
    # The keys survive the round trip through Redis.
    assert ExtractResult.from_dict(result.to_dict()).item_keys == result.item_keys


# ---------------------------------------------------------------- site allowlist (Option A)

# An example restricted list; production allows every site by default.
ALLOWLIST = Settings(allowed_extractors="ArchiveOrg,Wikimedia,Jamendo,JamendoAlbum,Youtube,"
                     "Instagram,Generic", _env_file=None).allowed_extractor_set


def allowlisted() -> Policy:
    return Policy(InMemoryBlocklist(), kill=KillSwitches(allowed_extractors=ALLOWLIST))


def test_default_allows_every_site() -> None:
    assert Settings(_env_file=None).allowed_extractor_set is None
    assert {"archiveorg", "wikimedia", "jamendo", "jamendoalbum", "youtube",
            "instagram", "generic"} == ALLOWLIST


@pytest.mark.parametrize("url", [
    "https://www.tiktok.com/@someone/video/7234567890123456789",
    "https://vimeo.com/76979871",
    "https://www.youtube.com/@someone",
    "https://www.youtube.com/playlist?list=PL123",
    "https://www.instagram.com/someone/",
    "https://www.instagram.com/stories/someone/123/",
    "https://x.com/someone/status/1234567890",
])
def test_allowlist_refuses_other_sites(url: str) -> None:
    with pytest.raises(ApiError) as e:
        allowlisted().check_url(url)
    assert e.value.code == ErrorCode.UNSUPPORTED_SITE
    assert "doesn't support this site" in e.value.message


@pytest.mark.parametrize("url", [
    "https://archive.org/details/BigBuckBunny_124",
    "https://commons.wikimedia.org/wiki/File:Example.webm",
    "https://www.jamendo.com/track/196219/stories-from-emona-i",
    "https://example.org/files/my-talk.mp4",
    "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    "https://youtu.be/dQw4w9WgXcQ",
    "https://www.youtube.com/shorts/abcdefghijk",
    "https://www.instagram.com/p/Cabc123/",
    "https://www.instagram.com/reel/Cabc123/",
])
def test_allowlist_accepts_permitted_sources(url: str) -> None:
    allowlisted().check_url(url)


def test_generic_needs_a_direct_file_link() -> None:
    page = {"id": "x", "extractor_key": "Generic", "webpage_url": "https://example.org/blog"}
    with pytest.raises(ApiError) as e:
        allowlisted().check_info(page)
    assert e.value.code == ErrorCode.UNSUPPORTED_SITE
    allowlisted().check_info({**page, "direct": True, "webpage_url": "https://example.org/a.mp4"})


def test_allowlist_applies_to_resolved_extractor_and_reuse() -> None:
    # A permitted-looking link that resolves to another site is still refused.
    info = {"id": "abc", "extractor_key": "TikTok", "webpage_url": "https://example.org/a.mp4"}
    with pytest.raises(ApiError):
        allowlisted().check_info(info)
    with pytest.raises(ApiError):
        allowlisted().check_reuse("https://archive.org/details/x", [("tiktok", "abc")])


def test_every_site_still_refuses_drm_and_piracy() -> None:
    policy = Policy(InMemoryBlocklist())  # no allowlist
    policy.check_url("https://www.tiktok.com/@someone/video/7234567890123456789")
    with pytest.raises(ApiError) as e:
        policy.check_url("https://www.netflix.com/watch/80100172")
    assert e.value.code == ErrorCode.DRM_PROTECTED
    with pytest.raises(ApiError):
        policy.check_info({"id": "x", "extractor_key": "KnownPiracy"})
