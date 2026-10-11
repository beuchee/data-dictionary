from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, LargeBinary, String, Text, func
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, JSONB_or_JSON, UUIDPKMixin


class MappingImport(Base, UUIDPKMixin):
    """An imported mapping (STCM, Usagi, SSSOM…), shared by the instance and
    never versioned in the content repo (v2 plan §7). Its rows live in
    `mapping_import_rows`, so listing imports never loads them."""

    __tablename__ = "mapping_imports"

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    format: Mapped[str] = mapped_column(String(32))
    # The uploaded file names, comma-separated (several for C/CR).
    source_file_name: Mapped[str] = mapped_column(String(1024))
    # The parse options (format, delimiter, encoding, sheet, column roles…).
    options: Mapped[dict] = mapped_column(JSONB_or_JSON, default=dict)
    stats: Mapped[dict] = mapped_column(JSONB_or_JSON, default=dict)
    warnings: Mapped[list] = mapped_column(JSONB_or_JSON, default=list)
    # Statuses counted by default (Usagi, Linkr: approved); null = every row.
    default_statuses: Mapped[list | None] = mapped_column(JSONB_or_JSON)
    created_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), index=True)
    created_by: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class MappingImportRows(Base):
    """The normalized rows of one import, as one gzip'd JSON array.

    A blob rather than a row per mapping: the rows are immutable, always read
    whole (coverage is evaluated in the browser against resolved lists) and
    never queried one by one, while an import can hold hundreds of thousands of
    them. One compressed value makes create and read a single statement, keeps
    SQLite and PostgreSQL identical, and is ~10x smaller than the JSON.
    """

    __tablename__ = "mapping_import_rows"

    import_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("mapping_imports.id", ondelete="CASCADE"), primary_key=True
    )
    row_count: Mapped[int] = mapped_column(Integer)
    data: Mapped[bytes] = mapped_column(LargeBinary)
