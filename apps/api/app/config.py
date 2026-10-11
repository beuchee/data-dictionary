from functools import cached_property
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

# apps/api/.env, resolved absolutely so it loads whatever directory uvicorn is
# launched from.
_ENV_FILE = Path(__file__).resolve().parent.parent / ".env"

INSECURE_SECRET_KEY = "insecure-dev-secret-change-in-production"


class Settings(BaseSettings):
    """Application settings, read from `DD_*` environment variables."""

    app_name: str = "INDICATE Data Dictionary"
    app_version: str = "2.0.0-dev"
    debug: bool = False

    # Unset: a SQLite file inside data_dir, next to the other instance state.
    database_url: str | None = None
    data_dir: str = "~/.data-dictionary"
    # Working copy of the content repository (concept_sets/, projects/, config.json…).
    # Unset: the repo this API runs from in development (found by walking up from
    # apps/api), else {data_dir}/content, which is where Docker keeps it.
    # TODO(v2-phase-2): clone the configured repository there on first start.
    content_dir: str | None = None

    # Server folders an admin may import an ATHENA export from (comma-separated,
    # absolute). Empty: imports come from browser uploads only.
    vocabulary_import_roots: str = ""

    secret_key: str = INSECURE_SECRET_KEY
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 60 * 24
    refresh_token_expire_days: int = 30
    # Key sealing secrets at rest (git and OAuth tokens), see core/crypto.py.
    # Unset: generated once into data_dir/secret.key. Old keys stay readable.
    encryption_key: str | None = None
    encryption_old_keys: str = ""
    # NIST SP 800-63B sets 8 as the floor even behind a second factor.
    password_min_length: int = Field(12, ge=8)

    # Comma-separated in the environment; read through cors_origin_list.
    cors_origins: str = "http://localhost:3000"

    model_config = SettingsConfigDict(env_prefix="DD_", env_file=str(_ENV_FILE), extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def vocabulary_import_root_list(self) -> list[Path]:
        return [Path(p.strip()).expanduser().resolve() for p in self.vocabulary_import_roots.split(",") if p.strip()]

    @cached_property
    def data_path(self) -> Path:
        """Resolved data directory, created on first access (not at import)."""
        path = Path(self.data_dir).expanduser().resolve()
        path.mkdir(parents=True, exist_ok=True)
        return path

    @property
    def content_path(self) -> Path:
        if self.content_dir:
            return Path(self.content_dir).expanduser().resolve()
        from app.services.content_store import find_content_root

        return find_content_root(Path(__file__).resolve().parent) or self.data_path / "content"

    @property
    def resolved_database_url(self) -> str:
        if self.database_url:
            return self.database_url
        return f"sqlite+aiosqlite:///{self.data_path / 'data-dictionary.db'}"


settings = Settings()
