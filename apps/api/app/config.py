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
    content_dir: str | None = None
    # The content repository (services/git_service.py). With a URL, the API clones
    # it (full history) into content_dir on first start, pulls from it and pushes
    # its commits and proposal branches there. Unset: the working copy's `origin`.
    content_repo_url: str | None = None
    # Unset: config.json `repository.branch`, else "main".
    content_branch: str | None = None
    # Service token (https remotes): clone/fetch of a private repo, direct commits,
    # and proposals of users who did not sign in with the forge. Never logged.
    git_token: str | None = None
    git_author_name: str = "Data Dictionary"
    git_author_email: str = "data-dictionary@localhost"

    # Public base URL of the web app, which serves the API under /api/v1 (nginx in
    # Docker, the Vite proxy in development). Builds the OAuth redirect URIs.
    public_url: str = "http://localhost:3000"
    # OAuth sign-in providers, each enabled by its client id + secret.
    oauth_github_client_id: str | None = None
    oauth_github_client_secret: str | None = None
    # `repo` instead of `public_repo` when the content repository is private.
    oauth_github_scope: str = "read:user user:email public_repo"
    oauth_gitlab_client_id: str | None = None
    oauth_gitlab_client_secret: str | None = None
    oauth_gitlab_base_url: str = "https://gitlab.com"
    oauth_gitlab_scope: str = "read_user api"
    oauth_orcid_client_id: str | None = None
    oauth_orcid_client_secret: str | None = None
    oauth_orcid_sandbox: bool = False
    # Role given to an account created by an OAuth sign-in.
    oauth_default_role: str = "viewer"

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
