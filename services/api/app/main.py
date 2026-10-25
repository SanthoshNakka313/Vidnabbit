"""VidNabbit API (v1). See docs/00-project-brief.md for the contract.

Run: ``uvicorn app.main:create_app --factory --port 8000``
"""

from __future__ import annotations

import datetime as dt
import ipaddress
import logging
import secrets
import time
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import Annotated, Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, StringConstraints
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from app.cache import TTLCache
from app.config import Settings, get_settings
from app.errors import ApiError, ErrorCode
from app.extractor import Extractor, ExtractResult, resolve_ffmpeg_location
from app.jobs import JobRunner
from app.policy import JsonFileBlocklist, KillSwitches, Limits, Policy, canonicalize_url
from app.ratelimit import DAY, HOUR, MINUTE, ByteQuota, ClientHasher, RateLimiter, Rule
from app.sandbox import Sandbox, SandboxLimits
from app.ssrf import SSRFError, avalidate_url, set_extra_denied_networks
from app.storage import LocalStorage, R2Storage, Storage, TokenError, content_disposition
from app.takedown import TakedownRequest, TakedownStore
from app.turnstile import TurnstileVerifier

log = logging.getLogger("vidnabbit")

NEGATIVE_CACHE_CODES = {
    ErrorCode.UNSUPPORTED_SITE, ErrorCode.DRM_PROTECTED, ErrorCode.LOGIN_REQUIRED,
    ErrorCode.PRIVATE_CONTENT,
}
# Big platforms are exempt from the per-destination-host limit (it protects small sites).
MAJOR_HOSTS = ("youtube.com", "youtu.be", "vimeo.com", "dailymotion.com", "soundcloud.com",
               "twitter.com", "x.com", "instagram.com", "tiktok.com", "reddit.com",
               "facebook.com", "twitch.tv", "archive.org", "wikimedia.org", "bandcamp.com")
MEDIA_TYPES = {
    "mp4": "video/mp4", "webm": "video/webm", "mkv": "video/x-matroska", "m4a": "audio/mp4",
    "mp3": "audio/mpeg", "opus": "audio/ogg", "ogg": "audio/ogg", "jpg": "image/jpeg",
    "jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "gif": "image/gif",
}
SECURITY_HEADERS = [
    (b"cache-control", b"no-store"),
    (b"x-content-type-options", b"nosniff"),
    (b"referrer-policy", b"no-referrer"),
    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'"),
    (b"x-frame-options", b"DENY"),
]


# ------------------------------------------------------------------ models


class ExtractRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    url: Annotated[str, StringConstraints(min_length=1, max_length=2048)]
    turnstile_token: Annotated[str, StringConstraints(max_length=2048)] | None = None


class JobRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    extract_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    format_id: Annotated[str, StringConstraints(min_length=1, max_length=64)]
    turnstile_token: Annotated[str, StringConstraints(max_length=2048)] | None = None


@dataclass
class ExtractRecord:
    result: ExtractResult
    client: str
    expires_at: float


def error_response(err: ApiError) -> JSONResponse:
    return JSONResponse(err.body(), status_code=err.status, headers=err.headers)


def iso(ts: float) -> str:
    return dt.datetime.fromtimestamp(ts, dt.UTC).isoformat(timespec="seconds").replace(
        "+00:00", "Z")


# --------------------------------------------------------------- middleware


