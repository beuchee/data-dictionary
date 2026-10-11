from datetime import UTC, datetime

import jwt
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core import login_throttle
from app.core.database import get_db
from app.core.deps import get_current_user, get_session_user
from app.core.permissions import user_permissions
from app.core.security import (
    burn_password_check,
    create_access_token,
    create_refresh_token,
    decode_token,
    password_policy_error,
    predates_password_change,
    set_password,
    verify_password,
)
from app.models.user import User
from app.schemas.api_token import ApiTokenCreate, ApiTokenCreated, ApiTokenResponse
from app.schemas.auth import LoginRequest, MeResponse, RefreshRequest, TokenResponse, UserResponse
from app.schemas.user import PasswordChange, ProfileUpdate
from app.services import api_token_service

router = APIRouter(prefix="/auth", tags=["auth"])


def _issue_tokens(user: User) -> TokenResponse:
    return TokenResponse(
        access_token=create_access_token(user.id, user.username, user.role),
        refresh_token=create_refresh_token(user.id, user.username, user.role),
        user=UserResponse.model_validate(user),
    )


def _client_address(http_request: Request) -> str:
    # nginx sets X-Real-IP (docker/nginx.conf); see core/login_throttle.py.
    forwarded = http_request.headers.get("x-real-ip", "").strip()
    if forwarded:
        return forwarded[:64]
    return http_request.client.host if http_request.client else "unknown"


@router.post("/login", response_model=TokenResponse)
async def login(request: LoginRequest, http_request: Request, db: AsyncSession = Depends(get_db)):
    client = _client_address(http_request)
    wait = login_throttle.retry_after(client, request.username)
    if wait is not None:
        raise HTTPException(
            status.HTTP_429_TOO_MANY_REQUESTS,
            {"code": "too_many_attempts", "message": "Too many failed sign-in attempts; try again later"},
            headers={"Retry-After": str(wait)},
        )

    def failed(detail: str) -> HTTPException:
        login_throttle.record_failure(client, request.username)
        return HTTPException(status.HTTP_401_UNAUTHORIZED, detail)

    user = await db.scalar(select(User).where(User.username == request.username))
    if user is None or user.password_hash is None:
        burn_password_check(request.password)
        raise failed("Invalid username or password")
    if not verify_password(request.password, user.password_hash):
        raise failed("Invalid username or password")
    if not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Account is disabled")

    login_throttle.record_success(client, request.username)
    user.last_login = datetime.now(UTC)
    await db.commit()
    return _issue_tokens(user)


@router.post("/refresh", response_model=TokenResponse)
async def refresh(request: RefreshRequest, db: AsyncSession = Depends(get_db)):
    """Exchange a refresh token for new access + refresh tokens."""
    try:
        payload = decode_token(request.refresh_token)
        if payload.get("type") != "refresh":
            raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid token type")
        user_id = int(payload["sub"])
    except (jwt.PyJWTError, KeyError, ValueError):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid or expired refresh token") from None

    user = await db.get(User, user_id)
    if not user or not user.is_active:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "User not found or inactive")
    if predates_password_change(payload, user):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Session ended by a password change")
    return _issue_tokens(user)


@router.post("/logout")
async def logout(_user: User = Depends(get_current_user)):
    """The tokens are stateless: the client discards them. Kept as an endpoint
    so server-side session state (OAuth tokens…) has a place to be dropped."""
    return {"ok": True}


async def _build_me(user: User, db: AsyncSession) -> MeResponse:
    return MeResponse(
        id=user.id,
        username=user.username,
        email=user.email,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        permissions=await user_permissions(db, user),
        first_name=user.first_name,
        last_name=user.last_name,
        affiliation=user.affiliation,
        profession=user.profession,
        orcid=user.orcid,
        preferences=user.preferences or {},
    )


@router.get("/me", response_model=MeResponse)
async def me(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _build_me(user, db)


@router.patch("/me", response_model=MeResponse)
async def update_me(
    body: ProfileUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    for key, value in body.model_dump(exclude_unset=True).items():
        if key == "preferences" and value is None:
            value = {}
        elif isinstance(value, str):
            value = value.strip() or None
        setattr(user, key, value)
    await db.commit()
    await db.refresh(user)
    return await _build_me(user, db)


@router.post("/change-password", response_model=TokenResponse)
async def change_password(
    body: PasswordChange,
    user: User = Depends(get_session_user),
    db: AsyncSession = Depends(get_db),
):
    """Change one's own password. The current one proves it is the user at the
    keyboard, not a stolen session; an API token cannot call this at all.

    Every session issued before the change ends; the caller gets fresh tokens."""
    if not user.password_hash:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "This account signs in through an identity provider")
    if not verify_password(body.current_password, user.password_hash):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "The current password is incorrect")
    if body.new_password == body.current_password:
        raise HTTPException(
            status.HTTP_422_UNPROCESSABLE_CONTENT,
            {"code": "password_same_as_current", "message": "The new password is the current one."},
        )
    if error := password_policy_error(body.new_password, user.username):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
    set_password(user, body.new_password)
    user.must_change_password = False
    await db.commit()
    return _issue_tokens(user)


# Personal API tokens. All three require a session JWT (get_session_user): an
# API token cannot mint, list or revoke tokens.


@router.get("/api-tokens", response_model=list[ApiTokenResponse])
async def list_api_tokens(user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)):
    return await api_token_service.list_tokens(db, user)


@router.post("/api-tokens", response_model=ApiTokenCreated, status_code=status.HTTP_201_CREATED)
async def create_api_token(
    body: ApiTokenCreate,
    user: User = Depends(get_session_user),
    db: AsyncSession = Depends(get_db),
):
    token, plaintext = await api_token_service.create_token(db, user, body.name, body.expires_in_days)
    return ApiTokenCreated(**ApiTokenResponse.model_validate(token).model_dump(), token=plaintext)


@router.delete("/api-tokens/{token_id}", response_model=ApiTokenResponse)
async def revoke_api_token(
    token_id: str,
    user: User = Depends(get_session_user),
    db: AsyncSession = Depends(get_db),
):
    token = await api_token_service.revoke_token(db, user, token_id)
    if token is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "API token not found")
    return token
