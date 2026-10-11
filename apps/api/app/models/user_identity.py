from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONB_or_JSON, TimestampMixin


class UserIdentity(Base, TimestampMixin):
    """An external identity (GitHub, GitLab, ORCID) linked to a local account.

    `subject` is the provider's stable user id (GitHub / GitLab numeric id, ORCID
    iD), never the username, which can change. An identity belongs to one
    account; an account may link several.
    """

    __tablename__ = "user_identities"
    __table_args__ = (UniqueConstraint("provider", "subject", name="uq_user_identity_provider_subject"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    provider: Mapped[str] = mapped_column(String(32))
    subject: Mapped[str] = mapped_column(String(255))
    username: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))
    # The provider's profile as of the last sign-in (never a token).
    profile: Mapped[dict] = mapped_column(JSONB_or_JSON, default=dict)
