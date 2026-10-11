"""First-run setup, then the session lifecycle: login, me, refresh, logout."""

import asyncio
from datetime import UTC, datetime, timedelta

import jwt
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.config import settings
from app.main import app
from app.models.base import Base
from app.models.user import User

from conftest import API, TEST_PASSWORD, create_user, login, override_db


async def _initialize(client, username: str = "admin", password: str = TEST_PASSWORD, **extra):
    return await client.post(f"{API}/setup/initialize", json={"username": username, "password": password, **extra})


async def test_setup_creates_the_first_admin_then_closes(client):
    r = await client.get(f"{API}/setup/status")
    assert r.json() == {"needs_setup": True, "password_min_length": settings.password_min_length}

    r = await _initialize(client, email="a@b.c", first_name="Jane", last_name="Doe")
    assert r.status_code == 200, r.text
    assert r.json()["username"] == "admin"
    assert r.json()["role"] == "admin"

    assert (await client.get(f"{API}/setup/status")).json()["needs_setup"] is False

    # Not a second admin, whatever the payload.
    r = await _initialize(client, username="intruder", password="another-strong-one")
    assert r.status_code == 400
    r = await client.post(f"{API}/auth/login", json={"username": "intruder", "password": "another-strong-one"})
    assert r.status_code == 401


async def test_concurrent_setups_make_one_admin(tmp_path):
    """First-run submissions racing (a file database, one connection each, as
    in production): one admin, the others refused."""
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    maker = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    override_db(app, maker)
    try:
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
            results = await asyncio.gather(*(_initialize(client, username=f"admin{i}") for i in range(5)))
        assert sorted(r.status_code for r in results) == [200, 400, 400, 400, 400]
        async with maker() as db:
            assert len(list(await db.scalars(select(User)))) == 1
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def test_setup_is_refused_once_any_user_exists(client, db):
    await create_user(db, "someone", role="viewer")
    assert (await _initialize(client)).status_code == 400


async def test_setup_applies_the_password_policy(client):
    assert (await _initialize(client, password="short")).status_code == 422
    assert (await _initialize(client, username="administrator", password="administrator")).status_code == 422
    assert (await _initialize(client, username="   ")).status_code == 422
    assert (await client.get(f"{API}/setup/status")).json()["needs_setup"] is True


async def test_login_me_refresh_logout(client):
    await _initialize(client)
    r = await client.post(f"{API}/auth/login", json={"username": "admin", "password": TEST_PASSWORD})
    assert r.status_code == 200
    tokens = r.json()
    assert tokens["token_type"] == "bearer"
    assert tokens["user"] == {
        "id": tokens["user"]["id"],
        "username": "admin",
        "email": None,
        "role": "admin",
        "is_active": True,
    }

    headers = {"Authorization": f"Bearer {tokens['access_token']}"}
    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert me["username"] == "admin"
    assert "users:manage" in me["permissions"]

    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["refresh_token"]})
    assert r.status_code == 200
    assert r.json()["access_token"]

    assert (await client.post(f"{API}/auth/logout", headers=headers)).json() == {"ok": True}


async def test_login_failures_do_not_say_which_part_was_wrong(client, db):
    await create_user(db, "alice")
    wrong_password = await client.post(f"{API}/auth/login", json={"username": "alice", "password": "nope"})
    unknown_user = await client.post(f"{API}/auth/login", json={"username": "bob", "password": "nope"})
    assert wrong_password.status_code == unknown_user.status_code == 401
    assert wrong_password.json() == unknown_user.json()


async def test_a_password_past_72_bytes_never_matches_its_prefix(client, db):
    await create_user(db, "alice", password="x" * 72)
    r = await client.post(f"{API}/auth/login", json={"username": "alice", "password": "x" * 72 + "tail"})
    assert r.status_code == 401


async def test_a_disabled_account_cannot_log_in_nor_use_its_tokens(client, db):
    user = await create_user(db, "alice")
    headers = await login(client, "alice")
    user.is_active = False
    await db.commit()
    assert (await client.get(f"{API}/auth/me", headers=headers)).status_code == 401
    r = await client.post(f"{API}/auth/login", json={"username": "alice", "password": TEST_PASSWORD})
    assert r.status_code == 401


