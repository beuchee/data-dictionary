"""OAuth sign-in (GitHub, GitLab, ORCID) with the providers mocked by an
httpx.MockTransport. Nothing reaches the network."""

import base64
import hashlib
import json
from datetime import UTC, datetime, timedelta
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from sqlalchemy import select

from app.config import settings
from app.main import app
from app.models.git_credential import GitCredential
from app.models.user import User
from app.models.user_identity import UserIdentity
from app.services import git_credential_service, oauth_service
from app.services.content_store import ContentStore, get_content_store

from conftest import API, create_user, login
from content_fixtures import build_content_dir


class FakeProviders:
    """Answers the token and profile endpoints; checks PKCE on the way."""

    def __init__(self):
        self.challenges: dict[str, str] = {}
        self.github_user = {"id": 4242, "login": "octo", "name": "Octo Cat", "email": None}
        self.gitlab_user = {"id": 77, "username": "gl-user", "name": "Gil Lab", "email": "gil@lab.org"}
        self.requests: list[httpx.Request] = []
        self.token_counter = 0

    def handler(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        url = str(request.url)
        if url.endswith("/access_token") or url.endswith("/oauth/token"):
            form = parse_qs(request.content.decode())
            if form["grant_type"] == ["refresh_token"]:
                self.token_counter += 1
                return httpx.Response(200, json={"access_token": f"refreshed-{self.token_counter}", "expires_in": 7200})
            code = form["code"][0]
            verifier = form["code_verifier"][0]
            challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
            if self.challenges.get(code) != challenge:
                return httpx.Response(400, json={"error": "invalid_grant"})
            if "orcid" in url:
                return httpx.Response(
                    200, json={"access_token": "orcid-tok", "orcid": "0000-0002-1825-0097", "name": "Josiah Carberry"}
                )
            if "gitlab" in url:
                return httpx.Response(
                    200, json={"access_token": "gl-tok", "refresh_token": "gl-refresh", "expires_in": 7200}
                )
            return httpx.Response(200, json={"access_token": "gh-tok", "scope": "public_repo"})
        if url == "https://api.github.com/user":
            return httpx.Response(200, json=self.github_user)
        if url == "https://api.github.com/user/emails":
            return httpx.Response(200, json=[{"email": "octo@example.org", "primary": True, "verified": True}])
        if url.endswith("/api/v4/user"):
            return httpx.Response(200, json=self.gitlab_user)
        if url.endswith("/personal-details"):
            return httpx.Response(
                200, json={"name": {"given-names": {"value": "Josiah"}, "family-name": {"value": "Carberry"}}}
            )
        return httpx.Response(404)


@pytest.fixture
def providers(monkeypatch, tmp_path):
    fake = FakeProviders()
    monkeypatch.setattr(oauth_service, "transport", httpx.MockTransport(fake.handler))
    for key, value in {
        "public_url": "http://test",
        "oauth_github_client_id": "gh-id",
        "oauth_github_client_secret": "gh-secret",
        "oauth_gitlab_client_id": "gl-id",
        "oauth_gitlab_client_secret": "gl-secret",
        "oauth_gitlab_base_url": "https://gitlab.example.org/",
        "oauth_orcid_client_id": "orcid-id",
        "oauth_orcid_client_secret": "orcid-secret",
        "oauth_orcid_sandbox": True,
    }.items():
        monkeypatch.setattr(settings, key, value)
    store = ContentStore(build_content_dir(tmp_path / "content"), check_interval=0)
    app.dependency_overrides[get_content_store] = lambda: store
    return fake


async def _start(client, fake, provider, headers=None, code="the-code") -> dict:
    r = await client.get(f"{API}/auth/oauth/{provider}/start", headers=headers or {})
    assert r.status_code == 200, r.text
    url = r.json()["authorizationUrl"]
    params = {k: v[0] for k, v in parse_qs(urlsplit(url).query).items()}
    fake.challenges[code] = params["code_challenge"]
    cookie = r.headers["set-cookie"]
    assert "HttpOnly" in cookie and "SameSite=lax" in cookie and "Path=/api/v1/auth/oauth" in cookie
    return params | {"_url": url}


async def _callback(client, provider, params, code="the-code"):
    r = await client.get(f"{API}/auth/oauth/{provider}/callback", params={"code": code, "state": params["state"]})
    assert r.status_code == 303
    location = r.headers["location"]
    assert location.startswith("http://test/auth/callback#")
    return {k: v[0] for k, v in parse_qs(urlsplit(location).fragment).items()}


async def test_instance_config_lists_enabled_providers(client, providers):
    r = await client.get(f"{API}/instance/config")
    assert r.json()["server"]["authProviders"] == ["local", "github", "gitlab", "orcid"]


async def test_start_builds_a_pkce_authorization_url(client, providers):
    params = await _start(client, providers, "github")
    assert params["_url"].startswith("https://github.com/login/oauth/authorize?")
    assert params["client_id"] == "gh-id"
    assert params["redirect_uri"] == "http://test/api/v1/auth/oauth/github/callback"
    assert params["code_challenge_method"] == "S256"
    assert params["scope"] == settings.oauth_github_scope
    assert len(params["state"]) >= 32
    assert "gh-secret" not in params["_url"]
    r = await client.get(f"{API}/auth/oauth/github/start", params={"redirect": "true"})
    assert r.status_code == 302 and r.headers["location"].startswith("https://github.com/login/oauth/authorize?")


async def test_disabled_provider(client, providers, monkeypatch):
    monkeypatch.setattr(settings, "oauth_github_client_id", None)
    r = await client.get(f"{API}/auth/oauth/github/start")
    assert r.status_code == 404
    assert (await client.get(f"{API}/auth/oauth/twitter/start")).status_code == 404


async def test_github_sign_in_creates_an_account_and_stores_the_forge_token(client, providers, db):
    params = await _start(client, providers, "github")
    fragment = await _callback(client, "github", params)
    assert set(fragment) == {"access_token", "refresh_token", "provider"}

    me = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {fragment['access_token']}"})
    assert me.status_code == 200
    body = me.json()
    assert body["username"] == "octo" and body["role"] == "viewer"
    assert (body["first_name"], body["last_name"], body["email"]) == ("Octo", "Cat", "octo@example.org")

    identity = await db.scalar(select(UserIdentity).where(UserIdentity.provider == "github"))
    assert identity.subject == "4242" and identity.username == "octo"
    assert "gh-tok" not in json.dumps(identity.profile)
    cred = await db.scalar(select(GitCredential))
    assert cred.host == "github.com" and cred.source == "oauth:github"
    assert "gh-tok" not in cred.secret  # encrypted at rest
    user = await db.get(User, body["id"])
    assert await git_credential_service.token_for_url(db, user, "https://github.com/o/r.git") == "gh-tok"

    # The same identity signs in to the same account.
    params = await _start(client, providers, "github", code="code-2")
    again = await _callback(client, "github", params, code="code-2")
    me2 = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {again['access_token']}"})
    assert me2.json()["id"] == body["id"]
    assert len((await db.scalars(select(User))).all()) == 1


async def test_callback_needs_the_matching_state_cookie(client, providers):
    params = await _start(client, providers, "github")
    r = await client.get(f"{API}/auth/oauth/github/callback", params={"code": "the-code", "state": "forged"})
    assert parse_qs(urlsplit(r.headers["location"]).fragment) == {"error": ["invalid_state"]}

    params = await _start(client, providers, "github")
    client.cookies.clear()
    fragment = await _callback(client, "github", params)
    assert fragment == {"error": "invalid_state"}

    # A state minted for one provider does not complete another.
    params = await _start(client, providers, "github")
    r = await client.get(f"{API}/auth/oauth/gitlab/callback", params={"code": "the-code", "state": params["state"]})
    assert "invalid_state" in r.headers["location"]


async def test_expired_state(providers, monkeypatch):
    url, cookie = oauth_service.start("github", None)
    state = parse_qs(urlsplit(url).query)["state"][0]
    assert oauth_service.read_state(cookie, "github", state)["provider"] == "github"
    real_time = oauth_service.time.time
    monkeypatch.setattr(oauth_service.time, "time", lambda: real_time() + oauth_service.STATE_TTL_SECONDS + 5)
    with pytest.raises(oauth_service.OAuthError) as exc:
        oauth_service.read_state(cookie, "github", state)
    assert exc.value.code == "expired_state"
    # A cookie sealed for another purpose does not open as a state.
    from app.core import crypto

    with pytest.raises(oauth_service.OAuthError):
        oauth_service.read_state(crypto.encrypt("{}", "git:1:github.com"), "github", state)


async def test_provider_error_and_bad_verifier(client, providers):
    r = await client.get(f"{API}/auth/oauth/github/callback", params={"error": "access_denied", "state": "x"})
    assert "error=access_denied" in r.headers["location"]
    params = await _start(client, providers, "github")
    providers.challenges["the-code"] = "not-the-challenge"
    fragment = await _callback(client, "github", params)
    assert fragment == {"error": "token_exchange_failed"}


async def test_signed_in_user_links_an_identity(client, providers, db, seed_roles):
    await create_user(db, "alice", "editor")
    headers = await login(client, "alice")
    params = await _start(client, providers, "gitlab", headers=headers)
    assert params["_url"].startswith("https://gitlab.example.org/oauth/authorize?")
    assert params["scope"] == "read_user api"
    fragment = await _callback(client, "gitlab", params)
    assert fragment["linked"] == "1"
    me = await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {fragment['access_token']}"})
    assert me.json()["username"] == "alice" and me.json()["role"] == "editor"
    cred = await db.scalar(select(GitCredential))
    assert cred.host == "gitlab.example.org" and cred.refresh_secret and cred.expires_at

    # That identity cannot be linked to someone else afterwards.
    await create_user(db, "bob", "editor")
    params = await _start(client, providers, "gitlab", headers=await login(client, "bob"), code="code-b")
    fragment = await _callback(client, "gitlab", params, code="code-b")
    assert fragment == {"error": "identity_in_use"}


async def test_orcid_fills_the_profile(client, providers, db):
    await create_user(db, "carol", "reviewer")
    headers = await login(client, "carol")
    params = await _start(client, providers, "orcid", headers=headers)
    assert params["_url"].startswith("https://sandbox.orcid.org/oauth/authorize?")
    assert params["scope"] == "/authenticate"
    await _callback(client, "orcid", params)
    me = (await client.get(f"{API}/auth/me", headers=headers)).json()
    assert me["orcid"] == "0000-0002-1825-0097"
    assert (me["first_name"], me["last_name"]) == ("Josiah", "Carberry")
    assert await db.scalar(select(GitCredential)) is None  # identity only


async def test_new_accounts_never_get_admin_and_usernames_stay_unique(client, providers, db, monkeypatch):
    await create_user(db, "octo", "viewer")
    monkeypatch.setattr(settings, "oauth_default_role", "admin")
    params = await _start(client, providers, "github")
    fragment = await _callback(client, "github", params)
    me = (await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {fragment['access_token']}"})).json()
    assert me["username"] == "octo-2" and me["role"] == "viewer"

    monkeypatch.setattr(settings, "oauth_default_role", "editor")
    providers.gitlab_user = {"id": 1, "username": "newbie", "name": "", "email": None}
    params = await _start(client, providers, "gitlab", code="c3")
    fragment = await _callback(client, "gitlab", params, code="c3")
    me = (await client.get(f"{API}/auth/me", headers={"Authorization": f"Bearer {fragment['access_token']}"})).json()
    assert me["role"] == "editor"


async def test_inactive_account_cannot_sign_in(client, providers, db):
    params = await _start(client, providers, "github")
    await _callback(client, "github", params)
    user = await db.scalar(select(User).where(User.username == "octo"))
    user.is_active = False
    await db.commit()
    params = await _start(client, providers, "github", code="c2")
    assert await _callback(client, "github", params, code="c2") == {"error": "account_disabled"}


async def test_expired_gitlab_token_is_refreshed(providers, db, seed_roles):
    user = await create_user(db, "gil", "editor")
    host = "gitlab.example.org"
    await git_credential_service.set_token(
        db,
        user,
        host,
        "old",
        refresh_token="gl-refresh",
        expires_at=datetime.now(UTC) - timedelta(minutes=1),
        source="oauth:gitlab",
    )
    assert await oauth_service.forge_token_for_host(db, user, host) == "refreshed-1"
    # Fresh now: no second refresh.
    assert await oauth_service.forge_token_for_host(db, user, host) == "refreshed-1"
    assert providers.token_counter == 1

    # A manual token never expires; an unknown host has none.
    await git_credential_service.set_token(db, user, "other.org", "pat")
    assert await oauth_service.forge_token_for_host(db, user, "other.org") == "pat"
    assert await oauth_service.forge_token_for_host(db, user, "nowhere.org") is None


async def test_token_sealed_for_one_user_does_not_open_for_another(db, seed_roles):
    alice = await create_user(db, "alice2", "editor")
    bob = await create_user(db, "bob2", "editor")
    await git_credential_service.set_token(db, alice, "github.com", "alice-token")
    cred = await db.scalar(select(GitCredential).where(GitCredential.user_id == alice.id))
    db.add(GitCredential(user_id=bob.id, host="github.com", secret=cred.secret))
    await db.commit()
    assert await git_credential_service.token_for_url(db, bob, "https://github.com/x/y") is None
