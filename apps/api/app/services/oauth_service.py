"""OAuth sign-in with GitHub, GitLab (gitlab.com or self-hosted) and ORCID.

Authorization code flow with PKCE (S256) and a `state`, both bound to the
browser by a short-lived cookie: the cookie carries `{state, verifier,
provider, linkUserId, exp}` sealed with core/crypto.py, so the verifier never
leaves the server in clear, any worker can finish the flow, and a callback
URL replayed in another browser (login CSRF) has no matching cookie.

Redirect URIs are built from `DD_PUBLIC_URL` only (never from the request), and
client ids / secrets come from the environment only.

On callback the identity (`user_identities`, keyed by the provider's stable
subject) logs its account in, or is linked to the account that started the
flow while signed in, or creates a new account (`DD_OAUTH_DEFAULT_ROLE`, never
admin). Accounts are never matched by email: that would hand an account to
whoever controls an unverified provider email.

GitHub / GitLab tokens are stored, encrypted per (user, host), as the user's
forge credential: proposals are pushed and opened in their name. ORCID only
fills the profile's ORCID iD and, when empty, the name.
"""

from __future__ import annotations

import base64
import hashlib
import json
import re
import secrets
import time
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from urllib.parse import urlencode

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core import crypto
from app.core.permissions import ADMIN_ROLE, DEFAULT_USER_ROLE
from app.models.role import Role
from app.models.user import User
from app.models.user_identity import UserIdentity
from app.services import git_credential_service

logger = structlog.get_logger()

# Tests swap in an httpx.MockTransport.
transport: httpx.AsyncBaseTransport | None = None

STATE_COOKIE = "dd_oauth"
STATE_COOKIE_PATH = "/api/v1/auth/oauth"
STATE_TTL_SECONDS = 600
_STATE_CONTEXT = "oauth-state"
_TIMEOUT = 20.0
_ORCID_RE = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


class OAuthError(Exception):
    """`code` goes back to the web app in the callback fragment (`#error=…`)."""

    def __init__(self, code: str, message: str = ""):
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class Provider:
    name: str
    client_id: str
    client_secret: str
    authorize_url: str
    token_url: str
    scope: str
    api_base: str
    # Host whose git token this sign-in provides (None: identity only).
    forge_host: str | None = None
    extra_authorize: dict = field(default_factory=dict)


def _gitlab_base() -> str:
    return (settings.oauth_gitlab_base_url or "https://gitlab.com").rstrip("/")


def _orcid_base() -> str:
    return "https://sandbox.orcid.org" if settings.oauth_orcid_sandbox else "https://orcid.org"


def _orcid_api() -> str:
    return "https://pub.sandbox.orcid.org/v3.0" if settings.oauth_orcid_sandbox else "https://pub.orcid.org/v3.0"


def _providers() -> dict[str, Provider]:
    out: dict[str, Provider] = {}
    if settings.oauth_github_client_id and settings.oauth_github_client_secret:
        out["github"] = Provider(
            name="github",
            client_id=settings.oauth_github_client_id,
            client_secret=settings.oauth_github_client_secret,
            authorize_url="https://github.com/login/oauth/authorize",
            token_url="https://github.com/login/oauth/access_token",
            scope=settings.oauth_github_scope,
            api_base="https://api.github.com",
            forge_host="github.com",
        )
    if settings.oauth_gitlab_client_id and settings.oauth_gitlab_client_secret:
        base = _gitlab_base()
        out["gitlab"] = Provider(
            name="gitlab",
            client_id=settings.oauth_gitlab_client_id,
            client_secret=settings.oauth_gitlab_client_secret,
            authorize_url=f"{base}/oauth/authorize",
            token_url=f"{base}/oauth/token",
            scope=settings.oauth_gitlab_scope,
            api_base=f"{base}/api/v4",
            forge_host=git_credential_service.host_of(base),
        )
    if settings.oauth_orcid_client_id and settings.oauth_orcid_client_secret:
        base = _orcid_base()
        out["orcid"] = Provider(
            name="orcid",
            client_id=settings.oauth_orcid_client_id,
            client_secret=settings.oauth_orcid_client_secret,
            authorize_url=f"{base}/oauth/authorize",
            token_url=f"{base}/oauth/token",
            scope="/authenticate",
            api_base=_orcid_api(),
        )
    return out


