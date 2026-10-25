"""SSRF guard tests: docs/03 section 8.1 (S1-S11) and the yt-dlp connection guard."""

from __future__ import annotations

import socket

import pytest

from app import ssrf
from app.ssrf import (
    SSRFError,
    avalidate_url,
    ip_is_allowed,
    is_ssrf_block,
    media_url_allowed,
    normalize_url,
    validate_url,
)

PUBLIC_V4 = "93.184.215.14"
PUBLIC_V6 = "2606:2800:21f:cb07:6820:80da:af6b:8b2c"


def public_resolver(host: str, port: int) -> list[str]:
    return [PUBLIC_V4]


BLOCKED_URLS = [
    # S1 loopback / localhost
    "http://127.0.0.1/", "http://127.0.0.1:6379/", "http://localhost/", "http://localhost./",
    "http://foo.localhost/",
    # S2 alternative IPv4 encodings
    "http://2130706433/", "http://0x7f000001/", "http://0177.0.0.1/", "http://017700000001/",
    "http://127.1/", "http://0/", "http://0.0.0.0/", "http://0x7f.0.0.1/",
    "http://0x5db8d70e/",  # hex encoding of a *public* address is still refused
    "http://1.2.3/",  # short form
    "http://example.123/",  # numeric last label => IPv4 rules apply
    # S3 private / special IPv4
    "http://10.0.0.1/", "http://172.16.0.1/", "http://172.31.255.255/", "http://192.168.1.1/",
    "http://100.64.0.1/", "http://198.18.0.1/", "http://224.0.0.1/", "http://255.255.255.255/",
    "http://192.0.0.8/", "http://192.0.2.1/", "http://192.88.99.1/", "http://198.51.100.1/",
    "http://203.0.113.1/", "http://240.0.0.1/", "http://192.31.196.1/", "http://192.175.48.1/",
    # S4 metadata
    "http://169.254.169.254/latest/meta-data/", "http://[fd00:ec2::254]/latest/meta-data/",
    "http://metadata.google.internal/computeMetadata/v1/", "http://100.100.100.200/",
    "http://168.63.129.16/",
    # S5 IPv6 tricks
    "http://[::1]/", "http://[::]/", "http://[::ffff:127.0.0.1]/", "http://[::ffff:7f00:1]/",
    "http://[0:0:0:0:0:ffff:a9fe:a9fe]/", "http://[64:ff9b::a9fe:a9fe]/",
    "http://[2002:7f00:1::]/", "http://[2001:0:4136:e378:8000:63bf:3fff:fdd2]/",
    "http://[fe80::1%25eth0]/", "http://[fe80::1]/", "http://[fc00::1]/", "http://[ff02::1]/",
    "http://[100::1]/", "http://[2001:db8::1]/", "http://[::127.0.0.1]/", "http://[3fff::1]/",
    "http://[::ffff:8.8.8.8]/",  # mapped addresses are refused outright
    # S6 schemes
    "file:///etc/passwd", "ftp://example.com/x", "gopher://127.0.0.1:6379/_",
    "dict://127.0.0.1:11211/", "data:text/html,x", "javascript:alert(1)",
    "rtmp://example.com/x", "//example.com/x", "example.com",
    # S7 userinfo, parser differentials, whitespace, length
    "http://user:pass@example.com/", "http://example.com@127.0.0.1/",
    "http://example.com\\@127.0.0.1/", "http://exa mple.com/", "http://example.com/\r\nX:1",
    "http://example.com/\x00", " http://example.com/\t", "https://example.com/" + "a" * 2100,
    # S8 ports
    "http://example.com:6379/", "https://example.com:22/", "http://example.com:0/",
    "http://example.com:99999/", "http://example.com:8080/",
    # S9 single-label / internal names
    "http://redis/", "http://worker:8000/", "http://intranet.corp/", "http://printer.local/",
    "http://router.lan/", "http://nas.home.arpa/", "http://db.localdomain/",
    # malformed hosts
    "http://-bad-.example.com/", "http:///path", "https://",
]


@pytest.mark.parametrize("url", BLOCKED_URLS)
def test_blocked_urls(url: str) -> None:
    with pytest.raises(SSRFError):
        validate_url(url, resolver=public_resolver)


@pytest.mark.parametrize(
    ("raw", "expected"),
    [
        ("HTTPS://WWW.Example.COM/a?b=1#frag", "https://www.example.com/a?b=1"),
        ("https://bücher.example/", "https://xn--bcher-kva.example/"),
        (f"http://{PUBLIC_V4}/", f"http://{PUBLIC_V4}/"),
        ("http://example.com:80/x", "http://example.com/x"),
        ("https://example.com:443", "https://example.com/"),
        ("http://example.com:443/", "http://example.com:443/"),
        ("https://example.com./v", "https://example.com/v"),
        (f"http://[{PUBLIC_V6}]/", f"http://[{PUBLIC_V6}]/"),
        ("https://youtube.com/watch?v=abc&t=5", "https://youtube.com/watch?v=abc&t=5"),
        ("https://sub_domain.example.com/", "https://sub_domain.example.com/"),
        ("http://example.com/%0d%0aX:1", "http://example.com/%0d%0aX:1"),  # encoded is fine
    ],
)
def test_allowed_urls_are_normalised(raw: str, expected: str) -> None:
    assert validate_url(raw, resolver=public_resolver).url == expected


