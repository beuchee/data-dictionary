"""The global permission catalogue and the system roles built from it.

There is no workspace or project scoping: one dictionary per instance, so a
user holds exactly one role and that role's permissions apply everywhere.
"""

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.role import Role
from app.models.user import User

# Code-owned: adding a resource or action is a code change. Roles pick from
# it, and the UI renders the role matrix in this order.
#   propose = save a draft and submit it as a pull/merge request
#   commit  = write to the main branch directly, and merge proposals
CATALOGUE: dict[str, list[str]] = {
    "concept-sets": ["read", "propose", "commit"],
    "projects": ["read", "propose", "commit"],
    "reviews": ["write"],
    "mappings": ["read", "write"],
    "units": ["write"],
    "branding": ["write"],
    "users": ["manage"],
    "settings": ["manage"],
}

ALL_PERMISSIONS = [f"{resource}:{action}" for resource, actions in CATALOGUE.items() for action in actions]

_VIEWER = ["concept-sets:read", "projects:read", "mappings:read"]
_REVIEWER = [*_VIEWER, "reviews:write"]
_EDITOR = [*_REVIEWER, "concept-sets:propose", "projects:propose", "mappings:write"]
_MAINTAINER = [*_EDITOR, "concept-sets:commit", "projects:commit", "units:write", "branding:write"]

# Seeded at startup when absent; each is a superset of the one before.
DEFAULT_ROLES = [
    {"name": "viewer", "label": {"en": "Viewer", "fr": "Lecteur"}, "permissions": _VIEWER},
    {"name": "reviewer", "label": {"en": "Reviewer", "fr": "Relecteur"}, "permissions": _REVIEWER},
    {"name": "editor", "label": {"en": "Editor", "fr": "Éditeur"}, "permissions": _EDITOR},
    {"name": "maintainer", "label": {"en": "Maintainer", "fr": "Mainteneur"}, "permissions": _MAINTAINER},
    {"name": "admin", "label": {"en": "Administrator", "fr": "Administrateur"}, "permissions": ALL_PERMISSIONS},
]

ADMIN_ROLE = "admin"
DEFAULT_USER_ROLE = "viewer"


async def seed_default_roles(db: AsyncSession) -> None:
    """Create any missing system role. Existing roles are left untouched so an
    admin's edits to their permissions survive restarts."""
    for spec in DEFAULT_ROLES:
        existing = await db.scalar(select(Role).where(Role.name == spec["name"]))
        if existing is None:
            db.add(Role(is_system=True, **spec))
    await db.commit()


async def user_permissions(db: AsyncSession, user: User) -> list[str]:
    """Every permission `user` holds. The admin role is a hard super-admin that
    bypasses its Role row, so editing roles can never lock everyone out."""
    if user.role == ADMIN_ROLE:
        return list(ALL_PERMISSIONS)
    role = await db.scalar(select(Role).where(Role.name == user.role))
    return list(role.permissions or []) if role is not None else []


async def has_permission(db: AsyncSession, user: User, permission: str) -> bool:
    return permission in await user_permissions(db, user)