class GuardMiddleware:
    """Pure ASGI: JSON-only POSTs, body size caps, security headers, access log."""

    def __init__(self, app: ASGIApp, settings: Settings, hasher: ClientHasher) -> None:
        self.app = app
        self.settings = settings
        self.hasher = hasher

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        start = time.monotonic()
        path: str = scope.get("path", "")
        method: str = scope.get("method", "GET")
        status_holder = {"status": 500}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = message["status"]
                headers = list(message.get("headers", []))
                present = {k.lower() for k, _ in headers}
                headers += [(k, v) for k, v in SECURITY_HEADERS if k not in present]
                message["headers"] = headers
            await send(message)

        try:
            if method == "POST":
                limit = (self.settings.max_takedown_body_bytes if path == "/v1/takedown"
                         else self.settings.max_body_bytes)
                headers = {k.lower(): v for k, v in scope.get("headers", [])}
                ctype = headers.get(b"content-type", b"").split(b";")[0].strip().lower()
                if ctype != b"application/json":
                    await self._reject(send_wrapper, 415, "Requests must be JSON.")
                    return
                try:
                    declared = int(headers.get(b"content-length", b"0") or 0)
                except ValueError:
                    declared = 0
                if declared > limit:
                    await self._reject(send_wrapper, 413, "Request body too large.")
                    return
                receive = self._limited_receive(receive, limit)
            await self.app(scope, receive, send_wrapper)
        except _BodyTooLarge:
            await self._reject(send_wrapper, 413, "Request body too large.")
        finally:
            client = scope.get("client") or ("", 0)
            log.info("request method=%s path=%s status=%s ms=%d ip_h=%s", method,
                     _route_label(path), status_holder["status"],
                     (time.monotonic() - start) * 1000, self.hasher.log_id(client[0] or ""))

    @staticmethod
    def _limited_receive(receive: Receive, limit: int) -> Receive:
        seen = 0

        async def wrapped() -> Message:
            nonlocal seen
            message = await receive()
            if message["type"] == "http.request":
                seen += len(message.get("body", b""))
                if seen > limit:
                    raise _BodyTooLarge
            return message

        return wrapped

    @staticmethod
    async def _reject(send: Send, status: int, message: str) -> None:
        err = ApiError(ErrorCode.INVALID_REQUEST, message, status=status)
        await error_response(err)({"type": "http"}, _empty_receive, send)


class _BodyTooLarge(Exception):
    pass


async def _empty_receive() -> Message:
    return {"type": "http.request", "body": b"", "more_body": False}


def _route_label(path: str) -> str:
    """Log route templates, never tokens or ids."""
    for prefix in ("/v1/jobs/", "/v1/files/"):
        if path.startswith(prefix) and len(path) > len(prefix):
            return prefix + "{id}"
    return path[:64]


# ---------------------------------------------------------------- services


@dataclass
class Services:
    settings: Settings
    policy: Policy
    extractor: Any  # Extractor-compatible: async extract(url) / download(...)
    storage: Storage
    runner: JobRunner
    limiter: RateLimiter
    bytes_quota: ByteQuota
    hasher: ClientHasher
    turnstile: TurnstileVerifier
    takedowns: TakedownStore
    extract_cache: TTLCache[ExtractResult]
    negative_cache: TTLCache[ApiError]
    extracts: TTLCache[ExtractRecord]
    trusted_proxies: list[ipaddress.IPv4Network | ipaddress.IPv6Network]


