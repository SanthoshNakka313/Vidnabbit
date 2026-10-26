"""Content policy: DRM denylist, rights-holder blocklist, kill switches, limits.

Nothing in VidNabbit decrypts or bypasses DRM. DRM services are refused up front
by domain; DRM formats (``has_drm`` True or ``'maybe'``) are excluded after
extraction, and a result with only DRM formats is refused (docs/03 section 5).
"""

from __future__ import annotations

import functools
import json
import logging
import os
import tempfile
import threading
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from app.errors import ApiError, ErrorCode

log = logging.getLogger(__name__)

# DRM-only (or DRM-dominant) services, matched by domain suffix. Starting list from
# the brief and docs/03 3.3; **assumption**: needs owner review.
DRM_DOMAINS: frozenset[str] = frozenset(
    {
        "netflix.com",
        "primevideo.com",
        "disneyplus.com",
        "hotstar.com",
        "spotify.com",
        "music.apple.com",
        "tv.apple.com",
        "hulu.com",
        "max.com",
        "hbomax.com",
        "peacocktv.com",
        "paramountplus.com",
        "tidal.com",
        "deezer.com",
        "crunchyroll.com",
    }
)

# Path-scoped DRM areas on otherwise mixed sites: (domain suffix, path prefix).
DRM_PATHS: tuple[tuple[str, str], ...] = tuple(
    (f"amazon.{tld}", "/gp/video")
    for tld in ("com", "co.uk", "de", "fr", "it", "es", "in", "co.jp", "ca", "com.au")
)

# yt-dlp extractor keys for DRM services (catches redirects/short links).
DRM_EXTRACTORS: frozenset[str] = frozenset({"knowndrm", "netflix", "disneyplus", "spotify"})
PIRACY_EXTRACTORS: frozenset[str] = frozenset({"knownpiracy"})

# Generic only counts as allowed for a direct link to a media file (yt-dlp sets
# ``direct``), never for an arbitrary page with an embedded player.
GENERIC_EXTRACTOR = "generic"
NOT_ALLOWED_MESSAGE = (
    "VidNabbit only works with sites that allow downloading, like the Internet Archive and "
    "Wikimedia Commons, or a direct link to a file. See Supported sites."
)


@functools.cache
def _extractor_classes() -> tuple[Any, ...]:
    from yt_dlp.extractor import gen_extractor_classes  # heavy; loaded on first use

    return tuple(gen_extractor_classes())


def url_extractor_key(url: str) -> str:
    """The yt-dlp extractor that would handle ``url`` (lowercased), without any network."""
    for ie in _extractor_classes():
        if ie.suitable(url):
            return str(ie.ie_key()).lower()
    return GENERIC_EXTRACTOR


TRACKING_PARAM_PREFIXES = ("utm_",)
TRACKING_PARAMS = frozenset({"fbclid", "gclid", "igshid", "si", "feature", "ref", "ref_src"})
LIVE_STATUSES = frozenset({"is_live", "is_upcoming", "post_live"})


def host_matches(host: str, domain: str) -> bool:
    host = host.lower().rstrip(".")
    return host == domain or host.endswith("." + domain)


def _strip_www(host: str) -> str:
    for prefix in ("www.", "m.", "mobile."):
        if host.startswith(prefix) and "." in host[len(prefix) :]:
            return host[len(prefix) :]
    return host


def canonicalize_url(url: str) -> str:
    """Canonical form for blocklist matching and cache keys.

    Lowercases host, drops www./m./mobile., default ports, fragment, tracking
    params and trailing slash, sorts the query, and normalises scheme to https.
    """
    parts = urlsplit(url.strip())
    host = _strip_www((parts.hostname or "").lower().rstrip("."))
    try:
        port = parts.port
    except ValueError:
        port = None
    netloc = host if port in (None, 80, 443) else f"{host}:{port}"
    query = sorted(
        (k, v)
        for k, v in parse_qsl(parts.query, keep_blank_values=True)
        if k.lower() not in TRACKING_PARAMS and not k.lower().startswith(TRACKING_PARAM_PREFIXES)
    )
    path = parts.path.rstrip("/") or "/"
    return urlunsplit(("https", netloc, path, urlencode(query), ""))


def is_drm_url(url: str) -> bool:
    parts = urlsplit(url)
    host = (parts.hostname or "").lower()
    if any(host_matches(host, d) for d in DRM_DOMAINS):
        return True
    return any(host_matches(host, d) and parts.path.startswith(p) for d, p in DRM_PATHS)


# ------------------------------------------------------------------ blocklist


