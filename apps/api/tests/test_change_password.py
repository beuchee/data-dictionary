"""POST /auth/change-password and the password policy. A change ends every
session issued before it; the caller gets fresh tokens."""

import time
from datetime import UTC, datetime
from types import SimpleNamespace

import jwt
import pytest

from app.config import settings
from app.core.security import (
    create_access_token,
    create_refresh_token,
    decode_token,
    password_policy_error,
    predates_password_change,
    set_password,
)

from conftest import API, TEST_PASSWORD

NEW_PASSWORD = "a-long-enough-one"


async def _setup_admin(client) -> int:
    await client.post(f"{API}/setup/initialize", json={"username": "admin", "password": TEST_PASSWORD})
    return (await client.get(f"{API}/auth/me", headers=await _login(client))).json()["id"]


async def _login(client, password: str = TEST_PASSWORD) -> dict:
    r = await client.post(f"{API}/auth/login", json={"username": "admin", "password": password})
    return {"Authorization": f"Bearer {r.json()['access_token']}"} if r.status_code == 200 else {}


def _earlier_token(user_id: int, kind: str) -> str:
    """A session token issued a while ago, as a thief would hold it."""
    now = int(time.time())
    payload = {"sub": str(user_id), "username": "admin", "role": "admin", "type": kind,
               "iat": now - 10, "iat_us": (now - 10) * 1_000_000, "exp": now + 3600}
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


async def test_change_password_end_to_end(client):
    await _setup_admin(client)
    h = await _login(client)

    def change(current, new):
        return client.post(f"{API}/auth/change-password", headers=h,
                           json={"currentPassword": current, "newPassword": new})

    assert (await change("wrong", NEW_PASSWORD)).status_code == 403
    assert (await change(TEST_PASSWORD, "short")).status_code == 422
    assert (await change(TEST_PASSWORD, "admin")).status_code == 422
    same = await change(TEST_PASSWORD, TEST_PASSWORD)
    assert same.status_code == 422
    assert same.json()["detail"]["code"] == "password_same_as_current"
    assert (await change(TEST_PASSWORD, NEW_PASSWORD)).status_code == 200

    assert await _login(client, TEST_PASSWORD) == {}
    assert await _login(client, NEW_PASSWORD)


async def test_an_api_token_cannot_change_the_password(client):
    await _setup_admin(client)
    key = (await client.post(f"{API}/auth/api-tokens", headers=await _login(client),
                             json={"name": "k"})).json()["token"]
    r = await client.post(f"{API}/auth/change-password", headers={"Authorization": f"Bearer {key}"},
                          json={"currentPassword": TEST_PASSWORD, "newPassword": NEW_PASSWORD})
    assert r.status_code == 401


async def test_a_change_ends_the_sessions_issued_before_it(client):
    admin_id = await _setup_admin(client)
    stolen = {"Authorization": f"Bearer {_earlier_token(admin_id, 'access')}"}
    stolen_refresh = _earlier_token(admin_id, "refresh")
    assert (await client.get(f"{API}/auth/me", headers=stolen)).status_code == 200

    r = await client.post(f"{API}/auth/change-password", headers=await _login(client),
                          json={"currentPassword": TEST_PASSWORD, "newPassword": NEW_PASSWORD})
    fresh = r.json()

    assert (await client.get(f"{API}/auth/me", headers=stolen)).status_code == 401
    assert (await client.post(f"{API}/auth/refresh", json={"refresh_token": stolen_refresh})).status_code == 401
    me = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {fresh['access_token']}"})
    assert me.status_code == 200
    r = await client.post(f"{API}/auth/refresh", json={"refresh_token": fresh["refresh_token"]})
    assert r.status_code == 200


@pytest.mark.parametrize("password, code", [
    ("k7#mQ2!vR9p", "password_too_short"),
    ("k7#mQ2!vR9pL", None),
    ("x" * 72, None),
    ("x" * 73, "password_too_long"),
    # 37 characters but 74 bytes: the limit is bcrypt's, in bytes.
    ("é" * 37, "password_too_long"),
    ("Alice.Martin", "password_is_username"),
    (" alice.martin ", "password_is_username"),
    ("alice.martin!", None),
    ("Password1234", "password_common"),
    ("qwertyuiop123", "password_common"),
    ("PASSWORD1234", "password_common"),
])
def test_policy(password, code):
    error = password_policy_error(password, "alice.martin")
    assert (error and error["code"]) == code


def test_the_minimum_length_is_configurable(monkeypatch):
    monkeypatch.setattr(settings, "password_min_length", 16)
    assert password_policy_error("x" * 15, "bob") == {
        "code": "password_too_short", "minLength": 16,
        "message": "The password must be at least 16 characters.",
    }
    assert password_policy_error("x" * 16, "bob") is None


async def test_the_status_states_the_minimum_length(client, monkeypatch):
    monkeypatch.setattr(settings, "password_min_length", 14)
    assert (await client.get(f"{API}/setup/status")).json()["password_min_length"] == 14


def test_a_token_from_the_same_second_but_before_the_change_is_stale():
    changed = datetime(2026, 10, 4, 12, 0, 0, 500_000, tzinfo=UTC)
    user = SimpleNamespace(password_changed_at=changed)
    same_second = int(changed.timestamp())
    before = {"iat": same_second, "iat_us": same_second * 1_000_000 + 499_999}
    after = {"iat": same_second, "iat_us": same_second * 1_000_000 + 500_000}
    assert predates_password_change(before, user)
    assert not predates_password_change(after, user)
    assert predates_password_change({"iat": same_second - 1}, user)


def test_the_tokens_minted_after_a_change_are_current():
    user = SimpleNamespace(password_changed_at=None)
    set_password(user, NEW_PASSWORD)
    for token in (create_access_token(1, "admin", "admin"), create_refresh_token(1, "admin", "admin")):
        assert not predates_password_change(decode_token(token), user)
