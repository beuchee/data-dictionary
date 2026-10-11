from datetime import datetime
from typing import Any, Literal

from pydantic import Field, field_validator, model_validator

from app.schemas.base import CamelModel

DraftKind = Literal[
    "concept-set",
    "project",
    "recommended-units",
    "unit-conversions",
    "mapping-recommendations",
    "config",
]
_ID_KINDS = ("concept-set", "project")
_SHA = r"^[0-9a-f]{7,64}$"


class DraftCreate(CamelModel):
    kind: DraftKind
    target_id: int | None = Field(default=None, ge=1)
    base_commit: str | None = Field(default=None, pattern=_SHA)
    content: Any

    @model_validator(mode="after")
    def _target_matches_kind(self):
        if self.kind not in _ID_KINDS and self.target_id is not None:
            raise ValueError(f"targetId must be null for a {self.kind} draft")
        return self

    @field_validator("content")
    @classmethod
    def _json_document(cls, value: Any) -> Any:
        if not isinstance(value, (dict, list)):
            raise ValueError("content must be a JSON object or array")
        return value


class DraftUpdate(CamelModel):
    """Replaces the content (and, when given, the base commit)."""

    base_commit: str | None = Field(default=None, pattern=_SHA)
    content: Any

    @field_validator("content")
    @classmethod
    def _json_document(cls, value: Any) -> Any:
        if not isinstance(value, (dict, list)):
            raise ValueError("content must be a JSON object or array")
        return value


class DraftResponse(CamelModel):
    id: str
    user_id: int
    kind: str
    target_id: int | None
    base_commit: str | None
    content: Any
    created_at: datetime
    updated_at: datetime


class DraftSummary(CamelModel):
    """A draft without its content, for lists."""

    id: str
    kind: str
    target_id: int | None
    base_commit: str | None
    created_at: datetime
    updated_at: datetime


class DraftSubmit(CamelModel):
    mode: Literal["proposal", "commit"]
    message: str | None = Field(default=None, max_length=10_000)
