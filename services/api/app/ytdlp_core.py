"""yt-dlp integration that runs inside the sandbox child process.

Everything that touches the network or parses remote media lives here and is
only executed by ``app.sandbox_runner`` (a killable child process with rlimits
and a scrubbed environment). Helpers that are pure data (format safety checks,
error mapping) are shared with the API process.

Rules (docs/03 2.2): yt-dlp only through its Python API, options only from
server-side constants, the user only supplies a normalised URL and a server-side
preset, no cookies/netrc/credentials/config files/plugins, no unplayable (DRM)
formats, native downloader only, ffmpeg reads local files only.
"""

from __future__ import annotations

import logging
import os
import re
import shutil
import stat
import subprocess
import time
from collections import deque
from collections.abc import Callable, Iterator, Mapping
from pathlib import Path
from typing import Any

from app.errors import ApiError, ErrorCode
from app.ssrf import is_ssrf_block, media_url_allowed

log = logging.getLogger(__name__)

IMAGE_EXTS = frozenset({"jpg", "jpeg", "png", "webp", "gif"})
AUDIO_ONLY_EXTS = frozenset({"mp3", "m4a", "aac", "opus", "ogg", "oga", "flac", "wav"})
ALLOWED_INPUT_EXTS = frozenset(
    {"mp4", "m4v", "webm", "mov", "mkv", "3gp", "flv", "ts", *AUDIO_ONLY_EXTS, *IMAGE_EXTS}
)
OUTPUT_EXTS = frozenset({"mp4", "webm", "mkv", "m4a", "mp3", "opus", "ogg", *IMAGE_EXTS})
SAFE_PROTOCOLS = frozenset(
    {"http", "https", "m3u8", "m3u8_native", "http_dash_segments", "http_dash_segments_generator"}
)
MAX_FRAGMENTS = 20_000
MP3_KBPS = 192
FFMPEG_LOCAL_ONLY = ["-protocol_whitelist", "file,pipe"]
# yt-dlp ffmpeg postprocessors we use; each needs its own "<pp>+ffmpeg_i" key.
FFMPEG_PPS = ("merger", "videoremuxer", "extractaudio", "fixupm3u8", "fixupm4a",
              "fixupstretched", "fixupduplicatemoov", "fixuptimestamp", "fixupduration")
MIN_THROUGHPUT_BPS = 64 * 1024
THROUGHPUT_WINDOW_S = 60.0

_CONTROL = re.compile(r"[\x00-\x1f\x7f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]")
_URL_RE = re.compile(r"https?://[^\s'\"<>]+", re.IGNORECASE)


def clean_text(value: Any, max_len: int) -> str | None:
    """Remote strings: drop control/bidi/zero-width characters, cap length."""
    if value is None:
        return None
    text = _CONTROL.sub("", str(value)).strip()
    return text[:max_len] or None


# --------------------------------------------------------------------- options


