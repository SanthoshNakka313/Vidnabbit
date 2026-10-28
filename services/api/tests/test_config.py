"""Production refuses unsafe configuration; TTL can never exceed 3 minutes (Safeguard 5)."""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from app.config import Settings


def test_production_requires_secrets_proxy_and_real_turnstile() -> None:
    with pytest.raises(ValidationError) as ei:
        Settings(app_env="production", _env_file=None)
    msg = str(ei.value)
    for needle in ("SIGNING_SECRET", "IP_HASH_KEY_SEED", "EGRESS_PROXY_URL", "TURNSTILE_SECRET",
                   "TURNSTILE_EXPECTED_HOSTNAME", "STORAGE_BACKEND=local"):
        assert needle in msg


@pytest.mark.parametrize("ttl", [59, 181, 3600])
def test_file_ttl_is_capped(ttl: int) -> None:
    with pytest.raises(ValidationError):
        Settings(file_ttl_seconds=ttl, _env_file=None)


def test_dev_generates_ephemeral_keys() -> None:
    a, b = Settings(_env_file=None), Settings(_env_file=None)
    assert a.signing_key() and a.signing_key() != b.signing_key()
    fixed = Settings(signing_secret="s3cret", _env_file=None)
    assert fixed.signing_key() == b"s3cret"
