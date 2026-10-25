"""SSRF protection for user-supplied URLs (docs/03 section 3).

Layers implemented here (the app-level part of the defence in depth):

1. :func:`normalize_url` checks syntax: http/https only, no userinfo, no control
   characters/backslashes, ports 80/443 only, IDNA host, internal hostnames
   refused, and IP literals range-checked. Any host whose last label is numeric
   is treated as an IPv4 literal (WHATWG rule) and must be in canonical
   dotted-quad form, so decimal (``2130706433``), hex (``0x7f000001``), octal
   (``0177.0.0.1``) and short (``127.1``) encodings are all refused.
2. :func:`validate_url` / :func:`avalidate_url` also resolve DNS and require
   EVERY A/AAAA answer to be public.
3. :func:`install_ytdlp_guard` patches yt-dlp's connection factory so every
   connection yt-dlp opens (redirect hops, CDN/format URLs, HLS/DASH segments) is
   checked against the same rules at connect time, on the address actually
   connected to. This closes redirect and DNS-rebinding gaps in local dev. In
   production the egress proxy (Smokescreen) is the authoritative control and the
   guard only allows connections to the proxy itself.
"""

from __future__ import annotations

import asyncio
import ipaddress
import re
import socket
from collections.abc import Callable, Iterable
from dataclasses import dataclass
from urllib.parse import urlsplit, urlunsplit

import idna

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address
IPNetwork = ipaddress.IPv4Network | ipaddress.IPv6Network

MAX_URL_LENGTH = 2048
ALLOWED_SCHEMES = frozenset({"http", "https"})
ALLOWED_PORTS = frozenset({80, 443})
SSRF_BLOCK_MARKER = "vidnabbit-ssrf-blocked"

BLOCKED_V4: tuple[ipaddress.IPv4Network, ...] = tuple(
    ipaddress.IPv4Network(n)
    for n in (
        "0.0.0.0/8",
        "10.0.0.0/8",
        "100.64.0.0/10",
        "127.0.0.0/8",
        "169.254.0.0/16",
        "172.16.0.0/12",
        "192.0.0.0/24",
        "192.0.2.0/24",
        "192.31.196.0/24",
        "192.52.193.0/24",
        "192.88.99.0/24",
        "192.168.0.0/16",
        "192.175.48.0/24",
        "198.18.0.0/15",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "224.0.0.0/4",
        "240.0.0.0/4",
        "255.255.255.255/32",
        "168.63.129.16/32",  # Azure WireServer (a public address)
    )
)

BLOCKED_V6: tuple[ipaddress.IPv6Network, ...] = tuple(
    ipaddress.IPv6Network(n)
    for n in (
        "::/128",
        "::1/128",
        "::ffff:0:0/96",  # IPv4-mapped
        "::/96",  # deprecated IPv4-compatible
        "::ffff:0:0:0/96",  # IPv4-translated
        "64:ff9b::/96",  # NAT64
        "64:ff9b:1::/48",  # local-use NAT64
        "100::/64",  # discard-only
        "2001::/23",  # IETF protocol assignments (incl. Teredo)
        "2001:db8::/32",  # documentation
        "2002::/16",  # 6to4
        "3fff::/20",  # documentation (RFC 9637)
        "5f00::/16",  # SRv6 SIDs
        "fc00::/7",  # unique local (incl. AWS IMDS fd00:ec2::254)
        "fe80::/10",  # link-local
        "fec0::/10",  # deprecated site-local
        "ff00::/8",  # multicast
    )
)
V6_GLOBAL_UNICAST = ipaddress.IPv6Network("2000::/3")

BLOCKED_HOST_SUFFIXES = (
    ".localhost",
    ".local",
    ".internal",
    ".localdomain",
    ".home.arpa",
    ".lan",
    ".intranet",
    ".corp",
)
_NUMERIC_LABEL = re.compile(r"^(?:0x[0-9a-f]*|[0-9]+)$", re.IGNORECASE)
_FORBIDDEN_CHARS = re.compile(r"[\x00-\x20\x7f\\]")
_HOST_LABEL = re.compile(r"^(?!-)[a-z0-9_-]{1,63}(?<!-)$")

_extra_denied: list[IPNetwork] = []


