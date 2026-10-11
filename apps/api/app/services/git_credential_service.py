# from linkr@1310cf4a4 (apps/api/app/services/git_credential_service.py),
# plus the refresh token and expiry of OAuth tokens.
"""Per-(user, host) git access tokens.

A token is stored once per user per remote host and reused for every repo on
that host. Git operations resolve the host from the remote URL, then look up
the token of the ACTING user, so nobody pushes with another user's credential.
Tokens are encrypted at rest (core/crypto.py), sealed to (user, host), and never
returned by the API nor logged.
"""

import re
from dataclasses import dataclass
from datetime import datetime
from urllib.parse import urlsplit

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import crypto
from app.models.git_credential import GitCredential
from app.models.user import User

# scp-style ssh remote: [user@]host:path (no scheme).
_SCP_RE = re.compile(r"^(?:[^@/]+@)?(?P<host>[^:/]+):(?!/)")


def secret_context(user_id: int, host: str) -> str:
    """What a git token is sealed to: it only opens for this user and host."""
    return f"git:{user_id}:{host}"


def refresh_context(user_id: int, host: str) -> str:
    return f"git-refresh:{user_id}:{host}"


def host_of(url: str | None) -> str | None:
    """Bare host of a git remote URL, lowercased, with a non-default port kept.
    Handles http(s)://, ssh:// and scp-style git@host:path; None when no host."""
    url = (url or "").strip()
    if not url:
        return None
    if "://" in url:
        parts = urlsplit(url)
        host = parts.hostname
        if not host:
            return None
        host = host.lower()
        default_port = {"https": 443, "http": 80, "ssh": 22, "git": 9418}.get(parts.scheme)
        try:
            port = parts.port
        except ValueError:
            return None
        if port and port != default_port:
            return f"{host}:{port}"
        return host
    m = _SCP_RE.match(url)
    return m.group("host").lower() if m else None


@dataclass
class StoredToken:
    token: str
    refresh_token: str | None
    expires_at: datetime | None
    source: str


async def _get(db: AsyncSession, user_id: int, host: str) -> GitCredential | None:
    return await db.scalar(select(GitCredential).where(GitCredential.user_id == user_id, GitCredential.host == host))


async def set_token(
    db: AsyncSession,
    user: User,
    host: str,
    token: str | None,
    *,
    refresh_token: str | None = None,
    expires_at: datetime | None = None,
    source: str = "manual",
) -> None:
    """Upsert (or, with an empty token, delete) the user's token for `host`."""
    host = (host or "").strip().lower()
    if not host:
        return
    existing = await _get(db, user.id, host)
    if not token:
        if existing is not None:
            await db.delete(existing)
            await db.commit()
        return
    secret = crypto.encrypt(token, secret_context(user.id, host))
    refresh_secret = crypto.encrypt(refresh_token, refresh_context(user.id, host)) if refresh_token else None
    if existing is None:
        db.add(
            GitCredential(
                user_id=user.id,
                host=host,
                secret=secret,
                refresh_secret=refresh_secret,
                expires_at=expires_at,
                source=source,
            )
        )
    else:
        existing.secret = secret
        existing.refresh_secret = refresh_secret
        existing.expires_at = expires_at
        existing.source = source
    await db.commit()


async def stored_token(db: AsyncSession, user: User, host: str | None) -> StoredToken | None:
    host = (host or "").strip().lower()
    if not host:
        return None
    cred = await _get(db, user.id, host)
    if cred is None:
        return None
    token = crypto.decrypt(cred.secret, secret_context(user.id, host))
    if token is None:
        return None
    return StoredToken(
        token=token,
        refresh_token=crypto.decrypt(cred.refresh_secret, refresh_context(user.id, host)),
        expires_at=cred.expires_at,
        source=cred.source,
    )


async def token_for_url(db: AsyncSession, user: User, url: str | None) -> str | None:
    stored = await stored_token(db, user, host_of(url))
    return stored.token if stored else None


async def has_token_for_host(db: AsyncSession, user: User, host: str) -> bool:
    return (await _get(db, user.id, (host or "").strip().lower())) is not None
