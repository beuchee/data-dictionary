from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


class IdentitySummary(CamelModel):
    id: int
    provider: str
    username: str | None = None
    email: str | None = None
    created_at: datetime | None = None


class AdminUser(CamelModel):
    """One account as the Users admin tab lists it."""

    id: int
    username: str
    email: str | None = None
    first_name: str | None = None
    last_name: str | None = None
    role: str
    is_active: bool
    last_login: datetime | None = None
    created_at: datetime | None = None
    # A local password is one sign-in method; each identity is another.
    has_password: bool
    identities: list[IdentitySummary] = []


class UserPatch(CamelModel):
    role: str | None = Field(default=None, min_length=1, max_length=50)
    is_active: bool | None = None


class PasswordReset(CamelModel):
    password: str


class RoleResponse(CamelModel):
    name: str
    label: dict
    is_system: bool
    permissions: list[str]


class RolesResponse(CamelModel):
    roles: list[RoleResponse]
    # The code-owned permission catalogue, in display order.
    catalogue: dict[str, list[str]]


class AccountIdentities(CamelModel):
    has_password: bool
    identities: list[IdentitySummary]
