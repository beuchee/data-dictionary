import re

from pydantic import Field, field_validator

from app.schemas.base import CamelModel

_ORCID = re.compile(r"^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$")


def _orcid_check_digit(base_digits: str) -> str:
    """ISO 7064 MOD 11-2, the checksum ORCID iDs end with."""
    total = 0
    for digit in base_digits:
        total = (total + int(digit)) * 2
    result = (12 - total % 11) % 11
    return "X" if result == 10 else str(result)


def normalize_orcid(value: str | None) -> str | None:
    """A valid ORCID iD (`0000-0002-1825-0097`), its https://orcid.org/ URL
    reduced to the bare iD, or None for an empty value; raises otherwise."""
    if value is None:
        return None
    value = value.strip().removeprefix("https://orcid.org/").removeprefix("http://orcid.org/").upper()
    if not value:
        return None
    if not _ORCID.match(value):
        raise ValueError("ORCID iD must look like 0000-0000-0000-0000")
    digits = value.replace("-", "")
    if _orcid_check_digit(digits[:-1]) != digits[-1]:
        raise ValueError("ORCID iD checksum does not match")
    return value


class ProfileUpdate(CamelModel):
    """Self-service profile edit (PATCH /auth/me). Only fields a user may change
    on their own account, never role/is_active/username/password. Accepts
    camelCase (firstName…, as in a concept set's `createdByDetails`) or snake_case."""

    email: str | None = Field(default=None, max_length=255)
    first_name: str | None = Field(default=None, max_length=255)
    last_name: str | None = Field(default=None, max_length=255)
    affiliation: str | None = Field(default=None, max_length=255)
    profession: str | None = Field(default=None, max_length=255)
    orcid: str | None = None
    # Replaces the whole object: a caller sends the merged value.
    preferences: dict | None = None

    @field_validator("orcid")
    @classmethod
    def _valid_orcid(cls, value: str | None) -> str | None:
        return normalize_orcid(value)


class PasswordChange(CamelModel):
    current_password: str
    new_password: str