def enabled_providers() -> list[str]:
    return list(_providers())


def get_provider(name: str) -> Provider:
    provider = _providers().get(name)
    if provider is None:
        raise OAuthError("provider_disabled", f"OAuth provider {name!r} is not enabled")
    return provider


def public_base() -> str:
    return settings.public_url.rstrip("/")


def redirect_uri(provider: str) -> str:
    return f"{public_base()}/api/v1/auth/oauth/{provider}/callback"


def web_callback_url() -> str:
    return f"{public_base()}/auth/callback"


def cookie_secure() -> bool:
    return public_base().startswith("https://")


# ---------------------------------------------------------------------------
# Start
# ---------------------------------------------------------------------------


def _challenge(verifier: str) -> str:
    return base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")


def start(name: str, link_user: User | None) -> tuple[str, str]:
    """(authorization URL, sealed state cookie value)."""
    provider = get_provider(name)
    state = secrets.token_urlsafe(32)
    verifier = secrets.token_urlsafe(64)
    sealed = crypto.encrypt(
        json.dumps(
            {
                "state": state,
                "verifier": verifier,
                "provider": name,
                "linkUserId": link_user.id if link_user is not None else None,
                "exp": int(time.time()) + STATE_TTL_SECONDS,
            }
        ),
        _STATE_CONTEXT,
    )
    params = {
        "client_id": provider.client_id,
        "redirect_uri": redirect_uri(name),
        "response_type": "code",
        "scope": provider.scope,
        "state": state,
        "code_challenge": _challenge(verifier),
        "code_challenge_method": "S256",
        **provider.extra_authorize,
    }
    return f"{provider.authorize_url}?{urlencode(params)}", sealed


def read_state(cookie: str | None, name: str, state: str | None) -> dict:
    """The sealed cookie's payload, when it matches this callback."""
    if not cookie or not state:
        raise OAuthError("invalid_state", "missing OAuth state")
    raw = crypto.decrypt(cookie, _STATE_CONTEXT)
    if raw is None:
        raise OAuthError("invalid_state", "unreadable OAuth state")
    try:
        payload = json.loads(raw)
    except ValueError:
        raise OAuthError("invalid_state", "unreadable OAuth state") from None
    if not secrets.compare_digest(str(payload.get("state", "")), state):
        raise OAuthError("invalid_state", "OAuth state mismatch")
    if payload.get("provider") != name:
        raise OAuthError("invalid_state", "OAuth provider mismatch")
    if int(payload.get("exp", 0)) < time.time():
        raise OAuthError("expired_state", "the sign-in took too long, start again")
    return payload


# ---------------------------------------------------------------------------
# Provider calls
# ---------------------------------------------------------------------------


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: datetime | None
    raw: dict


@dataclass
class Profile:
    subject: str
    username: str | None
    email: str | None
    given_name: str | None
    family_name: str | None
    raw: dict


def _client() -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=transport, timeout=_TIMEOUT, follow_redirects=False)


def _token_set(data: dict) -> TokenSet:
    token = data.get("access_token")
    if not isinstance(token, str) or not token:
        raise OAuthError("token_exchange_failed", str(data.get("error") or "no access token"))
    expires_in = data.get("expires_in")
    expires_at = datetime.now(UTC) + timedelta(seconds=int(expires_in)) if isinstance(expires_in, int | float) else None
    refresh = data.get("refresh_token")
    return TokenSet(token, refresh if isinstance(refresh, str) and refresh else None, expires_at, data)


async def _post_token(provider: Provider, form: dict) -> TokenSet:
    async with _client() as client:
        try:
            response = await client.post(provider.token_url, data=form, headers={"Accept": "application/json"})
        except httpx.HTTPError as exc:
            raise OAuthError("provider_unreachable", type(exc).__name__) from None
    try:
        data = response.json()
    except ValueError:
        data = {}
    if response.status_code != 200 or not isinstance(data, dict):
        raise OAuthError("token_exchange_failed", f"token endpoint answered {response.status_code}")
    return _token_set(data)