def build_ydl_opts(
    *,
    logger: Any,
    socket_timeout: float = 15.0,
    ffmpeg_location: str | None = None,
    proxy: str | None = None,
    max_filesize: int = 4 * 1024**3,
    max_gallery_items: int = 50,
) -> dict[str, Any]:
    """The only place yt-dlp options are built. Server-side constants only."""
    pp_args: dict[str, list[str]] = {f"{pp}+ffmpeg_i": list(FFMPEG_LOCAL_ONLY) for pp in FFMPEG_PPS}
    pp_args["ffmpeg"] = ["-fs", str(max_filesize)]  # first output of every ffmpeg PP
    opts: dict[str, Any] = {
        "logger": logger,
        "quiet": True,
        "no_warnings": False,
        "noprogress": True,
        "color": {"stdout": "no_color", "stderr": "no_color"},
        # Network. "" disables env proxies so the SSRF guard sees real destinations.
        "proxy": proxy or "",
        "socket_timeout": socket_timeout,
        "retries": 2,
        "fragment_retries": 3,
        "extractor_retries": 1,
        "nocheckcertificate": False,
        "prefer_insecure": False,
        "legacyserverconnect": False,
        "geo_bypass": False,
        "enable_file_urls": False,
        "concurrent_fragment_downloads": 4,
        # Never any credentials or config (Safeguard 2).
        "ignoreconfig": True,
        "cookiefile": None,
        "cookiesfrombrowser": None,
        "usenetrc": False,
        "netrc_location": None,
        "netrc_cmd": None,
        "username": None,
        "password": None,
        "videopassword": None,
        "ap_mso": None,
        "ap_username": None,
        "ap_password": None,
        "client_certificate": None,
        # No DRM bypass, ever (Safeguard 1). Never change this.
        "allow_unplayable_formats": False,
        # Single items; galleries capped.
        "noplaylist": True,
        "playlistend": max_gallery_items,
        "extract_flat": "in_playlist",
        "lazy_playlist": True,
        "default_search": "error",
        "live_from_start": False,
        "wait_for_video": None,
        # No side files, archives, comments, or cache.
        "writeinfojson": False,
        "writethumbnail": False,
        "writesubtitles": False,
        "writeautomaticsub": False,
        "writedescription": False,
        "writelink": False,
        "getcomments": False,
        "download_archive": None,
        "cachedir": False,
        "restrictfilenames": True,
        "windowsfilenames": True,
        "max_filesize": max_filesize,
        # Native downloader only; ffmpeg never opens network inputs.
        "external_downloader": {"default": "native"},
        "external_downloader_args": {"ffmpeg_i": list(FFMPEG_LOCAL_ONLY)},
        "postprocessor_args": pp_args,
        "remote_components": [],
    }
    if ffmpeg_location:
        opts["ffmpeg_location"] = ffmpeg_location
    return opts


class RedactingLogger:
    """yt-dlp logger: drops debug lines, redacts URLs, keeps recent lines in memory."""

    def __init__(self) -> None:
        self.recent: deque[str] = deque(maxlen=50)

    @staticmethod
    def redact(msg: str) -> str:
        def _host(m: re.Match[str]) -> str:
            host = re.sub(r"^https?://", "", m.group(0), flags=re.I).split("/", 1)[0]
            return f"<url host={host.split('@')[-1][:100]}>"

        return _URL_RE.sub(_host, str(msg))[:500]

    def debug(self, msg: str) -> None:
        # yt-dlp routes info-level output to debug when quiet; keep for diagnosis only.
        self.recent.append(self.redact(msg))

    def info(self, msg: str) -> None:
        self.recent.append(self.redact(msg))

    def warning(self, msg: str) -> None:
        red = self.redact(msg)
        self.recent.append(red)
        log.warning("yt-dlp warning: %s", red)

    def error(self, msg: str) -> None:
        red = self.redact(msg)
        self.recent.append(red)
        log.info("yt-dlp error: %s", red)

    def saw(self, needle: str) -> bool:
        needle = needle.lower()
        return any(needle in m.lower() for m in self.recent)


# ------------------------------------------------------------- error mapping

_RE_DRM = re.compile(r"\bdrm\b|known to use drm", re.I)
_RE_PIRACY = re.compile(r"known piracy|piracy", re.I)
_RE_PRIVATE = re.compile(
    r"private video|this video is private|is private|private (post|account|playlist)", re.I
)
_RE_LOGIN = re.compile(
    r"sign in|log ?in|login|--cookies|cookies-from-browser|authenticat|account|"
    r"members?[- ]only|join this channel|premium|subscri(be|ption)|purchase|rent(al)?\b|"
    r"\bpaid\b|registered users|confirm your age|age[- ]restricted|inappropriate for some users",
    re.I,
)
_RE_UNAVAILABLE = re.compile(
    r"video unavailable|is unavailable|not available|has been removed|was removed|"
    r"no longer available|does not exist|http error 40[34]|http error 410|http error 451",
    re.I,
)
_RE_UNSUPPORTED = re.compile(r"unsupported url|no video formats found|no media found", re.I)


def _root_exception(exc: BaseException) -> BaseException:
    inner = getattr(exc, "exc_info", None)
    if inner and len(inner) > 1 and isinstance(inner[1], BaseException):
        return inner[1]
    return exc