class Blocklist(Protocol):
    """Rights-holder blocklist. Production: Postgres + Redis cache (docs/02)."""

    def is_url_blocked(self, canonical_url: str) -> bool: ...

    def is_item_blocked(self, site: str, item_id: str) -> bool: ...

    def is_domain_excluded(self, host: str) -> bool: ...

    def add_urls(self, urls: Iterable[str]) -> None: ...


@dataclass
class InMemoryBlocklist:
    urls: set[str] = field(default_factory=set)
    items: set[tuple[str, str]] = field(default_factory=set)  # (extractor key lower, id)
    domains: set[str] = field(default_factory=set)

    def add_url(self, url: str) -> None:
        self.urls.add(canonicalize_url(url))

    def add_urls(self, urls: Iterable[str]) -> None:
        for u in urls:
            self.add_url(u)

    def add_item(self, site: str, item_id: str) -> None:
        self.items.add((site.lower(), str(item_id)))

    def add_domain(self, domain: str) -> None:
        self.domains.add(domain.lower().strip().rstrip("."))

    def is_url_blocked(self, canonical_url: str) -> bool:
        return canonical_url in self.urls

    def is_item_blocked(self, site: str, item_id: str) -> bool:
        return (site.lower(), str(item_id)) in self.items

    def is_domain_excluded(self, host: str) -> bool:
        return any(host_matches(host, d) for d in self.domains)

    def to_mapping(self) -> dict[str, Any]:
        return {
            "urls": sorted(self.urls),
            "items": [{"site": s, "id": i} for s, i in sorted(self.items)],
            "domains": sorted(self.domains),
        }

    @classmethod
    def from_mapping(cls, data: Mapping[str, Any]) -> InMemoryBlocklist:
        bl = cls()
        for u in data.get("urls", []):
            bl.add_url(u)
        for it in data.get("items", []):
            bl.add_item(it["site"], it["id"])
        for d in data.get("domains", []):
            bl.add_domain(d)
        return bl


class JsonFileBlocklist:
    """Blocklist in a JSON file, reloaded when its mtime changes.

    Format: ``{"urls": [...], "items": [{"site": "youtube", "id": "..."}],
    "domains": [...]}``. A missing file is empty; a corrupt file keeps the last
    good copy. ``add_urls`` writes atomically (used for provisional takedowns).
    Domain exclusions are only ever added by an operator after verification.
    """

    def __init__(self, path: Path) -> None:
        self.path = path
        self._lock = threading.RLock()
        self._mtime: float | None = None
        self._data = InMemoryBlocklist()

    def _current(self) -> InMemoryBlocklist:
        try:
            mtime = self.path.stat().st_mtime
        except FileNotFoundError:
            with self._lock:
                if self._mtime is not None:
                    self._data, self._mtime = InMemoryBlocklist(), None
                return self._data
        with self._lock:
            if mtime != self._mtime:
                try:
                    raw = json.loads(self.path.read_text(encoding="utf-8"))
                    self._data = InMemoryBlocklist.from_mapping(raw)
                except (OSError, ValueError, KeyError, TypeError):
                    log.exception("blocklist file unreadable; keeping previous copy")
                self._mtime = mtime
            return self._data

    def add_urls(self, urls: Iterable[str]) -> None:
        with self._lock:
            data = self._current()
            data.add_urls(urls)
            self.path.parent.mkdir(parents=True, exist_ok=True)
            fd, tmp = tempfile.mkstemp(dir=self.path.parent, prefix=".blocklist-")
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(data.to_mapping(), f, indent=1)
            os.replace(tmp, self.path)
            self._mtime = self.path.stat().st_mtime

    def is_url_blocked(self, canonical_url: str) -> bool:
        return self._current().is_url_blocked(canonical_url)

    def is_item_blocked(self, site: str, item_id: str) -> bool:
        return self._current().is_item_blocked(site, item_id)

    def is_domain_excluded(self, host: str) -> bool:
        return self._current().is_domain_excluded(host)


# --------------------------------------------------------------------- policy


@dataclass(frozen=True)
class Limits:
    max_duration_seconds: int = 3 * 3600
    max_filesize_bytes: int = 4 * 1024**3


@dataclass(frozen=True)
class KillSwitches:
    extraction_enabled: bool = True
    disabled_extractors: frozenset[str] = frozenset()  # lowercased extractor keys
    disabled_domains: frozenset[str] = frozenset()
    # Lowercased extractor keys that may be used; None allows every extractor.
    allowed_extractors: frozenset[str] | None = None


