"""OAuth sign-in routes (services/oauth_service.py).

1. The web app calls `GET /auth/oauth/{provider}/start` (with its Bearer token
   to LINK the identity to the signed-in account, without one to sign in). The
   answer is `{authorizationUrl}` plus an HttpOnly state cookie; `?redirect=true`
   answers with the 302 itself, for a plain link.
2. The browser goes to the provider, which sends it back to
   `GET /auth/oauth/{provider}/callback?code=&state=` (registered redirect URI:
   `{DD_PUBLIC_URL}/api/v1/auth/oauth/{provider}/callback`).
3. The callback redirects to the web app's `{DD_PUBLIC_URL}/auth/callback` with
   `#access_token=…&refresh_token=…&provider=…[&linked=1]`, or `#error=<code>`.
   The fragment never reaches a server; the web app stores the tokens and
   clears it from the address bar.
"""

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse, RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_session_user_optional
from app.core.security import create_access_token, create_refresh_token
from app.models.user import User
from app.services import oauth_service
from app.services.oauth_service import OAuthError

router = APIRouter(prefix="/auth/oauth", tags=["auth"])


def _set_state_cookie(response, value: str) -> None:
    response.set_cookie(
        oauth_service.STATE_COOKIE,
        value,
        max_age=oauth_service.STATE_TTL_SECONDS,
        path=oauth_service.STATE_COOKIE_PATH,
        httponly=True,
        secure=oauth_service.cookie_secure(),
        samesite="lax",
    )


def _clear_state_cookie(response) -> None:
    response.delete_cookie(
        oauth_service.STATE_COOKIE,
        path=oauth_service.STATE_COOKIE_PATH,
        httponly=True,
        secure=oauth_service.cookie_secure(),
        samesite="lax",
    )


@router.get("/providers")
async def providers():
    """The enabled providers (also in /instance/config `server.authProviders`)."""
    return {"providers": oauth_service.enabled_providers()}


@router.get("/{provider}/start")
async def start(
    provider: str,
    redirect: bool = Query(False),
    user: User | None = Depends(get_session_user_optional),
):
    try:
        url, cookie = oauth_service.start(provider, user)
    except OAuthError as exc:
        return JSONResponse(status_code=404, content={"detail": {"code": exc.code, "message": str(exc)}})
    response = RedirectResponse(url, status_code=302) if redirect else JSONResponse({"authorizationUrl": url})
    _set_state_cookie(response, cookie)
    return response


@router.get("/{provider}/callback")
async def callback(
    provider: str,
    request: Request,
    code: str | None = None,
    state: str | None = None,
    error: str | None = None,
    db: AsyncSession = Depends(get_db),
):
    try:
        if error:
            # The user declined, or the provider refused: nothing to exchange.
            raise OAuthError("access_denied" if error == "access_denied" else "provider_error", error)
        payload = oauth_service.read_state(request.cookies.get(oauth_service.STATE_COOKIE), provider, state)
        if not code:
            raise OAuthError("missing_code")
        user = await oauth_service.complete(db, provider, code, payload)
        target = oauth_service.success_redirect(
            create_access_token(user.id, user.username, user.role),
            create_refresh_token(user.id, user.username, user.role),
            provider,
            linked=payload.get("linkUserId") is not None,
        )
    except OAuthError as exc:
        await db.rollback()
        target = oauth_service.error_redirect(exc.code)
    response = RedirectResponse(target, status_code=303)
    _clear_state_cookie(response)
    return response
