"""Runtime configuration from environment variables (names follow docs/02 section 8)."""

from __future__ import annotations

import logging
import os
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, PrivateAttr, SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

log = logging.getLogger(__name__)

# Cloudflare's documented Turnstile test secret keys. They accept only the dummy
# token "XXXX.DUMMY.TOKEN.XXXX" and must never be used in production.
TURNSTILE_TEST_SECRETS = {
    "1x0000000000000000000000000000000AA": "pass",
    "2x0000000000000000000000000000000AA": "fail",
    "3x0000000000000000000000000000000AA": "spent",
}
TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX"  # noqa: S105 - public test value

MAX_FILE_TTL_SECONDS = 3600  # Safeguard 5


def _csv(value: str) -> list[str]:
    return [v.strip() for v in value.split(",") if v.strip()]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    _signing_key: bytes = PrivateAttr(default=b"")
    _ip_key: bytes = PrivateAttr(default=b"")

    app_env: Literal["development", "test", "production"] = Field(
        "development", validation_alias=AliasChoices("APP_ENV", "ENV")
    )
    log_level: str = "INFO"

    # HTTP
    cors_origins: str = "http://localhost:3000"  # exact origins, comma-separated
    public_base_url: str = "http://localhost:8000"  # base for local download URLs
    trusted_proxy_cidrs: str = ""  # peers allowed to set CF-Connecting-IP (e.g. CF ranges)
    max_body_bytes: int = 4 * 1024
    max_takedown_body_bytes: int = 32 * 1024

    # Secrets
    signing_secret: SecretStr | None = None  # HMAC key for local download tokens
    ip_hash_key_seed: SecretStr | None = None  # master pepper for hashed client IPs

    # Egress (required in production; docs/03 3.5)
    egress_proxy_url: str | None = None
    extra_denied_networks: str = ""  # our own public IPs, provider private ranges

    # Turnstile
    turnstile_enabled: bool = True
    turnstile_secret: SecretStr = SecretStr("1x0000000000000000000000000000000AA")
    turnstile_expected_hostname: str | None = None  # required in production
    turnstile_verify_url: str = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
    turnstile_timeout_seconds: float = 5.0
    turnstile_require_takedown: bool = False  # flip on once the web form sends a token

    # Storage / dirs
    storage_backend: Literal["local", "r2"] = "local"
    r2_account_id: str | None = None
    r2_access_key_id: str | None = None
    r2_secret_access_key: SecretStr | None = None
    r2_bucket: str | None = None
    r2_endpoint_url: str | None = None  # override (tests, S3-compatible dev servers)
    data_dir: Path = Path(".data")
    blocklist_file: Path | None = None  # default data_dir/blocklist.json
    takedown_file: Path | None = None  # default data_dir/takedowns.jsonl
    file_ttl_seconds: int = MAX_FILE_TTL_SECONDS
    janitor_interval_seconds: int = 60

    # Extraction / download
    ffmpeg_location: str | None = None
    extract_ttl_seconds: int = 1800  # extract_id lifetime (= expires_at)
    extract_cache_ttl_seconds: int = 600
    extract_cache_max_entries: int = 500
    extract_timeout_seconds: float = 30.0
    extract_max_concurrency: int = 8
    dns_timeout_seconds: float = 3.0
    socket_timeout_seconds: float = 15.0
    job_timeout_seconds: float = 1800.0
    job_queue_max_wait_seconds: float = 600.0
    worker_concurrency: int = 2
    max_queue_depth: int = 200
    max_active_jobs_per_client: int = 2
    bind_extract_to_client: bool = True
    max_duration_seconds: int = 3 * 3600
    max_filesize_bytes: int = 4 * 1024**3
    max_gallery_items: int = 50

    # Kill switches
    extraction_enabled: bool = True
    disabled_extractors: str = ""
    disabled_domains: str = ""

    # Rate limits (per hashed client IP; IPv6 per /64)
    rate_extract_per_minute: int = 10
    rate_extract_per_hour: int = 60
    rate_extract_per_day: int = 300
    extract_soft_threshold: int = 5  # > this many in 10 min -> Turnstile required
    rate_jobs_per_minute: int = 3
    rate_jobs_per_hour: int = 20
    rate_jobs_per_day: int = 100
    rate_job_status_per_minute: int = 120
    rate_takedown_per_hour: int = 5
    rate_takedown_per_day: int = 20
    rate_files_per_minute: int = 30
    rate_domain_per_minute: int = 30  # global, per destination host (non-major sites)
    bytes_per_client_hour: int = 8 * 1024**3
    bytes_per_client_day: int = 20 * 1024**3

    @field_validator("file_ttl_seconds")
    @classmethod
    def _cap_ttl(cls, v: int) -> int:
        if not 60 <= v <= MAX_FILE_TTL_SECONDS:
            raise ValueError(f"file_ttl_seconds must be between 60 and {MAX_FILE_TTL_SECONDS}")
        return v

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def cors_origin_list(self) -> list[str]:
        return _csv(self.cors_origins)

    @property
    def trusted_proxy_list(self) -> list[str]:
        return _csv(self.trusted_proxy_cidrs)

    @property
    def extra_denied_list(self) -> list[str]:
        return _csv(self.extra_denied_networks)

    @property
    def storage_dir(self) -> Path:
        return self.data_dir / "downloads"

    @property
    def work_dir(self) -> Path:
        return self.data_dir / "work"

    @property
    def blocklist_path(self) -> Path:
        return self.blocklist_file or self.data_dir / "blocklist.json"

    @property
    def takedown_path(self) -> Path:
        return self.takedown_file or self.data_dir / "takedowns.jsonl"

    @property
    def turnstile_test_mode(self) -> str | None:
        return TURNSTILE_TEST_SECRETS.get(self.turnstile_secret.get_secret_value())

    def signing_key(self) -> bytes:
        return self._signing_key

    def ip_key(self) -> bytes:
        return self._ip_key

    def model_post_init(self, __context: object) -> None:
        if self.is_production:
            problems = []
            if self.signing_secret is None:
                problems.append("SIGNING_SECRET is required")
            if self.ip_hash_key_seed is None:
                problems.append("IP_HASH_KEY_SEED is required")
            if not self.egress_proxy_url:
                problems.append("EGRESS_PROXY_URL is required (docs/03 3.5)")
            if self.turnstile_test_mode or not self.turnstile_enabled:
                problems.append("a real TURNSTILE_SECRET must be configured and enabled")
            if not self.turnstile_expected_hostname:
                problems.append("TURNSTILE_EXPECTED_HOSTNAME is required")
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                problems.append("refusing to run as root")
            if self.storage_backend == "local":
                problems.append("STORAGE_BACKEND=local is for development only")
            if problems:
                raise ValueError("Invalid production configuration: " + "; ".join(problems))
        if self.storage_backend == "r2":
            needed = ["r2_bucket", "r2_access_key_id", "r2_secret_access_key"]
            if not self.r2_endpoint_url:
                needed.append("r2_account_id")
            missing = [n.upper() for n in needed if not getattr(self, n)]
            if missing:
                raise ValueError("STORAGE_BACKEND=r2 needs " + ", ".join(missing))
        key = self.signing_secret.get_secret_value() if self.signing_secret else None
        seed = self.ip_hash_key_seed.get_secret_value() if self.ip_hash_key_seed else None
        self._signing_key = (key or secrets.token_urlsafe(32)).encode()
        self._ip_key = (seed or secrets.token_urlsafe(32)).encode()


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    s = Settings()
    if s.signing_secret is None:
        log.warning("SIGNING_SECRET not set; using an ephemeral key (development only)")
    return s
