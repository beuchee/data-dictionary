"""Account administration (`users:manage`): list accounts, change a role,
deactivate / reactivate, set a temporary password; and the read-only roles."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.deps import require_permission
from app.core.permissions import ADMIN_ROLE, ALL_PERMISSIONS, CATALOGUE
from app.core.security import password_policy_error, set_password
from app.models.role import Role
from app.models.user import User
from app.models.user_identity import UserIdentity
from app.schemas.admin import AdminUser, IdentitySummary, PasswordReset, RoleResponse, RolesResponse, UserPatch

router = APIRouter(tags=["users"])

_manage = require_permission("users:manage")


def _conflict(code: str, message: str) -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, {"code": code, "message": message})


async def _identities_by_user(db: AsyncSession, user_ids: list[int]) -> dict[int, list[IdentitySummary]]:
    out: dict[int, list[IdentitySummary]] = {uid: [] for uid in user_ids}
    if not user_ids:
        return out
    rows = await db.scalars(select(UserIdentity).where(UserIdentity.user_id.in_(user_ids)).order_by(UserIdentity.id))
    for row in rows:
        out.setdefault(row.user_id, []).append(IdentitySummary.model_validate(row))
    return out


def admin_user(user: User, identities: list[IdentitySummary]) -> AdminUser:
    return AdminUser(
        id=user.id,
        username=user.username,
        email=user.email,
        first_name=user.first_name,
        last_name=user.last_name,
        role=user.role,
        is_active=user.is_active,
        last_login=user.last_login,
        created_at=user.created_at,
        has_password=user.password_hash is not None,
        identities=identities,
    )


async def _active_admins(db: AsyncSession) -> int:
    count = await db.scalar(select(func.count(User.id)).where(User.role == ADMIN_ROLE, User.is_active.is_(True)))
    return count or 0


async def _target(db: AsyncSession, user_id: int) -> User:
    user = await db.get(User, user_id)
    if user is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "User not found")
    return user


def _admin_only(message: str) -> HTTPException:
    return HTTPException(status.HTTP_403_FORBIDDEN, {"code": "admin_only", "message": message})


def _require_admin_for_admin_target(actor: User, target: User) -> None:
    """`users:manage` granted to a non-admin role must not reach an admin
    account: setting its password or deactivating it would take it over or
    lock it out."""
    if target.role == ADMIN_ROLE and actor.role != ADMIN_ROLE:
        raise _admin_only("Only an administrator may change an administrator's account")


@router.get("/users", response_model=list[AdminUser])
async def list_users(_admin: User = Depends(_manage), db: AsyncSession = Depends(get_db)):
    users = list(await db.scalars(select(User).order_by(func.lower(User.username))))
    identities = await _identities_by_user(db, [u.id for u in users])
    return [admin_user(u, identities.get(u.id, [])) for u in users]


@router.patch("/users/{user_id}", response_model=AdminUser)
async def update_user(
    user_id: int,
    body: UserPatch,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
):
    """Change a role and / or the active flag. Refused (409): leaving no active
    admin (`last_admin`), deactivating oneself (`self_deactivation`). Only an
    admin may give or take the admin role (403), so `users:manage` granted to
    another role never escalates to admin. Unknown role: 422."""
    user = await _target(db, user_id)
    _require_admin_for_admin_target(actor, user)
    changes = body.model_dump(exclude_unset=True)
    new_role = changes.get("role", user.role)
    new_active = changes.get("is_active", user.is_active)
    if new_role is None or new_active is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "role and isActive cannot be null")

    if new_role != user.role:
        if await db.scalar(select(Role).where(Role.name == new_role)) is None:
            raise HTTPException(
                status.HTTP_422_UNPROCESSABLE_CONTENT,
                {"code": "unknown_role", "message": f"No role named {new_role!r}"},
            )
        if ADMIN_ROLE in (new_role, user.role) and actor.role != ADMIN_ROLE:
            raise _admin_only("Only an administrator may give or take the admin role")
    if not new_active and user.id == actor.id:
        raise _conflict("self_deactivation", "You cannot deactivate your own account")

    was_active_admin = user.role == ADMIN_ROLE and user.is_active
    stays_active_admin = new_role == ADMIN_ROLE and new_active
    if was_active_admin and not stays_active_admin and await _active_admins(db) <= 1:
        raise _conflict("last_admin", "This is the last active administrator: promote another account first")

    user.role = new_role
    user.is_active = new_active
    await db.commit()
    await db.refresh(user)
    identities = await _identities_by_user(db, [user.id])
    return admin_user(user, identities[user.id])


@router.post("/users/{user_id}/reset-password", response_model=AdminUser)
async def reset_password(
    user_id: int,
    body: PasswordReset,
    actor: User = Depends(_manage),
    db: AsyncSession = Depends(get_db),
):
    """Set a temporary password (the admin tells the user, who changes it).
    Ends the account's current sessions. 422 when the password policy refuses
    it; 403 `admin_only` for an admin's account unless the caller is admin."""
    user = await _target(db, user_id)
    _require_admin_for_admin_target(actor, user)
    if error := password_policy_error(body.password, user.username):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
    set_password(user, body.password)
    await db.commit()
    await db.refresh(user)
    identities = await _identities_by_user(db, [user.id])
    return admin_user(user, identities[user.id])


@router.get("/roles", response_model=RolesResponse)
async def list_roles(_admin: User = Depends(_manage), db: AsyncSession = Depends(get_db)):
    """The roles with their permissions (admin: every permission, as enforced)."""
    rows = list(await db.scalars(select(Role)))
    order = {name: i for i, name in enumerate(["viewer", "reviewer", "editor", "maintainer", ADMIN_ROLE])}
    rows.sort(key=lambda r: (order.get(r.name, len(order)), r.name))
    roles = [
        RoleResponse(
            name=r.name,
            label=r.label or {},
            is_system=r.is_system,
            permissions=list(ALL_PERMISSIONS) if r.name == ADMIN_ROLE else list(r.permissions or []),
        )
        for r in rows
    ]
    return RolesResponse(roles=roles, catalogue=CATALOGUE)
