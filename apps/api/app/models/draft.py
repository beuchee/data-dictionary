from typing import Any

from sqlalchemy import ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONB_or_JSON, TimestampMixin, UUIDPKMixin


class Draft(Base, UUIDPKMixin, TimestampMixin):
    """A full replacement of one content file, held here until it is submitted
    as a proposal or a commit (docs/design/drafts-and-proposals.md). Deleted once
    submitted: from then on, the repository holds it."""

    __tablename__ = "drafts"

    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # concept-set | project | recommended-units | unit-conversions | mapping-recommendations | config
    kind: Mapped[str] = mapped_column(String(32))
    # Id of the concept set / project; None for a new one and for the single-file kinds.
    target_id: Mapped[int | None] = mapped_column(Integer)
    # Content-repo HEAD the edit started from.
    base_commit: Mapped[str | None] = mapped_column(String(64))
    content: Mapped[Any] = mapped_column(JSONB_or_JSON)
