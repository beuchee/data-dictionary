"""Every API route is guarded, except an explicit public allow-list.

Two checks: a static one (each route's dependency tree holds an auth
dependency, and every permission it names is in the catalogue) and a live one
(with anonymous reading off, a request without credentials is refused)."""

import inspect
import re

import pytest
from fastapi.routing import APIRoute

from app.core import deps
from app.core.permissions import ALL_PERMISSIONS
from app.main import app
from app.services.content_store import ContentStore, get_content_store

from content_fixtures import build_content_dir

# (method, path): reachable without credentials, on purpose.
PUBLIC = {
    ("GET", "/api/v1/health"),
    ("GET", "/api/v1/setup/status"),
    # Refuses as soon as one user exists (test_setup_auth).
    ("POST", "/api/v1/setup/initialize"),
    ("POST", "/api/v1/auth/login"),
    ("POST", "/api/v1/auth/refresh"),
    ("GET", "/api/v1/instance/config"),
    ("GET", "/api/v1/instance/branding/{kind}"),
    ("GET", "/api/v1/auth/oauth/providers"),
    # Optional Bearer: with one, the flow links the identity to that account.
    ("GET", "/api/v1/auth/oauth/{provider}/start"),
    ("GET", "/api/v1/auth/oauth/{provider}/callback"),
}

# Content reads: open while config.json `access.anonymousRead` is true.
ANONYMOUS_READ = "require_read.<locals>._dep"
SIGNED_IN = {
    deps.get_current_user,
    deps.get_session_user,
}
PERMISSION = "require_permission.<locals>._dep"


def _walk(routes, prefix: str = ""):
    """(full path, APIRoute), through included routers (FastAPI >= 0.140 keeps
    them nested instead of copying their routes into the app)."""
    for route in routes:
        if isinstance(route, APIRoute):
            yield prefix + route.path, route
        elif hasattr(route, "original_router"):
            context = route.include_context
            # A router-level dependency would guard every route below it; none
            # is used, and this test reads route dependencies only.
            assert not context.dependencies and not route.original_router.dependencies
            yield from _walk(route.original_router.routes, prefix + context.prefix)


def _routes() -> list[tuple[str, str, APIRoute]]:
    out = []
    for path, route in _walk(app.routes):
        if path.startswith("/api/"):
            for method in sorted(route.methods - {"HEAD", "OPTIONS"}):
                out.append((method, path, route))
    assert len(out) > 50, "the route walk found too few routes"
    return out


def _calls(dependant) -> list:
    found = []
    for dep in dependant.dependencies:
        found.append(dep.call)
        found.extend(_calls(dep))
    return found


def _guard(route: APIRoute) -> tuple[str | None, list[str]]:
    """('signed-in' | 'permission' | 'read' | None, permissions named)."""
    found = set()
    permissions = []
    for call in _calls(route.dependant):
        qualname = getattr(call, "__qualname__", "")
        if qualname == PERMISSION:
            found.add("permission")
        elif qualname == ANONYMOUS_READ:
            found.add("read")
        elif call in SIGNED_IN:
            found.add("signed-in")
        if qualname in (PERMISSION, ANONYMOUS_READ):
            permissions.append(inspect.getclosurevars(call).nonlocals["permission"])
    kind = next((k for k in ("permission", "read", "signed-in") if k in found), None)
    return kind, permissions


def test_every_route_is_guarded_or_explicitly_public():
    unguarded = []
    for method, path, route in _routes():
        kind, permissions = _guard(route)
        assert set(permissions) <= set(ALL_PERMISSIONS), (method, path, permissions)
        if (method, path) in PUBLIC:
            assert kind is None or path.endswith("/start"), f"{method} {path} is listed public but guarded"
            continue
        if kind is None:
            unguarded.append(f"{method} {path}")
    assert not unguarded, f"Routes without an auth dependency: {unguarded}"


def test_the_public_list_names_existing_routes():
    existing = {(m, p) for m, p, _ in _routes()}
    assert PUBLIC <= existing, PUBLIC - existing


def _concrete(path: str) -> str:
    return re.sub(r"\{[^}]+\}", "1", path)


@pytest.fixture
def closed_client(client, tmp_path):
    root = build_content_dir(tmp_path / "content", anonymous_read=False)
    app.dependency_overrides[get_content_store] = lambda: ContentStore(root, check_interval=0)
    return client


async def test_without_credentials_every_guarded_route_is_refused(closed_client):
    """Anonymous reading off: no guarded route answers an anonymous caller."""
    for method, path, _route in _routes():
        if (method, path) in PUBLIC:
            continue
        r = await closed_client.request(method, _concrete(path), json={})
        assert r.status_code in (401, 403), (method, path, r.status_code, r.text[:200])