# S10: resolver behaviour (every answer must be public)
@pytest.mark.parametrize(
    "answers",
    [["127.0.0.1"], [PUBLIC_V4, "10.0.0.1"], ["fd00::1"], [], ["::ffff:169.254.169.254"],
     [PUBLIC_V6, "fe80::1"], ["not-an-ip"], ["fe80::1%eth0"]],
)
def test_resolver_answers_blocked(answers: list[str]) -> None:
    with pytest.raises(SSRFError):
        validate_url("https://public.test/", resolver=lambda h, p: answers)


def test_resolver_all_public_passes() -> None:
    v = validate_url("https://public.test/v", resolver=lambda h, p: [PUBLIC_V4, PUBLIC_V6])
    assert v.addresses == (PUBLIC_V4, PUBLIC_V6)
    assert v.port == 443 and v.host == "public.test"


def test_resolver_failure_blocked() -> None:
    def boom(host: str, port: int) -> list[str]:
        raise socket.gaierror("nope")

    with pytest.raises(SSRFError, match="dns"):
        validate_url("https://public.test/", resolver=boom)


def test_ip_literal_skips_dns() -> None:
    def never(host: str, port: int) -> list[str]:
        raise AssertionError("DNS must not be used for literals")

    assert validate_url(f"https://{PUBLIC_V4}/", resolver=never).addresses == (PUBLIC_V4,)


@pytest.mark.anyio
async def test_async_validate_timeout() -> None:
    import time

    def slow(host: str, port: int) -> list[str]:
        time.sleep(0.5)
        return [PUBLIC_V4]

    with pytest.raises(SSRFError, match="timeout"):
        await avalidate_url("https://slow.test/", resolver=slow, timeout=0.05)


@pytest.mark.anyio
async def test_async_validate_ok() -> None:
    v = await avalidate_url("https://public.test/", resolver=public_resolver)
    assert v.url == "https://public.test/"


@pytest.mark.parametrize(
    ("ip", "allowed"),
    [(PUBLIC_V4, True), ("8.8.8.8", True), (PUBLIC_V6, True), ("10.1.2.3", False),
     ("::ffff:8.8.8.8", False), ("2002:0808:0808::1", False), ("2001::1", False),
     ("5f00::1", False), ("fec0::1", False), ("4000::1", False), ("garbage", False)],
)
def test_ip_is_allowed(ip: str, allowed: bool) -> None:
    assert ip_is_allowed(ip) is allowed


def test_extra_denied_networks() -> None:
    try:
        ssrf.set_extra_denied_networks(["93.184.215.0/24"])
        assert not ip_is_allowed(PUBLIC_V4)
    finally:
        ssrf.set_extra_denied_networks([])
    assert ip_is_allowed(PUBLIC_V4)


@pytest.mark.parametrize(
    ("url", "ok"),
    [("https://cdn.example.com:8443/v.mp4", True), ("http://10.0.0.5/v.mp4", False),
     ("http://[::1]/x", False), ("file:///etc/passwd", False), (None, True), ("", True)],
)
def test_media_url_allowed(url, ok) -> None:  # R7
    assert media_url_allowed(url) is ok


def test_normalize_without_port_rule() -> None:
    assert normalize_url("https://cdn.example.com:8443/a", allowed_ports=None).port == 8443


# ------------------------------------------------------------ connection guard


def _fake_getaddrinfo(answers: list[str]):
    def fake(host, port, *args, **kwargs):
        out = []
        for a in answers:
            fam = socket.AF_INET6 if ":" in a else socket.AF_INET
            out.append((fam, socket.SOCK_STREAM, 6, "", (a, port)))
        return out

    return fake


def test_guard_refuses_private_destination(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo([PUBLIC_V4, "127.0.0.1"]))
    calls: list = []
    with pytest.raises(ssrf.SSRFBlockedConnection) as ei:
        ssrf._guarded_create_connection(("rebind.test", 80), 5,
                                        _create_socket_func=lambda *a: calls.append(a))
    assert calls == [] and is_ssrf_block(ei.value)


def test_guard_connects_only_to_checked_addresses(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo([PUBLIC_V4]))
    seen: list = []
    sentinel = object()

    def create(info, timeout, source):
        seen.append(info[4][0])
        return sentinel

    assert ssrf._guarded_create_connection(("ok.test", 443), 5,
                                           _create_socket_func=create) is sentinel
    assert seen == [PUBLIC_V4]


def test_guard_allows_configured_proxy(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(socket, "getaddrinfo", _fake_getaddrinfo(["172.30.10.2"]))
    monkeypatch.setattr(ssrf, "_allowed_proxy", ("egress", 4750))
    sentinel = object()
    assert ssrf._guarded_create_connection(
        ("egress", 4750), 5, _create_socket_func=lambda *a: sentinel) is sentinel
    with pytest.raises(ssrf.SSRFBlockedConnection):  # same IP, other port: not the proxy
        ssrf._guarded_create_connection(("egress", 80), 5, _create_socket_func=lambda *a: None)


def test_install_guard_patches_ytdlp() -> None:
    ssrf.install_ytdlp_guard()
    from yt_dlp.networking import _helper, _urllib, _websockets
    from yt_dlp.networking.common import _REQUEST_HANDLERS

    for mod in (_helper, _urllib, _websockets):
        assert mod.create_connection is ssrf._guarded_create_connection
    assert set(_REQUEST_HANDLERS) <= {"Urllib", "Websockets"}


def test_is_ssrf_block_chain() -> None:
    try:
        try:
            raise ssrf.SSRFBlockedConnection("x")
        except OSError as inner:
            raise RuntimeError("wrapped") from inner
    except RuntimeError as outer:
        assert is_ssrf_block(outer)
    assert not is_ssrf_block(ValueError("other"))