def map_ytdlp_error(exc: BaseException) -> ApiError:
    """Type first, message second (docs/03 5.3). Never returns raw upstream text."""
    from yt_dlp.utils import GeoRestrictedError, UnsupportedError, YoutubeDLError

    if isinstance(exc, ApiError):
        return exc
    root = _root_exception(exc)
    if any(is_ssrf_block(e) for e in (exc, root, getattr(root, "cause", None))):
        return ApiError(ErrorCode.INVALID_URL, "That link points to an address we don't fetch.")
    msg = f"{exc} {root}"
    if _RE_DRM.search(msg):
        return ApiError(ErrorCode.DRM_PROTECTED)
    if isinstance(root, UnsupportedError) or _RE_UNSUPPORTED.search(msg) or _RE_PIRACY.search(
        msg
    ):
        return ApiError(ErrorCode.UNSUPPORTED_SITE)
    if _RE_PRIVATE.search(msg):  # before login: private messages often mention signing in
        return ApiError(ErrorCode.PRIVATE_CONTENT)
    if isinstance(root, GeoRestrictedError):
        return ApiError(
            ErrorCode.UPSTREAM_ERROR, "This media isn't available from our server's region."
        )
    if _RE_LOGIN.search(msg):
        return ApiError(ErrorCode.LOGIN_REQUIRED)
    if "max-filesize" in msg.lower():
        return ApiError(ErrorCode.TOO_LARGE)
    if _RE_UNAVAILABLE.search(msg):
        return ApiError(ErrorCode.UPSTREAM_ERROR, "That media isn't available from the source.")
    if isinstance(exc, YoutubeDLError | OSError):
        return ApiError(ErrorCode.UPSTREAM_ERROR)
    return ApiError(ErrorCode.INTERNAL)


# ------------------------------------------------------------ format safety


def is_image_format(f: Mapping[str, Any]) -> bool:
    return str(f.get("ext") or "").lower() in IMAGE_EXTS and not (f.get("duration") or 0) > 0


def has_video(f: Mapping[str, Any]) -> bool:
    if is_image_format(f):
        return False
    vcodec = f.get("vcodec")
    if vcodec is None:
        return str(f.get("ext") or "").lower() not in AUDIO_ONLY_EXTS
    return vcodec != "none"


def has_audio(f: Mapping[str, Any]) -> bool:
    if is_image_format(f):
        return False
    acodec = f.get("acodec")
    return True if acodec is None else acodec != "none"


def is_safe_format(f: Mapping[str, Any]) -> bool:
    """Drop DRM (True or 'maybe'), unsafe protocols/exts/URLs and fragment bombs."""
    if f.get("has_drm"):
        return False
    protocols = str(f.get("protocol") or "https").split("+")
    if not all(p in SAFE_PROTOCOLS for p in protocols):
        return False
    ext = str(f.get("ext") or "").lower()
    if ext and ext not in ALLOWED_INPUT_EXTS:
        return False
    n_frag = f.get("n_fragments")
    if n_frag is None:
        n_frag = len(f.get("fragments") or [])
    if n_frag > MAX_FRAGMENTS:
        return False
    if "url_ok" in f:
        return bool(f["url_ok"])
    return all(
        media_url_allowed(f.get(k)) for k in ("url", "manifest_url", "fragment_base_url")
    )


def selection_ctx(formats: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "formats": formats,
        "has_merged_format": any(
            "none" not in (f.get("acodec"), f.get("vcodec")) for f in formats
        ),
        "incomplete_formats": all(f.get("vcodec") == "none" for f in formats)
        or all(f.get("acodec") == "none" for f in formats),
    }


def safe_selector(ydl: Any, spec: str) -> Callable[[dict[str, Any]], Iterator[dict[str, Any]]]:
    """A yt-dlp format selector that drops unsafe formats, then applies ``spec``."""
    inner = ydl.build_format_selector(spec)

    def select(ctx: dict[str, Any]) -> Iterator[dict[str, Any]]:
        allowed = [f for f in ctx["formats"] if is_safe_format(f)]
        if not allowed:
            return iter(())
        return inner(selection_ctx(allowed))

    return select