async def exchange_code(provider: Provider, code: str, verifier: str) -> TokenSet:
    return await _post_token(
        provider,
        {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri(provider.name),
            "client_id": provider.client_id,
            "client_secret": provider.client_secret,
            "code_verifier": verifier,
        },
    )


async def _get_json(url: str, token: str | None, accept: str = "application/json") -> object:
    headers = {"Accept": accept, "User-Agent": "data-dictionary"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    async with _client() as client:
        try:
            response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            raise OAuthError("provider_unreachable", type(exc).__name__) from None
    if response.status_code != 200:
        raise OAuthError("profile_failed", f"{url} answered {response.status_code}")
    try:
        return response.json()
    except ValueError:
        raise OAuthError("profile_failed", "profile is not JSON") from None


def _split_name(name: str | None) -> tuple[str | None, str | None]:
    parts = (name or "").strip().split(None, 1)
    if not parts:
        return None, None
    return parts[0], parts[1] if len(parts) > 1 else None


async def fetch_profile(provider: Provider, tokens: TokenSet) -> Profile:
    if provider.name == "github":
        data = await _get_json(f"{provider.api_base}/user", tokens.access_token, "application/vnd.github+json")
        if not isinstance(data, dict) or data.get("id") is None:
            raise OAuthError("profile_failed", "GitHub user without id")
        email = data.get("email")
        if not email:
            try:
                emails = await _get_json(
                    f"{provider.api_base}/user/emails", tokens.access_token, "application/vnd.github+json"
                )
            except OAuthError:
                emails = []
            for entry in emails if isinstance(emails, list) else []:
                if isinstance(entry, dict) and entry.get("primary") and entry.get("verified"):
                    email = entry.get("email")
        given, family = _split_name(data.get("name"))
        profile = {k: data.get(k) for k in ("id", "login", "name", "html_url", "avatar_url", "company")}
        return Profile(str(data["id"]), data.get("login"), email or None, given, family, profile)

    if provider.name == "gitlab":
        data = await _get_json(f"{provider.api_base}/user", tokens.access_token)
        if not isinstance(data, dict) or data.get("id") is None:
            raise OAuthError("profile_failed", "GitLab user without id")
        given, family = _split_name(data.get("name"))
        email = data.get("email") or data.get("public_email") or None
        profile = {k: data.get(k) for k in ("id", "username", "name", "web_url", "avatar_url", "organization")}
        return Profile(str(data["id"]), data.get("username"), email, given, family, profile)

    # ORCID: the token response names the iD; the public API gives the name parts.
    orcid = tokens.raw.get("orcid")
    if not isinstance(orcid, str) or not _ORCID_RE.match(orcid):
        raise OAuthError("profile_failed", "ORCID token without a valid iD")
    given, family = _split_name(tokens.raw.get("name"))
    try:
        details = await _get_json(f"{provider.api_base}/{orcid}/personal-details", tokens.access_token)
        name = details.get("name") if isinstance(details, dict) else None
        if isinstance(name, dict):
            given = ((name.get("given-names") or {}).get("value")) or given
            family = ((name.get("family-name") or {}).get("value")) or family
    except OAuthError:
        pass
    return Profile(orcid, orcid, None, given, family, {"orcid": orcid, "name": tokens.raw.get("name")})


# ---------------------------------------------------------------------------
# Accounts
# ---------------------------------------------------------------------------

_USERNAME_CHARS = re.compile(r"[^A-Za-z0-9_.-]+")


async def _free_username(db: AsyncSession, wanted: str) -> str:
    base = _USERNAME_CHARS.sub("-", wanted).strip("-.")[:60] or "user"
    candidate, n = base, 1
    while await db.scalar(select(User.id).where(User.username == candidate)) is not None:
        n += 1
        candidate = f"{base}-{n}"
    return candidate


async def _default_role(db: AsyncSession) -> str:
    role = (settings.oauth_default_role or DEFAULT_USER_ROLE).strip()
    if role == ADMIN_ROLE:
        logger.warning("oauth_default_role_admin_refused")
        return DEFAULT_USER_ROLE
    if await db.scalar(select(Role.id).where(Role.name == role)) is None:
        logger.warning("oauth_default_role_unknown", role=role)
        return DEFAULT_USER_ROLE
    return role


def _apply_profile(user: User, provider: str, profile: Profile) -> None:
    """Fill what the account lacks; never overwrite what the user set."""
    if not user.first_name and profile.given_name:
        user.first_name = profile.given_name[:255]
    if not user.last_name and profile.family_name:
        user.last_name = profile.family_name[:255]
    if not user.email and profile.email:
        user.email = profile.email[:255]
    if provider == "orcid" and not user.orcid:
        user.orcid = profile.subject


async def complete(db: AsyncSession, name: str, code: str, payload: dict) -> User:
    """Exchange the code, then log in / link / create the account."""
    provider = get_provider(name)
    tokens = await exchange_code(provider, code, payload["verifier"])
    profile = await fetch_profile(provider, tokens)

    identity = await db.scalar(
        select(UserIdentity).where(UserIdentity.provider == name, UserIdentity.subject == profile.subject)
    )
    link_user_id = payload.get("linkUserId")
    if link_user_id is not None:
        user = await db.get(User, int(link_user_id))
        if user is None or not user.is_active:
            raise OAuthError("account_disabled")
        if identity is not None and identity.user_id != user.id:
            raise OAuthError("identity_in_use", "this identity is linked to another account")
    elif identity is not None:
        user = await db.get(User, identity.user_id)
        if user is None or not user.is_active:
            raise OAuthError("account_disabled")
    else:
        user = User(
            username=await _free_username(db, profile.username or f"{name}-{profile.subject}"),
            role=await _default_role(db),
            password_hash=None,
            preferences={},
        )
        db.add(user)
        await db.flush()
        logger.info("oauth_account_created", provider=name, user_id=user.id)

    if identity is None:
        identity = UserIdentity(user_id=user.id, provider=name, subject=profile.subject)
        db.add(identity)
    identity.username = profile.username
    identity.email = profile.email
    identity.profile = profile.raw
    _apply_profile(user, name, profile)
    user.last_login = datetime.now(UTC)
    await db.commit()

    if provider.forge_host:
        await git_credential_service.set_token(
            db,
            user,
            provider.forge_host,
            tokens.access_token,
            refresh_token=tokens.refresh_token,
            expires_at=tokens.expires_at,
            source=f"oauth:{name}",
        )
    return user


async def forge_token_for_host(db: AsyncSession, user: User, host: str | None) -> str | None:
    """The user's forge token for `host`, renewed first when it is an expired
    GitLab OAuth token with a refresh token. None when there is none (or it
    cannot be renewed)."""
    stored = await git_credential_service.stored_token(db, user, host)
    if stored is None:
        return None
    expires_at = stored.expires_at
    if expires_at is not None and expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=UTC)
    if expires_at is None or expires_at > datetime.now(UTC) + timedelta(seconds=60):
        return stored.token
    provider = _providers().get(stored.source.removeprefix("oauth:")) if stored.source.startswith("oauth:") else None
    if provider is None or provider.forge_host != host or not stored.refresh_token:
        return None
    try:
        tokens = await _post_token(
            provider,
            {
                "grant_type": "refresh_token",
                "refresh_token": stored.refresh_token,
                "client_id": provider.client_id,
                "client_secret": provider.client_secret,
                "redirect_uri": redirect_uri(provider.name),
            },
        )
    except OAuthError as exc:
        logger.info("forge_token_refresh_failed", host=host, code=exc.code)
        return None
    await git_credential_service.set_token(
        db,
        user,
        host,
        tokens.access_token,
        refresh_token=tokens.refresh_token or stored.refresh_token,
        expires_at=tokens.expires_at,
        source=stored.source,
    )
    return tokens.access_token


def error_redirect(code: str) -> str:
    return f"{web_callback_url()}#{urlencode({'error': code})}"


def success_redirect(access_token: str, refresh_token: str, provider: str, linked: bool) -> str:
    fragment = {"access_token": access_token, "refresh_token": refresh_token, "provider": provider}
    if linked:
        fragment["linked"] = "1"
    return f"{web_callback_url()}#{urlencode(fragment)}"