def build_services(settings: Settings, extractor: Any | None = None,
                   storage: Storage | None = None) -> Services:
    set_extra_denied_networks(settings.extra_denied_list)
    blocklist = JsonFileBlocklist(settings.blocklist_path)
    policy = Policy(
        blocklist,
        Limits(settings.max_duration_seconds, settings.max_filesize_bytes),
        KillSwitches(
            extraction_enabled=settings.extraction_enabled,
            disabled_extractors=frozenset(
                s.lower() for s in settings.disabled_extractors.split(",") if s.strip()),
            disabled_domains=frozenset(
                s.strip().lower() for s in settings.disabled_domains.split(",") if s.strip()),
        ),
    )
    work_dir = settings.work_dir.resolve()
    if extractor is None:
        sandbox = Sandbox(
            home=work_dir / ".home",
            proxy_url=settings.egress_proxy_url,
            limits=SandboxLimits(cpu_seconds=int(settings.job_timeout_seconds),
                                 file_size_bytes=int(settings.max_filesize_bytes * 1.05)),
        )
        opts_cfg = {
            "socket_timeout": settings.socket_timeout_seconds,
            "ffmpeg_location": resolve_ffmpeg_location(settings.ffmpeg_location,
                                                       work_dir / ".bin"),
            "proxy": settings.egress_proxy_url,
            "max_filesize": settings.max_filesize_bytes,
            "max_gallery_items": settings.max_gallery_items,
            "extra_denied": settings.extra_denied_list,
        }
        extractor = Extractor(
            policy, sandbox, opts_cfg=opts_cfg,
            extract_timeout=settings.extract_timeout_seconds,
            job_timeout=settings.job_timeout_seconds,
            max_extract_concurrency=settings.extract_max_concurrency,
            max_gallery_items=settings.max_gallery_items,
        )
    if storage is None:
        if settings.storage_backend == "r2":
            storage = R2Storage()
        else:
            storage = LocalStorage(settings.storage_dir, settings.signing_key(),
                                   settings.public_base_url)
    bytes_quota = ByteQuota(settings.bytes_per_client_hour, settings.bytes_per_client_day)
    runner = JobRunner(
        extractor, storage, work_dir=work_dir,
        concurrency=settings.worker_concurrency,
        max_queue_depth=settings.max_queue_depth,
        max_active_per_client=settings.max_active_jobs_per_client,
        file_ttl_seconds=settings.file_ttl_seconds,
        max_queue_wait_seconds=settings.job_queue_max_wait_seconds,
        janitor_interval_seconds=settings.janitor_interval_seconds,
        on_complete=bytes_quota.add,
    )
    return Services(
        settings=settings, policy=policy, extractor=extractor, storage=storage, runner=runner,
        limiter=RateLimiter(), bytes_quota=bytes_quota,
        hasher=ClientHasher(settings.ip_key()), turnstile=TurnstileVerifier(settings),
        takedowns=TakedownStore(settings.takedown_path),
        extract_cache=TTLCache(settings.extract_cache_ttl_seconds,
                               settings.extract_cache_max_entries),
        negative_cache=TTLCache(300, settings.extract_cache_max_entries),
        extracts=TTLCache(settings.extract_ttl_seconds, settings.extract_cache_max_entries * 4),
        trusted_proxies=[ipaddress.ip_network(c, strict=False)
                         for c in settings.trusted_proxy_list],
    )


# ---------------------------------------------------------------------- app