# ---------------------------------------------------------------- slim info

_FORMAT_KEYS = ("format_id", "ext", "vcodec", "acodec", "width", "height", "fps", "abr", "tbr",
                "filesize", "filesize_approx", "has_drm", "protocol", "duration")
_INFO_KEYS = ("id", "_type", "extractor_key", "ie_key", "availability", "live_status",
              "is_live", "_has_drm", "duration", "width", "height", "ext", "direct")


def slim_format(f: Mapping[str, Any]) -> dict[str, Any]:
    out = {k: f.get(k) for k in _FORMAT_KEYS if f.get(k) is not None}
    out["n_fragments"] = len(f.get("fragments") or [])
    out["url_ok"] = all(
        media_url_allowed(f.get(k)) for k in ("url", "manifest_url", "fragment_base_url")
    ) and all(media_url_allowed(fr.get("url")) for fr in (f.get("fragments") or [])[:MAX_FRAGMENTS]
              if isinstance(fr, Mapping))
    return out


def _page_url(v: Any) -> str | None:
    return v if isinstance(v, str) and v.startswith(("http://", "https://")) else None


def slim_info(info: Mapping[str, Any], *, max_entries: int = 50, depth: int = 0) -> dict[str, Any]:
    """Untrusted info dict -> small JSON-safe summary. No raw media URLs leave the child."""
    out: dict[str, Any] = {k: info.get(k) for k in _INFO_KEYS if info.get(k) is not None}
    out["webpage_url"] = _page_url(info.get("webpage_url"))
    out["original_url"] = _page_url(info.get("original_url"))
    if info.get("_type") in ("url", "url_transparent"):
        out["url"] = _page_url(info.get("url"))
    out["title"] = clean_text(info.get("title"), 300)
    out["uploader"] = clean_text(info.get("uploader") or info.get("channel"), 100)
    thumb = info.get("thumbnail")
    out["thumbnail"] = thumb if isinstance(thumb, str) and thumb.startswith("https://") and (
        media_url_allowed(thumb)) else None
    formats = info.get("formats")
    if formats:
        out["formats"] = [slim_format(f) for f in formats if isinstance(f, Mapping)]
    elif info.get("url") and info.get("_type", "video") == "video":
        out["formats"] = [slim_format({**info, "format_id": info.get("format_id") or "0"})]
    entries = info.get("entries")
    if entries is not None and depth == 0:
        slim_entries = []
        for e in list(entries)[:max_entries]:
            if isinstance(e, Mapping):
                slim_entries.append(slim_info(e, depth=1))
        out["entries"] = slim_entries
    return out


# ---------------------------------------------------------- child operations


class TooLargeError(Exception):
    pass


class TooSlowError(Exception):
    pass


def run_extract(url: str, opts_cfg: Mapping[str, Any], factory: Any = None) -> dict[str, Any]:
    """Extract metadata (no download). Returns slim info."""
    import yt_dlp

    logger = RedactingLogger()
    opts = build_ydl_opts(logger=logger, **opts_cfg)
    opts.update(skip_download=True, simulate=True)
    with (factory or yt_dlp.YoutubeDL)(opts) as ydl:
        info = ydl.extract_info(url, download=False)
        if info is None:
            raise ApiError(ErrorCode.UNSUPPORTED_SITE)
        return slim_info(ydl.sanitize_info(info), max_entries=int(opts_cfg.get(
            "max_gallery_items", 50)))


