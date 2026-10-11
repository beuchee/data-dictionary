"""/api/v1/import-proxy/json: another dictionary's JSON for the cross-repo import."""

import socket

import httpx
import pytest

from app.api.v1.routes import import_proxy

from conftest import API, create_user, login

URL = f"{API}/import-proxy/json"


@pytest.fixture
def public_dns(monkeypatch):
    """Every host resolves to a public address, except `internal.example`."""

    def fake(host, port, *args, **kwargs):
        ip = "10.0.0.5" if host == "internal.example" else "93.184.216.34"
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port))]

    monkeypatch.setattr(import_proxy.socket, "getaddrinfo", fake)


@pytest.fixture
def upstream(monkeypatch, public_dns):
    def handler(request: httpx.Request) -> httpx.Response:
        path = request.url.path
        if path == "/data.json":
            return httpx.Response(200, json={"conceptSets": [{"id": 1}]})
        if path == "/moved":
            return httpx.Response(302, headers={"location": "https://other.example/data.json"})
        if path == "/to-internal":
            return httpx.Response(302, headers={"location": "http://internal.example/secret"})
        if path == "/loop":
            return httpx.Response(302, headers={"location": "/loop"})
        if path == "/html":
            return httpx.Response(200, text="<html>")
        return httpx.Response(404)

    monkeypatch.setattr(import_proxy, "transport", httpx.MockTransport(handler))


async def _editor(client, db):
    await create_user(db, "eve", "editor")
    return await login(client, "eve")


async def test_fetches_json_and_follows_safe_redirects(client, db, upstream):
    headers = await _editor(client, db)
    r = await client.get(URL, params={"url": "https://pages.example/data.json"}, headers=headers)
    assert r.status_code == 200 and r.json() == {"conceptSets": [{"id": 1}]}
    r = await client.get(URL, params={"url": "https://pages.example/moved"}, headers=headers)
    assert r.status_code == 200


@pytest.mark.parametrize(
    ("url", "status", "code"),
    [
        ("ftp://pages.example/data.json", 400, "invalid_url"),
        ("https://user:pw@pages.example/data.json", 400, "invalid_url"),
        ("http://internal.example/data.json", 403, "internal_host"),
        ("https://pages.example/to-internal", 403, "internal_host"),
        ("https://pages.example/loop", 502, "too_many_redirects"),
        ("https://pages.example/html", 502, "not_json"),
        ("https://pages.example/missing", 502, "upstream_status"),
    ],
)
async def test_refusals(client, db, upstream, url, status, code):
    headers = await _editor(client, db)
    r = await client.get(URL, params={"url": url}, headers=headers)
    assert r.status_code == status
    assert r.json()["detail"]["code"] == code


async def test_needs_the_propose_permission(client, db, upstream):
    assert (await client.get(URL, params={"url": "https://pages.example/data.json"})).status_code == 401
    await create_user(db, "vic", "viewer")
    headers = await login(client, "vic")
    assert (
        await client.get(URL, params={"url": "https://pages.example/data.json"}, headers=headers)
    ).status_code == 403


async def test_the_checked_address_is_the_one_connected_to(client, db, monkeypatch):
    """DNS rebinding: a host answering a public address to the check, then a
    private one to the connection, must not reach the private one."""
    answers = iter(["93.184.216.34"] + ["127.0.0.1"] * 10)

    def rebinding(host, port, *args, **kwargs):
        return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (next(answers), port))]

    monkeypatch.setattr(import_proxy.socket, "getaddrinfo", rebinding)
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"ok": True})

    monkeypatch.setattr(import_proxy, "transport", httpx.MockTransport(handler))
    headers = await _editor(client, db)
    r = await client.get(URL, params={"url": "https://rebind.example:8443/data.json"}, headers=headers)
    assert r.status_code == 200, r.text
    (request,) = seen
    assert request.url.host == "93.184.216.34" and request.url.port == 8443
    assert request.headers["host"] == "rebind.example:8443"
    assert request.extensions["sni_hostname"] == "rebind.example"


async def test_real_dns_refuses_loopback(client, db):
    headers = await _editor(client, db)
    r = await client.get(URL, params={"url": "http://localhost:8000/x.json"}, headers=headers)
    assert r.status_code == 403
