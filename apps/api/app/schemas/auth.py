from pydantic import BaseModel

# These schemas stay snake_case (access_token, needs_setup, first_name…): the
# auth client and store carried over from Linkr read these keys literally. The
# one exception to the camelCase API convention (CamelModel).


class LoginRequest(BaseModel):
    username: str
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class UserResponse(BaseModel):
    id: int
    username: str
    email: str | None
    role: str
    is_active: bool
    # An administrator chose the current password: the web app asks for a new one.
    must_change_password: bool = False

    model_config = {"from_attributes": True}


class MeResponse(BaseModel):
    """The current user, their profile, and every permission their role grants,
    so the UI can gate actions without a second call."""

    id: int
    username: str
    email: str | None
    role: str
    is_active: bool
    must_change_password: bool = False
    permissions: list[str]
    first_name: str | None = None
    last_name: str | None = None
    affiliation: str | None = None
    profession: str | None = None
    orcid: str | None = None
    preferences: dict = {}


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"
    user: UserResponse


class SetupStatusResponse(BaseModel):
    needs_setup: bool
    # DD_PASSWORD_MIN_LENGTH, so the forms state the rule before the round trip.
    password_min_length: int = 12


class SetupRequest(BaseModel):
    username: str
    email: str | None = None
    password: str
    first_name: str | None = None
    last_name: str | None = None