class _Progress:
    """Progress + byte cap + throughput watchdog, raised from yt-dlp hooks."""

    def __init__(self, emit: Callable[[float], None], cap: int, parts: int,
                 clock: Callable[[], float] = time.monotonic) -> None:
        self.emit = emit
        self.cap = cap
        self.parts = max(1, parts)
        self.done_parts = 0
        self.done_bytes = 0
        self.clock = clock
        self.samples: deque[tuple[float, int]] = deque()
        self.last_emit = 0.0

    def hook(self, d: dict[str, Any]) -> None:
        from yt_dlp.utils import DownloadCancelled

        status = d.get("status")
        current = int(d.get("downloaded_bytes") or 0)
        total_bytes = self.done_bytes + current
        if total_bytes > self.cap:
            raise DownloadCancelled("too_large")
        now = self.clock()
        if status == "downloading":
            self.samples.append((now, total_bytes))
            while self.samples and now - self.samples[0][0] > THROUGHPUT_WINDOW_S:
                self.samples.popleft()
            t0, b0 = self.samples[0]
            if now - t0 >= THROUGHPUT_WINDOW_S * 0.9 and (total_bytes - b0) / (
                now - t0
            ) < MIN_THROUGHPUT_BPS:
                raise DownloadCancelled("too_slow")
            expected = d.get("total_bytes") or d.get("total_bytes_estimate")
            frac = min(current / expected, 1.0) if expected else 0.0
            if now - self.last_emit >= 0.5:
                self.last_emit = now
                self.emit(0.85 * (self.done_parts + frac) / self.parts)
        elif status == "finished":
            self.done_parts = min(self.done_parts + 1, self.parts)
            self.done_bytes += current or int(d.get("total_bytes") or 0)
            self.emit(0.85 * self.done_parts / self.parts)

    def pp_hook(self, d: dict[str, Any]) -> None:
        if d.get("status") == "started":
            self.emit(0.9)


_JOB_UUID = re.compile(r"^[A-Za-z0-9_-]{16,64}$")


def build_download_opts(
    preset: Mapping[str, Any], workdir: Path, job_uuid: str, opts_cfg: Mapping[str, Any],
    logger: Any, progress: _Progress,
) -> dict[str, Any]:
    if not _JOB_UUID.match(job_uuid):
        raise ValueError("invalid job uuid")
    opts = build_ydl_opts(logger=logger, **opts_cfg)
    opts.update(
        paths={"home": str(workdir), "temp": str(workdir)},
        outtmpl={"default": f"{job_uuid}.%(ext)s"},
        progress_hooks=[progress.hook],
        postprocessor_hooks=[progress.pp_hook],
        overwrites=True,
        keepvideo=False,
    )
    index = preset.get("playlist_index")
    if index is not None:
        opts.update(noplaylist=False, extract_flat=False, playlist_items=str(int(index)))
    mode = preset["mode"]
    if mode == "video":
        opts["merge_output_format"] = "mp4"
        opts["postprocessors"] = [{"key": "FFmpegVideoRemuxer", "preferedformat": "mp4"}]
    elif mode == "audio_mp3":
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "mp3",
                                   "preferredquality": str(MP3_KBPS)}]
    elif mode == "audio_m4a":
        opts["postprocessors"] = [{"key": "FFmpegExtractAudio", "preferredcodec": "m4a"}]
    elif mode != "image":
        raise ValueError("unknown preset mode")
    return opts


_IMAGE_MAGIC = {
    "jpg": (b"\xff\xd8\xff",), "jpeg": (b"\xff\xd8\xff",), "png": (b"\x89PNG\r\n\x1a\n",),
    "gif": (b"GIF87a", b"GIF89a"), "webp": (b"RIFF",),
}


def find_output(workdir: Path, job_uuid: str) -> Path | None:
    """The produced file: named {job_uuid}.{ext}, regular, inside workdir, allowed ext."""
    root = workdir.resolve()
    for p in sorted(workdir.iterdir()):
        if not p.name.startswith(job_uuid + "."):
            continue
        ext = p.name[len(job_uuid) + 1 :].lower()
        if ext not in OUTPUT_EXTS:
            continue
        st = os.lstat(p)
        if not stat.S_ISREG(st.st_mode):
            continue
        if not p.resolve().is_relative_to(root):
            continue
        return p
    return None


