from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import expression

from app.models.base import Base, JSONB_or_JSON, TimestampMixin, UUIDPKMixin


class Role(Base, UUIDPKMixin, TimestampMixin):
    __tablename__ = "roles"

    # Machine key referenced by users.role (e.g. "editor").
    name: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    label: Mapped[dict] = mapped_column(JSONB_or_JSON, default=dict)  # {"en": ..., "fr": ...}
    # System roles ship by default and cannot be deleted; their permissions stay editable.
    is_system: Mapped[bool] = mapped_column(Boolean, default=False, server_default=expression.false())
    # Flat list of "resource:action" strings drawn from the code-defined catalogue.
    permissions: Mapped[list] = mapped_column(JSONB_or_JSON, default=list)
