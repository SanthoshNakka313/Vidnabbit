"""API-side extractor facade.

The API process never runs yt-dlp network code. It asks the sandbox child
(``app.sandbox_runner``) for a slim, sanitised info summary, then applies policy
and builds user-facing presets locally. yt-dlp is imported here only for its
offline format-selector parser.

Presets offered: best video (merged MP4), 1080p/720p/480p MP4, MP3 192 kbps, M4A
(original audio), original image(s). Each preset is resolved at extract time to
a concrete yt-dlp format spec with a generic fallback, stored server-side and
referenced by ``format_id``; users never send raw selectors.
"""

from __future__ import annotations

import asyncio
import contextlib
import logging
import shutil
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit

from app.errors import ApiError, ErrorCode
from app.policy import Policy, canonicalize_url
from app.sandbox import Sandbox
from app.ytdlp_core import (
    MP3_KBPS,
    RedactingLogger,
    build_ydl_opts,
    clean_text,
    has_audio,
    has_video,
    is_image_format,
    is_safe_format,
    selection_ctx,
)

log = logging.getLogger(__name__)

VIDEO_HEIGHTS = (1080, 720, 480)
SITE_NAMES = {
    "youtube": "YouTube",
    "vimeo": "Vimeo",
    "dailymotion": "Dailymotion",
    "soundcloud": "SoundCloud",
    "twitter": "X (Twitter)",
    "instagram": "Instagram",
    "tiktok": "TikTok",
    "reddit": "Reddit",
    "facebook": "Facebook",
    "twitch": "Twitch",
    "bandcamp": "Bandcamp",
    "archiveorg": "Internet Archive",
    "wikimediacommons": "Wikimedia Commons",
}

Mode = Literal["video", "audio_mp3", "audio_m4a", "image"]


@dataclass(frozen=True)
class ResolvedPreset:
    format_id: str
    mode: Mode
    spec: str  # "<concrete format ids>/<generic fallback selector>"
    ext: str
    public: dict[str, Any]  # the contract "format" object
    playlist_index: int | None = None

    def task(self) -> dict[str, Any]:
        return {"spec": self.spec, "mode": self.mode, "playlist_index": self.playlist_index}

    def to_dict(self) -> dict[str, Any]:
        """JSON-safe form for the Redis job record (read back by the worker)."""
        return {"format_id": self.format_id, "mode": self.mode, "spec": self.spec,
                "ext": self.ext, "public": self.public, "playlist_index": self.playlist_index}

    @classmethod
    def from_dict(cls, d: Mapping[str, Any]) -> ResolvedPreset:
        if d["mode"] not in ("video", "audio_mp3", "audio_m4a", "image"):
            raise ValueError("unknown preset mode")
        index = d.get("playlist_index")
        return cls(str(d["format_id"]), d["mode"], str(d["spec"]), str(d["ext"]),
                   dict(d["public"]), int(index) if index is not None else None)


@dataclass
class ExtractResult:
    source_site: str
    source_url: str  # canonical
    webpage_url: str  # passed back to yt-dlp at job time
    title: str
    uploader: str | None
    duration_seconds: int | None
    thumbnail_url: str | None
    media_type: Literal["video", "audio", "image", "gallery"]
    presets: list[ResolvedPreset] = field(default_factory=list)

    def preset(self, format_id: str) -> ResolvedPreset | None:
        return next((p for p in self.presets if p.format_id == format_id), None)


@dataclass
class DownloadedFile:
    path: Path
    title: str
    ext: str
    size: int


# ----------------------------------------------------------------- helpers


def resolve_ffmpeg_location(configured: str | None, bin_dir: Path) -> str | None:
    """Explicit setting > ffmpeg on PATH > pip-installed static binary (dev only)."""
    if configured:
        return configured
    if shutil.which("ffmpeg"):
        return None
    try:
        import imageio_ffmpeg  # dev dependency
    except ImportError:
        log.warning("ffmpeg not found; merging and audio conversion will fail")
        return None
    exe = Path(imageio_ffmpeg.get_ffmpeg_exe())
    bin_dir.mkdir(parents=True, exist_ok=True)
    link = bin_dir / "ffmpeg"  # yt-dlp identifies binaries by basename
    if not link.exists():
        with contextlib.suppress(FileExistsError):
            link.symlink_to(exe)
    return str(bin_dir.resolve())


