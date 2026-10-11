# from linkr@1310cf4a4 (apps/api/app/models/git_credential.py)
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TimestampMixin


class GitCredential(Base, TimestampMixin):
    """A user's git access token for one remote host, encrypted at rest (core/crypto.py).

    Per (user, host), not per repository: a forge token works for every repo on
    its host, and keying it to the user means nobody pushes with another's token.
    Filled by a GitHub / GitLab sign-in (services/oauth_service.py). The plaintext
    is never returned by the API.
    """

    __tablename__ = "git_credentials"
    __table_args__ = (UniqueConstraint("user_id", "host", name="uq_git_credential_user_host"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    # Bare host, lowercased ("github.com"), with a non-default port ("gitea.local:3000").
    host: Mapped[str] = mapped_column(String(255))
    secret: Mapped[str] = mapped_column(Text)
    # OAuth tokens that expire (GitLab: 2 hours) come with a refresh token, sealed
    # like the secret and used to renew it before a push.
    refresh_secret: Mapped[str | None] = mapped_column(Text)
    expires_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    # "oauth:github", "oauth:gitlab"… or "manual".
    source: Mapped[str] = mapped_column(String(32), default="manual", server_default="manual")