def validate_output(path: Path, mode: str, ffmpeg_location: str | None) -> None:
    ext = path.suffix.lstrip(".").lower()
    if mode == "image":
        with path.open("rb") as fh:
            head = fh.read(16)
        if not any(head.startswith(m) for m in _IMAGE_MAGIC.get(ext, ())):
            raise ApiError(ErrorCode.UNSUPPORTED_SITE, "The source didn't return a valid image.")
        return
    ffprobe = _find_ffprobe(ffmpeg_location)
    if ffprobe is None:
        return  # dev without ffprobe: rely on yt-dlp/ffmpeg having produced the file
    try:
        res = subprocess.run(  # noqa: S603 - fixed argv, no shell
            [ffprobe, "-v", "error", "-show_entries", "stream=codec_type", "-of", "csv=p=0",
             str(path)], capture_output=True, text=True, timeout=30, check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as e:
        raise ApiError(ErrorCode.UPSTREAM_ERROR, "We couldn't verify the media file.") from e
    streams = set(res.stdout.split())
    wanted = {"audio"} if mode.startswith("audio") else {"video", "audio"}
    if res.returncode != 0 or not streams & wanted:
        raise ApiError(ErrorCode.UPSTREAM_ERROR, "The source returned an invalid media file.")


def _find_ffprobe(ffmpeg_location: str | None) -> str | None:
    if ffmpeg_location:
        base = Path(ffmpeg_location)
        cand = (base if base.is_dir() else base.parent) / "ffprobe"
        if cand.is_file():
            return str(cand)
    return shutil.which("ffprobe")


def run_download(
    url: str,
    preset: Mapping[str, Any],
    workdir: Path,
    job_uuid: str,
    opts_cfg: Mapping[str, Any],
    *,
    emit_progress: Callable[[float], None],
    approve_info: Callable[[dict[str, Any]], bool],
    factory: Any = None,
) -> dict[str, Any]:
    """Fresh extraction, parent approval (policy re-check), then download."""
    import yt_dlp
    from yt_dlp.utils import DownloadCancelled

    logger = RedactingLogger()
    cap = int(opts_cfg.get("max_filesize", 4 * 1024**3))
    spec = str(preset["spec"])
    progress = _Progress(emit_progress, cap, parts=spec.split("/")[0].count("+") + 1)
    opts = build_download_opts(preset, workdir, job_uuid, opts_cfg, logger, progress)
    try:
        with (factory or yt_dlp.YoutubeDL)(opts) as ydl:
            selector = safe_selector(ydl, spec)
            ydl.params["format"] = selector
            ydl.format_selector = selector
            raw = ydl.extract_info(url, download=False, process=False)
            if raw is None:
                raise ApiError(ErrorCode.UNSUPPORTED_SITE)
            if not approve_info(slim_info(raw)):
                raise ApiError(ErrorCode.INTERNAL, "Job was cancelled.")
            processed = ydl.process_ie_result(raw, download=True) or raw
    except DownloadCancelled as e:
        if "too_large" in str(e):
            raise ApiError(ErrorCode.TOO_LARGE) from e
        if "too_slow" in str(e):
            raise ApiError(ErrorCode.UPSTREAM_ERROR, "The source is sending data too slowly.") \
                from e
        raise ApiError(ErrorCode.UPSTREAM_ERROR) from e

    path = find_output(workdir, job_uuid)
    if path is None:
        if logger.saw("max-filesize"):
            raise ApiError(ErrorCode.TOO_LARGE)
        raise ApiError(ErrorCode.UPSTREAM_ERROR, "The source didn't return any media.")
    if path.stat().st_size > cap:
        raise ApiError(ErrorCode.TOO_LARGE)
    validate_output(path, str(preset["mode"]), opts_cfg.get("ffmpeg_location"))
    title = _title_of(processed, preset.get("playlist_index"))
    emit_progress(0.95)
    return {"path": str(path), "title": clean_text(title, 300) or "download",
            "ext": path.suffix.lstrip(".").lower(), "size": path.stat().st_size}


def _title_of(info: Mapping[str, Any], index: Any) -> str:
    if index is not None:
        entries = [e for e in (info.get("entries") or []) if isinstance(e, Mapping)]
        if entries:
            return str(entries[0].get("title") or info.get("title") or "download")
    return str(info.get("title") or info.get("id") or "download")