def _num(v: Any) -> int | None:
    try:
        return round(float(v)) if v is not None else None
    except (TypeError, ValueError):
        return None


def _requested(sel: Mapping[str, Any]) -> list[Mapping[str, Any]]:
    return list(sel.get("requested_formats") or [sel])


def _concrete_spec(sel: Mapping[str, Any]) -> str:
    return "+".join(str(f["format_id"]) for f in _requested(sel) if f.get("format_id"))


def _estimate_size(parts: list[Mapping[str, Any]], duration: Any) -> tuple[int | None, bool]:
    total, estimate = 0, False
    for f in parts:
        if f.get("filesize"):
            total += int(f["filesize"])
        elif f.get("filesize_approx"):
            total += int(f["filesize_approx"])
            estimate = True
        elif f.get("tbr") and isinstance(duration, int | float):
            total += int(float(f["tbr"]) * 1000 / 8 * duration)
            estimate = True
        else:
            return None, True
    return total, estimate


def site_name(info: Mapping[str, Any], url: str) -> str:
    key = str(info.get("extractor_key") or "").lower()
    if key in SITE_NAMES:
        return SITE_NAMES[key]
    if key and key not in ("generic", "html5mediaembed"):
        return clean_text(info.get("extractor_key"), 60) or "Web"
    host = (urlsplit(url).hostname or "").lower()
    return host.removeprefix("www.") or "Web"


class FormatSelector:
    """Offline wrapper around yt-dlp's format-selector parser (no network).

    Like yt-dlp itself, selectors such as ``best`` pick the *last* match, so
    ``formats`` must be sorted worst -> best (yt-dlp sorts them during extraction).
    """

    def __init__(self) -> None:
        import yt_dlp

        self._ydl = yt_dlp.YoutubeDL(build_ydl_opts(logger=RedactingLogger()))

    def select(self, spec: str, formats: list[dict[str, Any]]) -> dict[str, Any] | None:
        if not formats:
            return None
        try:
            chosen = list(self._ydl.build_format_selector(spec)(selection_ctx(formats)))
        except (SyntaxError, ValueError, KeyError, TypeError):
            log.debug("format selection failed for spec %s", spec, exc_info=True)
            return None
        return chosen[-1] if chosen else None


# ----------------------------------------------------------------- presets


def _video_specs() -> list[tuple[str, str, str]]:
    specs = [("best", "Best quality", "bv*+ba[ext=m4a]/bv*+ba/b")]
    for h in VIDEO_HEIGHTS:
        specs.append((
            f"mp4-{h}p",
            f"{h}p",
            f"bv*[height<={h}][vcodec^=avc1]+ba[ext=m4a]/bv*[height<={h}]+ba[ext=m4a]"
            f"/bv*[height<={h}]+ba/b[height<={h}]",
        ))
    return specs


