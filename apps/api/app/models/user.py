from datetime import datetime

from sqlalchemy import DateTime, String
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.sql import expression

from app.models.base import Base, JSONB_or_JSON, TimestampMixin


class User(Base, TimestampMixin):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    username: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    email: Mapped[str | None] = mapped_column(String(255))
    # The profile fields feed a concept set's `metadata.createdByDetails` and
    # its reviews, so they are plain strings like there.
    first_name: Mapped[str | None] = mapped_column(String(255))
    last_name: Mapped[str | None] = mapped_column(String(255))
    affiliation: Mapped[str | None] = mapped_column(String(255))
    profession: Mapped[str | None] = mapped_column(String(255))
    orcid: Mapped[str | None] = mapped_column(String(19))
    # Nullable: an account created through OAuth has no local password.
    password_hash: Mapped[str | None] = mapped_column(String(255))
    # Name of a Role row (core/permissions.py); "admin" bypasses the catalogue.
    role: Mapped[str] = mapped_column(String(50), default="viewer", server_default="viewer")
    is_active: Mapped[bool] = mapped_column(default=True, server_default=expression.true())
    last_login: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Session tokens issued before it are refused (core/security.py).
    password_changed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # Set when an administrator chose the password (account creation, reset);
    # cleared when the user changes it. The web app blocks until then.
    must_change_password: Mapped[bool] = mapped_column(default=False, server_default=expression.false())
    preferences: Mapped[dict] = mapped_column(JSONB_or_JSON, default=dict)