class Policy:
    def __init__(
        self,
        blocklist: Blocklist,
        limits: Limits | None = None,
        kill: KillSwitches | None = None,
    ) -> None:
        self.blocklist = blocklist
        self.limits = limits or Limits()
        self.kill = kill or KillSwitches()

    def check_url(self, url: str) -> None:
        """Before any network request to the source (docs/03 5.1 steps 2-3)."""
        host = (urlsplit(url).hostname or "").lower()
        if not self.kill.extraction_enabled:
            raise ApiError(ErrorCode.UPSTREAM_ERROR, "Downloads are temporarily unavailable.")
        if any(host_matches(host, d) for d in self.kill.disabled_domains):
            raise ApiError(ErrorCode.UNSUPPORTED_SITE, "This site isn't available right now.")
        if is_drm_url(url):
            raise ApiError(ErrorCode.DRM_PROTECTED)
        if self.blocklist.is_domain_excluded(host):
            raise ApiError(
                ErrorCode.BLOCKED_BY_RIGHTS_HOLDER,
                "The owner of this site has asked us not to process its content.",
            )
        if self.blocklist.is_url_blocked(canonicalize_url(url)):
            raise ApiError(ErrorCode.BLOCKED_BY_RIGHTS_HOLDER)
        self._check_allowed(url_extractor_key(url))

    def _check_allowed(self, extractor: str, *, direct: bool | None = None) -> None:
        allowed = self.kill.allowed_extractors
        if allowed is None:
            return
        if extractor not in allowed or (extractor == GENERIC_EXTRACTOR and direct is False):
            raise ApiError(ErrorCode.UNSUPPORTED_SITE, NOT_ALLOWED_MESSAGE)

    def check_reuse(self, webpage_url: str, item_keys: Iterable[tuple[str, str]]) -> None:
        """Before reusing a cached or stored extract: a takedown may have arrived since."""
        self.check_url(webpage_url)
        for site, item_id in item_keys:
            if self.blocklist.is_item_blocked(site, item_id):
                raise ApiError(ErrorCode.BLOCKED_BY_RIGHTS_HOLDER)
            if site in self.kill.disabled_extractors:
                raise ApiError(ErrorCode.UNSUPPORTED_SITE, "This site isn't available right now.")
            self._check_allowed(site)

    def check_info(self, info: Mapping[str, Any]) -> None:
        """Metadata checks after extraction and again at job start (docs/03 5.1 step 6).

        Order: URL/blocklist, kill switches, live, DRM, availability, duration.
        """
        urls = [info.get("webpage_url"), info.get("original_url")]
        if info.get("_type") in ("url", "url_transparent"):
            urls.append(info.get("url"))
        for page in urls:
            if isinstance(page, str) and page.startswith(("http://", "https://")):
                self.check_url(page)

        extractor = str(info.get("extractor_key") or info.get("ie_key") or "").lower()
        item_id = info.get("id")
        if extractor and item_id is not None and self.blocklist.is_item_blocked(
            extractor, str(item_id)
        ):
            raise ApiError(ErrorCode.BLOCKED_BY_RIGHTS_HOLDER)
        if extractor in self.kill.disabled_extractors:
            raise ApiError(ErrorCode.UNSUPPORTED_SITE, "This site isn't available right now.")
        if extractor in PIRACY_EXTRACTORS:
            raise ApiError(ErrorCode.UNSUPPORTED_SITE)
        self._check_allowed(extractor or GENERIC_EXTRACTOR, direct=bool(info.get("direct")))

        if info.get("is_live") or info.get("live_status") in LIVE_STATUSES:
            raise ApiError(ErrorCode.LIVE_NOT_SUPPORTED)

        if extractor in DRM_EXTRACTORS or info.get("_has_drm"):
            raise ApiError(ErrorCode.DRM_PROTECTED)
        formats = info.get("formats") or []
        if formats and all(f.get("has_drm") for f in formats):  # includes 'maybe'
            raise ApiError(ErrorCode.DRM_PROTECTED)

        availability = info.get("availability")
        if availability == "private":
            raise ApiError(ErrorCode.PRIVATE_CONTENT)
        if availability in ("premium_only", "subscriber_only", "needs_auth"):
            raise ApiError(ErrorCode.LOGIN_REQUIRED)

        self.check_duration(info.get("duration"))

    def check_duration(self, duration: Any) -> None:
        if isinstance(duration, int | float) and duration > self.limits.max_duration_seconds:
            hours = self.limits.max_duration_seconds / 3600
            raise ApiError(
                ErrorCode.TOO_LONG, f"Media longer than {hours:g} hours isn't supported."
            )

    def check_filesize(self, size: Any) -> None:
        if not self.filesize_ok(size):
            gb = self.limits.max_filesize_bytes / 1024**3
            raise ApiError(ErrorCode.TOO_LARGE, f"Files larger than {gb:g} GB aren't supported.")

    def filesize_ok(self, size: Any) -> bool:
        return not (isinstance(size, int | float) and size > self.limits.max_filesize_bytes)