async def test_me_requires_a_token(client):
    assert (await client.get(f"{API}/auth/me")).status_code == 401
    bad = {"Authorization": "Bearer not-a-jwt"}
    assert (await client.get(f"{API}/auth/me", headers=bad)).status_code == 401


async def test_a_refresh_token_is_not_an_access_token_and_vice_versa(client, db):
    await create_user(db, "alice")
    tokens = (await client.post(f"{API}/auth/login", json={"username": "alice", "password": TEST_PASSWORD})).json()
    as_access = {"Authorization": f"Bearer {tokens['refresh_token']}"}
    assert (await client.get(f"{API}/auth/me", headers=as_access)).status_code == 401
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": tokens["access_token"]})
    assert r.status_code == 401


async def test_forged_and_expired_tokens_are_refused(client, db):
    user = await create_user(db, "alice", role="viewer")
    now = datetime.now(UTC)
    claims = {"sub": str(user.id), "username": "alice", "role": "admin", "type": "access", "iat": now}
    other_secret = "another-secret-as-long-0123456789"
    forged = jwt.encode({**claims, "exp": now + timedelta(hours=1)}, other_secret, algorithm="HS256")
    expired = jwt.encode({**claims, "exp": now - timedelta(seconds=1)}, settings.secret_key, "HS256")
    unsigned = jwt.encode({**claims, "exp": now + timedelta(hours=1)}, None, algorithm="none")
    for token in (forged, expired, unsigned):
        r = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert r.status_code == 401


async def test_the_role_comes_from_the_database_not_the_token(client, db):
    user = await create_user(db, "alice", role="viewer")
    now = datetime.now(UTC)
    claims = {
        "sub": str(user.id),
        "username": "alice",
        "role": "admin",
        "type": "access",
        "iat": now,
        "exp": now + timedelta(hours=1),
    }
    token = jwt.encode(claims, settings.secret_key, algorithm=settings.algorithm)
    me = (await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {token}"})).json()
    assert me["role"] == "viewer"
    assert "users:manage" not in me["permissions"]


async def test_profile_update(client, db):
    await create_user(db, "alice")
    headers = await login(client, "alice")
    r = await client.patch(
        f"{API}/auth/me",
        headers=headers,
        json={
            "firstName": "Alice",
            "lastName": "Martin",
            "affiliation": "  CHU Rennes ",
            "profession": "Intensive Care Physician",
            "orcid": "https://orcid.org/0000-0002-1825-0097",
        },
    )
    assert r.status_code == 200, r.text
    me = r.json()
    assert (me["first_name"], me["last_name"], me["affiliation"], me["orcid"]) == (
        "Alice",
        "Martin",
        "CHU Rennes",
        "0000-0002-1825-0097",
    )

    # Clearing a field with an empty string stores null.
    r = await client.patch(f"{API}/auth/me", headers=headers, json={"affiliation": ""})
    assert r.json()["affiliation"] is None
    assert r.json()["first_name"] == "Alice"


async def test_profile_update_rejects_a_bad_orcid(client, db):
    await create_user(db, "alice")
    headers = await login(client, "alice")
    for orcid in ("0000-0002-1825-0098", "0000-0002-1825", "not-an-orcid"):
        r = await client.patch(f"{API}/auth/me", headers=headers, json={"orcid": orcid})
        assert r.status_code == 422, orcid
    r = await client.patch(f"{API}/auth/me", headers=headers, json={"orcid": "0000-0002-1694-233x"})
    assert r.json()["orcid"] == "0000-0002-1694-233X"


async def test_profile_update_cannot_change_role_or_username(client, db):
    await create_user(db, "alice", role="viewer")
    headers = await login(client, "alice")
    r = await client.patch(
        f"{API}/auth/me", headers=headers, json={"role": "admin", "username": "root", "isActive": False}
    )
    assert r.status_code == 200
    user = await db.scalar(select(User).where(User.id == r.json()["id"]))
    await db.refresh(user)
    assert (user.role, user.username, user.is_active) == ("viewer", "alice", True)
