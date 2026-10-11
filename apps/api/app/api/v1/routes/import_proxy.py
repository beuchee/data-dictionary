"""Reading another dictionary's public JSON for the cross-repo import, when the
browser cannot (a host without CORS headers).

`GET /import-proxy/json?url=` → the JSON document at `url`. Only for users who
may propose concept sets; http(s) only; the host must resolve to public
addresses (the SSRF rule of git_service, re-checked at every redirect, at
most 3); bounded size and time; nothing but JSON comes back.
"""

import asyncio
import ipaddress
import json
import socket
from urllib.parse import urljoin, urlsplit

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.deps import require_permission
from app.core.json_response import json_response

router = APIRouter(prefix="/import-proxy", tags=["import"])

MAX_BYTES = 64 * 1024 * 1024
MAX_REDIRECTS = 3
TIMEOUT = httpx.Timeout(20.0, connect=10.0)
# Replaced in tests by an httpx.MockTransport.
transport: httpx.AsyncBaseTransport | None = None


def _bad(code: str, message: str, http_status: int = status.HTTP_400_BAD_REQUEST) -> HTTPException:
    return HTTPException(http_status, {"code": code, "message": message})


def check_public_url(url: str) -> str:
    """Blocking (DNS). Refuses non-http(s) URLs, credentials in the URL, and
    hosts resolving to loopback / private / link-local / reserved addresses.
    Returns the address to connect to: the request goes there, never through
    a second lookup, which a rebinding DNS could answer differently."""
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise _bad("invalid_url", "Only http(s) URLs with a host can be fetched")
    if parts.username or parts.password:
        raise _bad("invalid_url", "URLs with credentials are refused")
    try:
        infos = socket.getaddrinfo(
            parts.hostname, parts.port or (443 if parts.scheme == "https" else 80), proto=socket.IPPROTO_TCP
        )
    except OSError:
        raise _bad("unreachable", f"{parts.hostname} does not resolve", status.HTTP_502_BAD_GATEWAY) from None
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_loopback
            or ip.is_link_local
            or ip.is_private
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise _bad("internal_host", "This host is not allowed (internal address)", status.HTTP_403_FORBIDDEN)
    if not infos:
        raise _bad("unreachable", f"{parts.hostname} does not resolve", status.HTTP_502_BAD_GATEWAY)
    return str(infos[0][4][0])


def _pinned(url: str, address: str) -> tuple[httpx.URL, dict, dict]:
    """(URL to `address`, headers, extensions): the original host still goes
    in `Host` and in TLS (SNI and certificate check)."""
    original = httpx.URL(url)
    host = original.host
    headers = {"Accept": "application/json", "Host": original.netloc.decode("ascii")}
    extensions = {"sni_hostname": host} if original.scheme == "https" else {}
    return original.copy_with(host=address), headers, extensions


async def fetch_json(url: str):
    async with httpx.AsyncClient(timeout=TIMEOUT, follow_redirects=False, transport=transport) as client:
        for _ in range(MAX_REDIRECTS + 1):
            address = await asyncio.to_thread(check_public_url, url)
            target, headers, extensions = _pinned(url, address)
            try:
                request = client.build_request("GET", target, headers=headers, extensions=extensions)
                response = await client.send(request, stream=True)
                try:
                    if response.is_redirect and "location" in response.headers:
                        url = urljoin(url, response.headers["location"])
                        continue
                    if response.status_code != 200:
                        raise _bad("upstream_status", f"HTTP {response.status_code}", status.HTTP_502_BAD_GATEWAY)
                    body = bytearray()
                    async for chunk in response.aiter_bytes():
                        body.extend(chunk)
                        if len(body) > MAX_BYTES:
                            raise _bad("too_large", "The document is too large", status.HTTP_502_BAD_GATEWAY)
                finally:
                    await response.aclose()
            except httpx.HTTPError as exc:
                raise _bad("unreachable", type(exc).__name__, status.HTTP_502_BAD_GATEWAY) from None
            try:
                return json.loads(bytes(body))
            except ValueError:
                raise _bad("not_json", "The document is not JSON", status.HTTP_502_BAD_GATEWAY) from None
    raise _bad("too_many_redirects", "Too many redirects", status.HTTP_502_BAD_GATEWAY)


@router.get("/json")
async def proxy_json(
    url: str = Query(..., min_length=8, max_length=2048),
    _user=Depends(require_permission("concept-sets:propose")),
):
    return json_response(await fetch_json(url))
