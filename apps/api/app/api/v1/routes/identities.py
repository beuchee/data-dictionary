"""The signed-in user's linked sign-in identities (GitHub, GitLab, ORCID).

Linking goes through `GET /auth/oauth/{provider}/start` with the Bearer token
(routes/oauth.py); this lists and unlinks them. Session JWT only: an API token
cannot change how the account signs in."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import get_session_user
from app.models.git_credential import GitCredential
from app.models.user import User
from app.models.user_identity import UserIdentity
from app.schemas.admin import AccountIdentities, IdentitySummary

router = APIRouter(prefix="/auth/identities", tags=["auth"])


async def _identities(db: AsyncSession, user: User) -> list[UserIdentity]:
    return list(await db.scalars(select(UserIdentity).where(UserIdentity.user_id == user.id).order_by(UserIdentity.id)))


@router.get("", response_model=AccountIdentities)
async def list_identities(user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)):
    rows = await _identities(db, user)
    return AccountIdentities(
        has_password=user.password_hash is not None,
        identities=[IdentitySummary.model_validate(r) for r in rows],
    )


@router.delete("/{identity_id}", response_model=AccountIdentities)
async def unlink_identity(identity_id: int, user: User = Depends(get_session_user), db: AsyncSession = Depends(get_db)):
    """Unlink one identity. Refused (409 `last_sign_in_method`) when it is the
    only way left to sign in: no local password and no other identity. The forge
    token that identity stored goes with it, unless another identity of the same
    provider remains."""
    rows = await _identities(db, user)
    target = next((r for r in rows if r.id == identity_id), None)
    if target is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Identity not found")
    if user.password_hash is None and len(rows) <= 1:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            {
                "code": "last_sign_in_method",
                "message": "Set a password or link another account before unlinking this one",
            },
        )
    await db.delete(target)
    same_provider_left = await db.scalar(
        select(func.count(UserIdentity.id)).where(
            UserIdentity.user_id == user.id,
            UserIdentity.provider == target.provider,
            UserIdentity.id != target.id,
        )
    )
    if not same_provider_left:
        await db.execute(
            delete(GitCredential).where(
                GitCredential.user_id == user.id, GitCredential.source == f"oauth:{target.provider}"
            )
        )
    await db.commit()
    rows = await _identities(db, user)
    return AccountIdentities(
        has_password=user.password_hash is not None,
        identities=[IdentitySummary.model_validate(r) for r in rows],
    )
