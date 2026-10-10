from sqlalchemy import String
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONB_or_JSON, TimestampMixin


class AppSettings(Base, TimestampMixin):
    """Instance-level settings: a single row keyed ``instance``.

    Server-side state that does not belong in the content repository (which
    carries its own `config.json`). The git remote and the setup wizard's
    decisions land here in later phases.
    """

    __tablename__ = "app_settings"

    id: Mapped[str] = mapped_column(String(32), primary_key=True, default="instance")
    data: Mapped[dict] = mapped_column(JSONB_or_JSON, default=dict)