def build_presets(
    selector: FormatSelector,
    info: Mapping[str, Any],
    policy: Policy,
    *,
    id_prefix: str = "",
    label_prefix: str = "",
    playlist_index: int | None = None,
    only_best: bool = False,
) -> list[ResolvedPreset]:
    formats = [dict(f) for f in (info.get("formats") or []) if is_safe_format(f)]
    if not formats:
        return []
    duration = info.get("duration")
    presets: list[ResolvedPreset] = []

    def add(fid: str, mode: Mode, spec: str, ext: str, public: dict[str, Any]) -> None:
        if not policy.filesize_ok(public.get("filesize_bytes")):
            return
        full_id = id_prefix + fid
        presets.append(ResolvedPreset(full_id, mode, spec, ext, {"format_id": full_id, **public},
                                      playlist_index))

    images = [f for f in formats if is_image_format(f)]
    media = [f for f in formats if not is_image_format(f)]
    videos = [f for f in media if has_video(f)]
    audios = [f for f in media if has_audio(f)]

    if images and not videos:
        sel = selector.select("best", images)
        if sel is None:
            return []
        ext = str(sel.get("ext") or "jpg").lower()
        size, est = _estimate_size([sel], None)
        add("image", "image", f"{_concrete_spec(sel)}/best", ext, {
            "kind": "image", "ext": ext,
            "label": f"{label_prefix}Original image · {ext.upper()}",
            "width": _num(sel.get("width") or info.get("width")),
            "height": _num(sel.get("height") or info.get("height")),
            "fps": None, "audio_bitrate_kbps": None, "has_audio": False, "has_video": False,
            "filesize_bytes": size, "filesize_is_estimate": est,
        })
        return presets

    if videos:
        max_h = max((_num(f.get("height")) or 0) for f in videos)
        seen: set[str] = set()
        for fid, name, spec in _video_specs():
            if fid != "best":
                h = int(fid.split("-")[1][:-1])
                if only_best or not max_h or max_h < h:
                    continue
            sel = selector.select(spec, media)
            if sel is None:
                continue
            concrete = _concrete_spec(sel)
            if concrete in seen:
                continue
            seen.add(concrete)
            parts = _requested(sel)
            vpart = next((p for p in parts if has_video(p)), parts[0])
            height = _num(vpart.get("height"))
            if fid == "best":
                label = f"{name} · {height}p" if height else name
            else:
                label = f"{height}p" if height else name  # actual height, not the cap
            size, est = _estimate_size(parts, duration)
            add(fid, "video", f"{concrete}/{spec}", "mp4", {
                "kind": "video", "ext": "mp4", "label": f"{label_prefix}{label} · MP4",
                "width": _num(vpart.get("width")), "height": height,
                "fps": _num(vpart.get("fps")), "audio_bitrate_kbps": None,
                "has_audio": any(has_audio(p) for p in parts), "has_video": True,
                "filesize_bytes": size, "filesize_is_estimate": est or len(parts) > 1,
            })

    if audios and not only_best:
        sel = selector.select("ba/b", audios)
        if sel is not None:
            mp3_size = (int(MP3_KBPS * 1000 / 8 * duration)
                        if isinstance(duration, int | float) else None)
            add("mp3-192", "audio_mp3", f"{_concrete_spec(sel)}/ba/b", "mp3", {
                "kind": "audio", "ext": "mp3", "label": f"Audio · MP3 · {MP3_KBPS} kbps",
                "width": None, "height": None, "fps": None, "audio_bitrate_kbps": MP3_KBPS,
                "has_audio": True, "has_video": False,
                "filesize_bytes": mp3_size, "filesize_is_estimate": True,
            })
        m4a_spec = "ba[ext=m4a]/ba[acodec^=mp4a]/ba/b"
        sel = selector.select(m4a_spec, audios)
        if sel is not None:
            size, _ = _estimate_size(_requested(sel), duration)
            add("m4a", "audio_m4a", f"{_concrete_spec(sel)}/{m4a_spec}", "m4a", {
                "kind": "audio", "ext": "m4a", "label": "Audio · M4A (original quality)",
                "width": None, "height": None, "fps": None,
                "audio_bitrate_kbps": _num(sel.get("abr")),
                "has_audio": True, "has_video": False,
                "filesize_bytes": size, "filesize_is_estimate": True,
            })
    return presets


def _raise_no_presets(info: Mapping[str, Any], policy: Policy) -> None:
    formats = info.get("formats") or []
    if info.get("_has_drm") or (formats and any(f.get("has_drm") for f in formats)):
        raise ApiError(ErrorCode.DRM_PROTECTED)
    sizes = [f.get("filesize") or f.get("filesize_approx") for f in formats]
    if sizes and all(s and not policy.filesize_ok(s) for s in sizes):
        raise ApiError(ErrorCode.TOO_LARGE)
    raise ApiError(ErrorCode.UNSUPPORTED_SITE)