class SSRFError(ValueError):
    """The URL is not safe to fetch. Maps to ``invalid_url``; never echo the URL."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


def set_extra_denied_networks(networks: Iterable[str]) -> None:
    """Deployment-specific denies (our own public IPs, provider private ranges)."""
    _extra_denied[:] = [ipaddress.ip_network(n, strict=False) for n in networks]


# --------------------------------------------------------------------------- IPs


def ip_is_allowed(ip: IPAddress | str) -> bool:
    """True only for globally routable unicast addresses outside every blocked range."""
    if isinstance(ip, str):
        try:
            ip = ipaddress.ip_address(ip)
        except ValueError:
            return False  # includes zone IDs like "fe80::1%eth0"
    if isinstance(ip, ipaddress.IPv6Address):
        if ip.scope_id is not None:
            return False
        if ip.ipv4_mapped is not None or ip.sixtofour is not None or ip.teredo is not None:
            return False
        if ip not in V6_GLOBAL_UNICAST or any(ip in n for n in BLOCKED_V6):
            return False
    elif any(ip in n for n in BLOCKED_V4):
        return False
    if any(ip in n for n in _extra_denied if n.version == ip.version):
        return False
    return ip.is_global and not ip.is_multicast  # belt and braces (Python >= 3.12.4)


def is_blocked_ip(ip: IPAddress | str) -> bool:
    return not ip_is_allowed(ip)


# ------------------------------------------------------------------- URL parsing


@dataclass(frozen=True)
class NormalizedURL:
    url: str  # re-serialised URL: lowercase scheme/host, IDNA host, no fragment
    scheme: str
    host: str  # ASCII host, or canonical IP string for literals
    port: int  # effective port
    literal: IPAddress | None


@dataclass(frozen=True)
class ValidatedURL:
    url: str
    scheme: str
    host: str
    port: int
    addresses: tuple[str, ...]  # every resolved address, all verified public


def normalize_url(
    raw: str, *, allowed_ports: frozenset[int] | None = ALLOWED_PORTS
) -> NormalizedURL:
    """Syntax and literal checks only (no DNS). Raises SSRFError.

    ``allowed_ports=None`` skips the port rule (used for media URLs returned by
    extractors, where the egress proxy enforces ports).
    """
    if not isinstance(raw, str):
        raise SSRFError("not a string")
    url = raw  # no strip: surrounding whitespace is refused below (clients trim)
    if not url or len(url) > MAX_URL_LENGTH:
        raise SSRFError("empty or too long")
    if _FORBIDDEN_CHARS.search(url):
        raise SSRFError("whitespace, control characters or backslashes")
    try:
        parts = urlsplit(url)
    except ValueError as e:
        raise SSRFError("unparseable") from e
    scheme = parts.scheme.lower()
    if scheme not in ALLOWED_SCHEMES:
        raise SSRFError("scheme")
    if not parts.netloc:
        raise SSRFError("no host")
    if "@" in parts.netloc or parts.username is not None or parts.password is not None:
        raise SSRFError("userinfo")
    try:
        explicit_port = parts.port
    except ValueError as e:
        raise SSRFError("port") from e
    default_port = 443 if scheme == "https" else 80
    port = explicit_port if explicit_port is not None else default_port
    if explicit_port == 0 or (allowed_ports is not None and port not in allowed_ports):
        raise SSRFError("port")

    host = (parts.hostname or "").rstrip(".")
    if not host or "%" in host:
        raise SSRFError("host or zone id")

    ip: IPAddress | None = None
    if ":" in host:  # bracketed IPv6 literal
        try:
            ip = ipaddress.IPv6Address(host)
        except ValueError as e:
            raise SSRFError("ipv6 literal") from e
    elif _NUMERIC_LABEL.match(host.rsplit(".", 1)[-1]):  # numeric last label => IPv4
        try:
            ip = ipaddress.IPv4Address(host)  # rejects octal/hex/short/decimal forms
        except ValueError as e:
            raise SSRFError("non-canonical ipv4") from e
        if str(ip) != host:
            raise SSRFError("non-canonical ipv4")

    if ip is not None:
        if not ip_is_allowed(ip):
            raise SSRFError("blocked ip literal")
        ascii_host = str(ip)
        netloc_host = f"[{ascii_host}]" if ip.version == 6 else ascii_host
    else:
        if host.isascii():
            ascii_host = host.lower()  # idna refuses "_", which real hostnames use
        else:
            try:
                ascii_host = idna.encode(host, uts46=True).decode("ascii").lower()
            except (idna.IDNAError, UnicodeError) as e:
                raise SSRFError("idna") from e
        labels = ascii_host.split(".")
        if len(labels) < 2 or len(ascii_host) > 253:
            raise SSRFError("single-label or overlong hostname")
        if not all(_HOST_LABEL.match(lbl) for lbl in labels):
            raise SSRFError("invalid hostname")
        if ascii_host == "localhost" or ascii_host.endswith(BLOCKED_HOST_SUFFIXES):
            raise SSRFError("blocked hostname")
        netloc_host = ascii_host

    netloc = netloc_host if port == default_port else f"{netloc_host}:{port}"
    normalized = urlunsplit((scheme, netloc, parts.path or "/", parts.query, ""))
    return NormalizedURL(normalized, scheme, ascii_host, port, ip)


def media_url_allowed(url: object) -> bool:
    """Post-extraction check for format/manifest URLs (syntax + literals, any port)."""
    if not isinstance(url, str) or not url:
        return True  # nothing to fetch directly (e.g. fragment-only formats)
    try:
        normalize_url(url, allowed_ports=None)
    except SSRFError:
        return False
    return True


# ------------------------------------------------------------------------- DNS

Resolver = Callable[[str, int], Iterable[str]]


def system_resolver(host: str, port: int) -> list[str]:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    return sorted({info[4][0] for info in infos})


def _check_addresses(addresses: Iterable[str]) -> tuple[str, ...]:
    addrs = tuple(addresses)
    if not addrs:
        raise SSRFError("dns: no answers")
    if not all(ip_is_allowed(a) for a in addrs):
        raise SSRFError("resolves to blocked address")
    return addrs


def validate_url(raw: str, resolver: Resolver = system_resolver) -> ValidatedURL:
    """Normalise and require every resolved address to be public (blocking DNS)."""
    n = normalize_url(raw)
    if n.literal is not None:
        addrs: tuple[str, ...] = (str(n.literal),)
    else:
        try:
            resolved = list(resolver(n.host, n.port))
        except (OSError, UnicodeError) as e:
            raise SSRFError("dns failure") from e
        addrs = _check_addresses(resolved)
    return ValidatedURL(n.url, n.scheme, n.host, n.port, addrs)


async def avalidate_url(
    raw: str, resolver: Resolver = system_resolver, timeout: float = 3.0
) -> ValidatedURL:
    """Async wrapper: DNS runs in a worker thread with a timeout."""
    try:
        return await asyncio.wait_for(asyncio.to_thread(validate_url, raw, resolver), timeout)
    except TimeoutError as e:
        raise SSRFError("dns timeout") from e


# ------------------------------------------------------- yt-dlp connection guard


class SSRFBlockedConnection(OSError):
    pass


_allowed_proxy: tuple[str, int] | None = None


def _guarded_create_connection(
    address,
    timeout=socket._GLOBAL_DEFAULT_TIMEOUT,
    source_address=None,
    *,
    _create_socket_func=None,
):
    """Drop-in replacement for ``yt_dlp.networking._helper.create_connection``.

    Resolves the host and refuses if ANY address is blocked, then connects only to
    the addresses it checked. Connections to the configured egress proxy are
    allowed (the proxy enforces the policy for the real destination).
    """
    from yt_dlp.networking import _helper

    host, port = address
    infos = socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)
    if not infos:
        raise OSError("getaddrinfo returns an empty list")
    is_proxy = _allowed_proxy is not None and (str(host).lower(), int(port)) == _allowed_proxy
    if not is_proxy:
        for info in infos:
            if not ip_is_allowed(info[4][0]):
                raise SSRFBlockedConnection(f"{SSRF_BLOCK_MARKER}: refused connection")
    if source_address is not None:
        af = socket.AF_INET if ":" not in source_address[0] else socket.AF_INET6
        infos = [i for i in infos if i[0] == af]
        if not infos:
            raise OSError("no addresses for the configured source address family")
    create = _create_socket_func or _helper._socket_connect
    err: OSError | None = None
    for info in infos:
        try:
            return create(info, timeout, source_address)
        except OSError as e:
            err = e
    raise err if err else OSError("connection failed")


# Request handlers whose connections go through _guarded_create_connection.
_GUARDED_HANDLERS = frozenset({"Urllib", "Websockets"})
_guard_installed = False


def install_ytdlp_guard(proxy_url: str | None = None) -> None:
    """Patch yt-dlp so every outbound connection is SSRF-checked (idempotent).

    Handlers with their own connection stack (requests/urllib3, curl_cffi) are
    unregistered so they cannot bypass the guard.
    """
    global _guard_installed, _allowed_proxy
    if proxy_url:
        p = urlsplit(proxy_url)
        _allowed_proxy = ((p.hostname or "").lower(), p.port or 80)
    if _guard_installed:
        return
    from yt_dlp.networking import _helper, _urllib, _websockets
    from yt_dlp.networking.common import _REQUEST_HANDLERS

    for mod in (_helper, _urllib, _websockets):
        mod.create_connection = _guarded_create_connection
    for key in list(_REQUEST_HANDLERS):
        if key not in _GUARDED_HANDLERS:
            del _REQUEST_HANDLERS[key]
    _guard_installed = True


def is_ssrf_block(exc: BaseException | None) -> bool:
    """True if an exception (or its cause chain / message) came from the guard."""
    seen = 0
    while exc is not None and seen < 10:
        if isinstance(exc, SSRFBlockedConnection) or SSRF_BLOCK_MARKER in str(exc):
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False