def create_app(settings: Settings | None = None, *, extractor: Any | None = None,
               storage: Storage | None = None) -> FastAPI:
    settings = settings or get_settings()
    logging.basicConfig(level=settings.log_level.upper(),
                        format="%(asctime)s %(levelname)s %(name)s %(message)s")
    svc = build_services(settings, extractor=extractor, storage=storage)

    @asynccontextmanager
    async def lifespan(_app: FastAPI):
        await svc.runner.start()
        try:
            yield
        finally:
            await svc.runner.stop()
            await svc.turnstile.aclose()

    docs = not settings.is_production
    app = FastAPI(
        title="VidNabbit API", version="1.0.0", lifespan=lifespan,
        docs_url="/docs" if docs else None, redoc_url=None,
        openapi_url="/openapi.json" if docs else None,
    )
    app.state.services = svc
    # Last added = outermost: CORS wraps the guard so its 413/415 replies get CORS headers.
    app.add_middleware(GuardMiddleware, settings=settings, hasher=svc.hasher)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origin_list, allow_credentials=False,
        allow_methods=["GET", "POST"], allow_headers=["Content-Type"], max_age=600,
    )

    # ---------------------------------------------------------- handlers
    @app.exception_handler(ApiError)
    async def _api_error(_req: Request, exc: ApiError) -> JSONResponse:
        return error_response(exc)

    @app.exception_handler(RequestValidationError)
    async def _validation(req: Request, exc: RequestValidationError) -> JSONResponse:
        locs = {str(p) for e in exc.errors() for p in e.get("loc", ())}
        if locs & {"url", "urls"} and req.url.path in ("/v1/extract", "/v1/takedown"):
            return error_response(ApiError(ErrorCode.INVALID_URL))
        fields = sorted(locs - {"body"})[:5]
        msg = "Invalid request" + (f": check {', '.join(fields)}." if fields else ".")
        return error_response(ApiError(ErrorCode.INVALID_REQUEST, msg, status=422))

    @app.exception_handler(404)
    async def _not_found(_req: Request, _exc: Exception) -> JSONResponse:
        return error_response(ApiError(ErrorCode.NOT_FOUND))

    @app.exception_handler(405)
    async def _method(_req: Request, _exc: Exception) -> JSONResponse:
        return error_response(ApiError(ErrorCode.NOT_FOUND, status=405))

    @app.exception_handler(Exception)
    async def _unhandled(_req: Request, exc: Exception) -> JSONResponse:
        log.error("unhandled error type=%s", type(exc).__name__, exc_info=exc)
        return error_response(ApiError(ErrorCode.INTERNAL))

    # ------------------------------------------------------------- helpers
    def client_ip(req: Request) -> str:
        peer = req.client.host if req.client else ""
        cf = req.headers.get("cf-connecting-ip")
        if cf and svc.trusted_proxies:
            try:
                peer_ip = ipaddress.ip_address(peer)
                if any(peer_ip in n for n in svc.trusted_proxies):
                    return str(ipaddress.ip_address(cf.strip()))
            except ValueError:
                pass
        return peer

    # ------------------------------------------------------------ routes
    @app.get("/v1/health")
    async def health() -> dict[str, bool]:
        return {"ok": True}

    @app.post("/v1/extract")
    async def extract(body: ExtractRequest, req: Request) -> dict[str, Any]:
        ip = client_ip(req)
        client = svc.hasher.client_id(ip)
        recent = svc.limiter.count(f"extract10m:{client}", 600)
        svc.limiter.hit(client, [
            Rule("extract_m", settings.rate_extract_per_minute, MINUTE),
            Rule("extract_h", settings.rate_extract_per_hour, HOUR),
            Rule("extract_d", settings.rate_extract_per_day, DAY),
        ])
        if recent >= settings.extract_soft_threshold:
            await svc.turnstile.verify(body.turnstile_token, action="extract", remote_ip=ip)
        svc.limiter.hit(client, [Rule("extract10m", 10**9, 600)])

        try:
            checked = await avalidate_url(body.url, timeout=settings.dns_timeout_seconds)
        except SSRFError as e:
            log.info("extract refused reason=ssrf detail=%s", e.reason)
            raise ApiError(ErrorCode.INVALID_URL) from None
        svc.policy.check_url(checked.url)
        canonical = canonicalize_url(checked.url)

        result = svc.extract_cache.get(canonical)
        if result is None:
            negative = svc.negative_cache.get(canonical)
            if negative is not None:
                raise negative
            if not any(checked.host == h or checked.host.endswith("." + h) for h in MAJOR_HOSTS):
                svc.limiter.hit(checked.host, [Rule("domain", settings.rate_domain_per_minute,
                                                    MINUTE)],
                                message="This site is getting a lot of requests. Try later.")
            try:
                result = await svc.extractor.extract(checked.url)
            except ApiError as e:
                if e.code in NEGATIVE_CACHE_CODES:
                    svc.negative_cache.set(canonical, e)
                log.info("extract refused host=%s code=%s", checked.host, e.code)
                raise
            svc.extract_cache.set(canonical, result)
        else:
            svc.policy.check_url(result.webpage_url)  # a takedown may have arrived

        extract_id = secrets.token_urlsafe(16)
        expires_at = time.time() + settings.extract_ttl_seconds
        svc.extracts.set(extract_id, ExtractRecord(result, client, expires_at))
        log.info("extract ok host=%s site=%s formats=%d", checked.host, result.source_site,
                 len(result.presets))
        return {
            "id": extract_id,
            "source": {"site": result.source_site, "url": result.source_url},
            "title": result.title,
            "uploader": result.uploader,
            "duration_seconds": result.duration_seconds,
            "thumbnail_url": result.thumbnail_url,
            "media_type": result.media_type,
            "formats": [p.public for p in result.presets],
            "expires_at": iso(expires_at),
        }

    @app.post("/v1/jobs", status_code=202)
    async def create_job(body: JobRequest, req: Request) -> dict[str, str]:
        ip = client_ip(req)
        client = svc.hasher.client_id(ip)
        svc.limiter.hit(client, [
            Rule("jobs_m", settings.rate_jobs_per_minute, MINUTE),
            Rule("jobs_h", settings.rate_jobs_per_hour, HOUR),
            Rule("jobs_d", settings.rate_jobs_per_day, DAY),
        ])
        record = svc.extracts.get(body.extract_id)
        if record is None or (settings.bind_extract_to_client and record.client != client):
            raise ApiError(ErrorCode.NOT_FOUND, "This link has expired. Please paste it again.")
        preset = record.result.preset(body.format_id)
        if preset is None:
            raise ApiError(ErrorCode.INVALID_REQUEST, "Unknown format for this link.")
        svc.bytes_quota.check(client, int(preset.public.get("filesize_bytes") or 0))
        svc.runner.check_capacity(client)
        await svc.turnstile.verify(body.turnstile_token, action="job", remote_ip=ip)
        svc.policy.check_url(record.result.webpage_url)
        job = svc.runner.submit(client, record.result.webpage_url, preset)
        return {"job_id": job.id}

    @app.get("/v1/jobs/{job_id}")
    async def get_job(job_id: str, req: Request) -> dict[str, Any]:
        client = svc.hasher.client_id(client_ip(req))
        svc.limiter.hit(client, [Rule("status", settings.rate_job_status_per_minute, MINUTE)])
        job = svc.runner.get(job_id)
        if job is None:
            raise ApiError(ErrorCode.NOT_FOUND, "Job not found or expired.")
        return job.public()

    @app.get("/v1/files/{token}")
    async def get_file(token: str, req: Request) -> FileResponse:
        if not isinstance(svc.storage, LocalStorage):
            raise ApiError(ErrorCode.NOT_FOUND)
        client = svc.hasher.client_id(client_ip(req))
        svc.limiter.hit(client, [Rule("files", settings.rate_files_per_minute, MINUTE)])
        try:
            key = _verify(svc, token)
        except TokenError:
            raise ApiError(ErrorCode.NOT_FOUND, "This download link has expired.") from None
        found = svc.storage.resolve(key)
        if found is None:
            raise ApiError(ErrorCode.NOT_FOUND, "This download link has expired.")
        path, filename = found
        return FileResponse(
            path,
            media_type=MEDIA_TYPES.get(path.suffix.lstrip(".").lower(),
                                       "application/octet-stream"),
            headers={"Content-Disposition": content_disposition(filename),
                     "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"},
        )

    @app.post("/v1/takedown", status_code=202)
    async def takedown(body: TakedownRequest, req: Request) -> dict[str, Any]:
        ip = client_ip(req)
        client = svc.hasher.client_id(ip)
        svc.limiter.hit(client, [
            Rule("takedown_h", settings.rate_takedown_per_hour, HOUR),
            Rule("takedown_d", settings.rate_takedown_per_day, DAY),
        ])
        if settings.turnstile_require_takedown or body.turnstile_token:
            await svc.turnstile.verify(body.turnstile_token, action="takedown", remote_ip=ip)
        record_id = svc.takedowns.save(body)
        svc.policy.blocklist.add_urls(body.urls)  # provisional block (docs/03 2.9)
        for url in body.urls:
            svc.extract_cache.pop(canonicalize_url(url))
        log.info("takedown received id=%s urls=%d", record_id, len(body.urls))
        return {"ok": True, "id": record_id}

    return app


def _verify(svc: Services, token: str) -> str:
    from app.storage import verify_token

    return verify_token(svc.settings.signing_key(), token)

