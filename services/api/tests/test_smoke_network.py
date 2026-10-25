"""Live smoke tests through the real sandboxed extractor. Deselected by default.

Run: ``uv run pytest -m network``. Uses Creative Commons media only.
"""

from __future__ import annotations

from pathlib import Path

import pytest

from app.config import Settings
from app.errors import ApiError
from app.main import build_services

pytestmark = [pytest.mark.network, pytest.mark.anyio]

BIG_BUCK_BUNNY = "https://www.youtube.com/watch?v=aqz-KE-bpKQ"  # Blender Foundation, CC BY 3.0


@pytest.fixture
def services(tmp_path: Path):
    return build_services(Settings(app_env="test", data_dir=tmp_path, _env_file=None))


async def test_extract_cc_video(services) -> None:
    result = await services.extractor.extract(BIG_BUCK_BUNNY)
    ids = [p.format_id for p in result.presets]
    assert result.source_site == "YouTube" and result.media_type == "video"
    assert {"best", "mp4-720p", "mp3-192", "m4a"} <= set(ids)


async def test_ssrf_guard_blocks_redirect_to_private_address(services) -> None:
    # The URL itself is public; the guard must still refuse connecting to 127.0.0.1
    # if anything resolves there. localtest.me resolves to 127.0.0.1 by design.
    with pytest.raises(ApiError) as ei:
        await services.extractor.extract("https://localtest.me/")
    assert ei.value.code == "invalid_url"
