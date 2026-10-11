"""Settings that are only safe on a developer's machine refuse to boot."""

import pytest

from app.config import INSECURE_SECRET_KEY, Settings, settings
from app.main import check_production_settings

STRONG = "a-strong-secret-for-tests-0123456789abcdef"


def test_the_default_secret_refuses_to_boot_outside_debug(monkeypatch):
    monkeypatch.setattr(settings, "secret_key", INSECURE_SECRET_KEY)
    monkeypatch.setattr(settings, "debug", False)
    with pytest.raises(RuntimeError, match="DD_SECRET_KEY"):
        check_production_settings()


def test_the_default_secret_is_tolerated_in_debug(monkeypatch):
    monkeypatch.setattr(settings, "secret_key", INSECURE_SECRET_KEY)
    monkeypatch.setattr(settings, "debug", True)
    check_production_settings()


def test_a_short_secret_refuses_to_boot_outside_debug(monkeypatch):
    monkeypatch.setattr(settings, "secret_key", "too-short")
    monkeypatch.setattr(settings, "debug", False)
    with pytest.raises(RuntimeError, match="32 bytes"):
        check_production_settings()


def test_a_wildcard_cors_origin_refuses_to_boot_outside_debug(monkeypatch):
    monkeypatch.setattr(settings, "secret_key", STRONG)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "cors_origins", "https://dd.example.org, *")
    with pytest.raises(RuntimeError, match="DD_CORS_ORIGINS"):
        check_production_settings()


def test_a_real_configuration_boots(monkeypatch):
    monkeypatch.setattr(settings, "secret_key", STRONG)
    monkeypatch.setattr(settings, "debug", False)
    monkeypatch.setattr(settings, "cors_origins", "https://dd.example.org")
    check_production_settings()


def test_environment_is_read_with_the_dd_prefix(monkeypatch, tmp_path):
    monkeypatch.setenv("DD_DATA_DIR", str(tmp_path))
    monkeypatch.setenv("DD_CORS_ORIGINS", "https://a.example, https://b.example ,")
    monkeypatch.setenv("DD_PASSWORD_MIN_LENGTH", "16")
    loaded = Settings(_env_file=None)
    assert loaded.cors_origin_list == ["https://a.example", "https://b.example"]
    assert loaded.password_min_length == 16
    assert loaded.resolved_database_url == f"sqlite+aiosqlite:///{tmp_path.resolve() / 'data-dictionary.db'}"


def test_an_explicit_database_url_wins(monkeypatch):
    monkeypatch.setenv("DD_DATABASE_URL", "postgresql+asyncpg://dd@db/dd")
    assert Settings(_env_file=None).resolved_database_url == "postgresql+asyncpg://dd@db/dd"


def test_a_password_minimum_under_eight_is_refused(monkeypatch):
    monkeypatch.setenv("DD_PASSWORD_MIN_LENGTH", "6")
    with pytest.raises(ValueError):
        Settings(_env_file=None)


def test_content_dir_defaults_to_the_repo_the_api_runs_from(tmp_path):
    from content_fixtures import REPO_ROOT

    assert Settings(content_dir=None, data_dir=str(tmp_path)).content_path == REPO_ROOT


def test_content_dir_can_be_set(tmp_path):
    assert Settings(content_dir=str(tmp_path / "c")).content_path == (tmp_path / "c").resolve()