def result_from_info(
    info: Mapping[str, Any], url: str, policy: Policy, selector: FormatSelector,
    *, max_gallery_items: int = 50,
) -> ExtractResult:
    """Slim info (from the sandbox) -> policy checks -> ExtractResult with presets."""
    policy.check_info(info)
    webpage_url = info.get("webpage_url") or url
    common: dict[str, Any] = {
        "source_site": site_name(info, webpage_url),
        "source_url": canonicalize_url(webpage_url),
        "webpage_url": webpage_url,
        "title": clean_text(info.get("title"), 300) or clean_text(info.get("id"), 300)
        or "Untitled",
        "uploader": clean_text(info.get("uploader"), 100),
        "thumbnail_url": info.get("thumbnail") if isinstance(info.get("thumbnail"), str)
        and str(info.get("thumbnail")).startswith("https://") else None,
    }
    if info.get("_type") in ("playlist", "multi_video"):
        entries = [e for e in (info.get("entries") or []) if e][:max_gallery_items]
        resolved = [(i, e) for i, e in enumerate(entries, start=1)
                    if e.get("_type", "video") == "video" and e.get("formats")]
        if not resolved:
            raise ApiError(ErrorCode.UNSUPPORTED_SITE,
                           "Playlists and channels aren't supported. Paste a link to one item.")
        presets: list[ResolvedPreset] = []
        for idx, entry in resolved:
            policy.check_info(entry)  # any DRM/blocked entry refuses the whole request
            presets += build_presets(selector, entry, policy, id_prefix=f"item{idx}-",
                                     label_prefix=f"Item {idx} · ", playlist_index=idx,
                                     only_best=True)
        if not presets:
            _raise_no_presets(info, policy)
        return ExtractResult(duration_seconds=None, media_type="gallery", presets=presets,
                             **common)

    presets = build_presets(selector, info, policy)
    if not presets:
        _raise_no_presets(info, policy)
    kinds = {p.public["kind"] for p in presets}
    media_type = "image" if kinds == {"image"} else "video" if "video" in kinds else "audio"
    return ExtractResult(duration_seconds=_num(info.get("duration")), media_type=media_type,
                         presets=presets, **common)


# ------------------------------------------------------------------ facade


class Extractor:
    """Async facade used by the API and job runner. Mock this in API tests."""

    def __init__(
        self,
        policy: Policy,
        sandbox: Sandbox,
        *,
        opts_cfg: Mapping[str, Any],
        extract_timeout: float = 30.0,
        job_timeout: float = 1800.0,
        max_extract_concurrency: int = 8,
        max_gallery_items: int = 50,
    ) -> None:
        self.policy = policy
        self.sandbox = sandbox
        self.opts_cfg = dict(opts_cfg)
        self.extract_timeout = extract_timeout
        self.job_timeout = job_timeout
        self.max_gallery_items = max_gallery_items
        self._extract_sem = asyncio.Semaphore(max_extract_concurrency)
        self._selector: FormatSelector | None = None

    @property
    def selector(self) -> FormatSelector:
        if self._selector is None:
            self._selector = FormatSelector()
        return self._selector

    async def extract(self, url: str) -> ExtractResult:
        if self._extract_sem.locked():
            raise ApiError(ErrorCode.RATE_LIMITED, "We're busy right now. Try again shortly.",
                           status=503, headers={"Retry-After": "5"})
        async with self._extract_sem:
            msg = await self.sandbox.run(
                {"op": "extract", "url": url, "opts": self.opts_cfg},
                timeout=self.extract_timeout,
            )
        return result_from_info(msg.get("info") or {}, url, self.policy, self.selector,
                                max_gallery_items=self.max_gallery_items)

    async def download(
        self,
        url: str,
        preset: ResolvedPreset,
        workdir: Path,
        job_uuid: str,
        *,
        on_progress: Callable[[float], None] | None = None,
    ) -> DownloadedFile:
        refusal: list[ApiError] = []

        async def on_message(msg: dict[str, Any]) -> str | None:
            if msg.get("t") == "progress" and on_progress is not None:
                with contextlib.suppress(TypeError, ValueError):
                    on_progress(float(msg.get("v") or 0.0))
                return None
            if msg.get("t") == "info":
                try:  # takedowns/status may have changed since extract (docs/03 5.1 step 7)
                    self.policy.check_info(msg.get("info") or {})
                except ApiError as e:
                    refusal.append(e)
                    return "abort"
                return "go"
            return None

        try:
            res = await self.sandbox.run(
                {"op": "download", "url": url, "preset": preset.task(),
                 "workdir": str(workdir), "job_uuid": job_uuid, "opts": self.opts_cfg},
                timeout=self.job_timeout, on_message=on_message, tmpdir=workdir,
            )
        except ApiError:
            if refusal:
                raise refusal[0] from None
            raise
        return await asyncio.to_thread(_checked_file, res, workdir)


def _checked_file(res: Mapping[str, Any], workdir: Path) -> DownloadedFile:
    """The child reports a path; trust it only if it's a regular file inside workdir."""
    path = Path(str(res.get("path"))).resolve()
    if not path.is_relative_to(workdir.resolve()) or not path.is_file():
        raise ApiError(ErrorCode.INTERNAL)
    return DownloadedFile(path=path, title=str(res.get("title") or "download"),
                          ext=str(res.get("ext") or path.suffix.lstrip(".")),
                          size=path.stat().st_size)
