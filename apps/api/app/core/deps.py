import jwt
from fastapi import Depends, HTTPException, status
from fastapi.concurrency import run_in_threadpool
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.permissions import ADMIN_ROLE, has_permission
from app.core.security import decode_token, predates_password_change
from app.models.user import User
from app.services import api_token_service
from app.services.content_store import ContentStore, get_content_store

bearer_scheme = HTTPBearer()
optional_bearer_scheme = HTTPBearer(auto_error=False)


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=detail)


async def get_session_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Like get_current_user but refuses API tokens: only a session access JWT.

    Guards the token-management and password routes, so a leaked API token can
    neither mint new ones, hide itself by revoking its siblings, nor take over
    the account.
    """
    try:
        payload = decode_token(credentials.credentials)
        if payload.get("type") != "access":
            raise _unauthorized("Invalid token type")
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise _unauthorized("Invalid or expired token") from None

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise _unauthorized("User not found or inactive")
    if predates_password_change(payload, user):
        raise _unauthorized("Session ended by a password change")
    return user


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User:
    """Resolve the Bearer credential to a User: a personal API token (``ddt_…``)
    or a session access JWT. Both act with the user's own permissions."""
    if api_token_service.is_api_token(credentials.credentials):
        user = await api_token_service.authenticate(db, credentials.credentials)
        if user is None:
            raise _unauthorized("Invalid, revoked or expired API token")
        return user
    return await get_session_user(credentials, db)


async def get_current_user_optional(
    credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer_scheme),
    db: AsyncSession = Depends(get_db),
) -> User | None:
    """Like get_current_user but None instead of 401 when no valid credential
    is present, for endpoints readable anonymously."""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials, db)
    except HTTPException:
        return None


async def get_current_admin(user: User = Depends(get_current_user)) -> User:
    if user.role != ADMIN_ROLE:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Admin access required")
    return user


def require_permission(permission: str):
    """Dependency factory: the current user, if their role grants `permission`."""

    async def _dep(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)) -> User:
        if not await has_permission(db, user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return _dep


def require_read(permission: str):
    """Dependency factory for content read routes. Anyone may read while
    `config.json` → `access.anonymousRead` is true (the default); otherwise the
    caller must be logged in with `permission`. Returns the user, or None for an
    anonymous reader."""

    async def _dep(
        credentials: HTTPAuthorizationCredentials | None = Depends(optional_bearer_scheme),
        db: AsyncSession = Depends(get_db),
        store: ContentStore = Depends(get_content_store),
    ) -> User | None:
        catalogue = await run_in_threadpool(store.catalogue)
        if catalogue.anonymous_read:
            return None
        if credentials is None:
            raise _unauthorized("Login required")
        user = await get_current_user(credentials, db)
        if not await has_permission(db, user, permission):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Insufficient permissions")
        return user

    return _dep
