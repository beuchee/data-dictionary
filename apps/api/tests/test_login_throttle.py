"""Failed-login throttling (core/login_throttle.py) on POST /auth/login."""

from app.core import login_throttle

from conftest import API, TEST_PASSWORD, create_user

URL = f"{API}/auth/login"


async def _fail(client, username="alice", ip="203.0.113.7"):
    return await client.post(URL, json={"username": username, "password": "wrong"}, headers={"X-Real-IP": ip})


async def test_repeated_failures_are_throttled_per_address_and_username(client, db):
    await create_user(db, "alice")
    for _ in range(login_throttle.MAX_FAILURES):
        assert (await _fail(client)).status_code == 401

    r = await _fail(client)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) > 0
    assert r.json()["detail"]["code"] == "too_many_attempts"
    # Even the right password waits: guessing must not go on.
    r = await client.post(
        URL, json={"username": "alice", "password": TEST_PASSWORD}, headers={"X-Real-IP": "203.0.113.7"}
    )
    assert r.status_code == 429

    # Another address, or another username, is not locked out.
    r = await client.post(
        URL, json={"username": "alice", "password": TEST_PASSWORD}, headers={"X-Real-IP": "198.51.100.1"}
    )
    assert r.status_code == 200
    assert (await _fail(client, username="bob")).status_code == 401


async def test_a_success_clears_the_count(client, db):
    await create_user(db, "alice")
    for _ in range(login_throttle.MAX_FAILURES - 1):
        await _fail(client)
    r = await client.post(
        URL, json={"username": "alice", "password": TEST_PASSWORD}, headers={"X-Real-IP": "203.0.113.7"}
    )
    assert r.status_code == 200
    for _ in range(login_throttle.MAX_FAILURES - 1):
        assert (await _fail(client)).status_code == 401


def test_failures_leave_the_window():
    login_throttle.reset()
    for i in range(login_throttle.MAX_FAILURES):
        login_throttle.record_failure("ip", "Alice", now=100.0 + i)
    assert login_throttle.retry_after("ip", "alice", now=110.0) == login_throttle.WINDOW_SECONDS - 9
    assert login_throttle.retry_after("ip", "alice", now=100.0 + login_throttle.WINDOW_SECONDS + 1) is None
