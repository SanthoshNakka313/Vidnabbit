"""Cloudflare Turnstile server-side verification (docs/03 4.2-4.3).

With one of Cloudflare's documented *test* secrets, verification is emulated
locally (no network): the always-pass secret accepts only the dummy token
``XXXX.DUMMY.TOKEN.XXXX``; the always-fail and token-spent secrets reject
everything. Production refuses to start with a test secret (see config).
"""

from __future__ import annotations

import datetime as dt
import hashlib
import logging
import time
import uuid
from typing import Any

import httpx

from app.cache import TTLCache
from app.config import TURNSTILE_DUMMY_TOKEN, Settings
from app.errors import ApiError, ErrorCode

log = logging.getLogger(__name__)
MAX_TOKEN_AGE_SECONDS = 300


class TurnstileVerifier:
    def __init__(self, settings: Settings, client: httpx.AsyncClient | None = None) -> None:
        self.settings = settings
        self._client = client
        self._seen = TTLCache[bool](ttl=600, max_entries=100_000)

    def _http(self) -> httpx.AsyncClient:
        if self._client is None:
            self._client = httpx.AsyncClient(
                timeout=self.settings.turnstile_timeout_seconds,
                proxy=self.settings.egress_proxy_url or None,
                trust_env=False,
                follow_redirects=False,
            )
        return self._client

    async def aclose(self) -> None:
        if self._client is not None:
            await self._client.aclose()

    async def verify(self, token: str | None, *, action: str, remote_ip: str | None) -> None:
        """Raise ApiError unless ``token`` is a fresh, valid token for ``action``."""
        if not self.settings.turnstile_enabled:
            return
        if not token or len(token) > 2048:
            raise ApiError(ErrorCode.CHALLENGE_REQUIRED)
        mode = self.settings.turnstile_test_mode
        if mode is not None:
            if mode == "pass" and token == TURNSTILE_DUMMY_TOKEN:
                return
            raise ApiError(ErrorCode.CHALLENGE_REQUIRED)

        digest = hashlib.sha256(token.encode()).hexdigest()
        if self._seen.get(digest):
            raise ApiError(ErrorCode.CHALLENGE_REQUIRED)
        data = {
            "secret": self.settings.turnstile_secret.get_secret_value(),
            "response": token,
            "idempotency_key": str(uuid.uuid4()),
        }
        if remote_ip:
            data["remoteip"] = remote_ip
        try:
            resp = await self._http().post(self.settings.turnstile_verify_url, data=data)
            body: dict[str, Any] = resp.json()
        except (httpx.HTTPError, ValueError) as e:
            log.warning("turnstile siteverify unavailable: %s", type(e).__name__)
            raise ApiError(ErrorCode.UPSTREAM_ERROR, "Verification is unavailable right now.",
                           status=503) from e
        if not self._accept(body, action):
            log.info("turnstile rejected codes=%s", body.get("error-codes"))
            raise ApiError(ErrorCode.CHALLENGE_REQUIRED)
        self._seen.set(digest, True)

    def _accept(self, body: dict[str, Any], action: str) -> bool:
        if body.get("success") is not True:
            return False
        expected_host = self.settings.turnstile_expected_hostname
        if expected_host and body.get("hostname") != expected_host:
            return False
        if body.get("action") != action:
            return False
        ts = body.get("challenge_ts")
        if isinstance(ts, str):
            try:
                issued = dt.datetime.fromisoformat(ts.replace("Z", "+00:00"))
            except ValueError:
                return False
            if time.time() - issued.timestamp() > MAX_TOKEN_AGE_SECONDS:
                return False
        return True
