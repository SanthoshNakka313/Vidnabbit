"""Signed tokens, safe filenames, local storage TTL (Safeguard 5) and the job janitor."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from app.storage import (
    LocalStorage,
    TokenError,
    content_disposition,
    sanitize_filename,
    sign_token,
    verify_token,
)

KEY = b"k" * 32


def test_token_roundtrip_and_rejections() -> None:
    exp = int(time.time()) + 60
    token = sign_token(KEY, "job/file.mp4", exp)
    assert verify_token(KEY, token) == "job/file.mp4"
    with pytest.raises(TokenError):
        verify_token(b"other" * 8, token)
    with pytest.raises(TokenError):
        verify_token(KEY, token, now=exp)
    payload, sig = token.split(".")
    forged = sign_token(b"attacker" * 4, "../../etc/passwd", exp).split(".")[0]
    for bad in ("", "a.b.c", f"{forged}.{sig}", "x" * 2000, f"{payload}."):
        with pytest.raises(TokenError):
            verify_token(KEY, bad)


@pytest.mark.parametrize(("title", "ext", "expected"), [
    ("My video", "mp4", "My video.mp4"),
    ("evil\u202egnp.exe", "mp4", "evil gnp.exe.mp4"),
    ("a/b\\c:d*e?f\"g<h>i|j", "MP3", "a b c d e f g h i j.mp3"),
    ("line\r\nbreak", "mp4", "line break.mp4"),
    ("...", "mp4", "download.mp4"),
    ("\uff46\uff55\uff4c\uff4c", "m4a", "full.m4a"),
    ("x", "../sh", "x.sh"),
    ("x" * 300, "mp4", "x" * 120 + ".mp4"),
])
def test_sanitize_filename(title: str, ext: str, expected: str) -> None:
    assert sanitize_filename(title, ext) == expected


def test_content_disposition_has_ascii_fallback() -> None:
    cd = content_disposition('Café "quoted".mp4')
    assert cd.startswith('attachment; filename="Caf quoted.mp4"')
    assert "filename*=UTF-8''Caf%C3%A9%20%22quoted%22.mp4" in cd
    assert "\r" not in cd and "\n" not in cd


def make_file(tmp_path: Path, name: str = "in.mp4") -> Path:
    p = tmp_path / name
    p.write_bytes(b"data")
    return p


def test_local_storage_put_resolve_delete(tmp_path: Path) -> None:
    st = LocalStorage(tmp_path / "store", KEY, "http://localhost:8000/")
    stored = st.put("job12345", make_file(tmp_path), "Nice.mp4", ttl_seconds=60)
    assert stored.size == 4 and stored.key.startswith("job12345/")
    url = st.download_url(stored)
    assert url.startswith("http://localhost:8000/v1/files/")
    key = verify_token(KEY, url.rsplit("/", 1)[1])
    path, filename = st.resolve(key)
    assert path.read_bytes() == b"data" and filename == "Nice.mp4"
    st.delete(key)
    assert st.resolve(key) is None


def test_local_storage_refuses_traversal(tmp_path: Path) -> None:
    st = LocalStorage(tmp_path / "store", KEY, "http://x")
    (tmp_path / "secret.txt").write_text("s")
    assert st.resolve("../secret.txt") is None
    assert st.resolve("job12345/../../secret.txt") is None
    with pytest.raises(ValueError):
        st.put("../escape", make_file(tmp_path), "x.mp4", 60)


def test_expired_files_are_unreachable_and_swept(tmp_path: Path) -> None:
    st = LocalStorage(tmp_path / "store", KEY, "http://x")
    stored = st.put("job12345", make_file(tmp_path), "x.mp4", ttl_seconds=60)
    assert st.delete_expired(now=time.time()) == 0
    assert st.delete_expired(now=time.time() + 61) == 1
    assert st.resolve(stored.key) is None
    assert not (tmp_path / "store" / "job12345").exists()


def test_orphan_dirs_are_swept_after_max_ttl(tmp_path: Path) -> None:
    st = LocalStorage(tmp_path / "store", KEY, "http://x")
    orphan = tmp_path / "store" / "orphan123"
    orphan.mkdir()
    old = time.time() - 3601
    os.utime(orphan, (old, old))
    assert st.delete_expired() == 1 and not orphan.exists()
