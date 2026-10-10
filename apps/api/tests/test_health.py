"""Health, and the headers that keep an API response from ever acting as a page."""

from app.config import settings

from conftest import API


async def test_health_reports_the_version(client):
    r = await client.get(f"{API}/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok", "app": settings.app_name, "version": settings.app_version}


async def test_api_responses_carry_the_security_headers(client):
    for r in (await client.get(f"{API}/health"), await client.get(f"{API}/auth/me")):
        assert r.headers["x-content-type-options"] == "nosniff"
        assert r.headers["x-frame-options"] == "DENY"
        assert r.headers["referrer-policy"] == "no-referrer"
        assert "default-src 'none'" in r.headers["content-security-policy"]
        assert "sandbox" in r.headers["content-security-policy"]


async def test_the_interactive_docs_are_left_alone(client):
    r = await client.get("/docs")
    assert "content-security-policy" not in r.headers
