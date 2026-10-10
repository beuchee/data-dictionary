"""core/crypto: secrets only open under the context and key they were sealed
with, the key lives outside the database, and rotated-out keys stay readable."""

import base64
import os
import stat

import pytest

from app.config import settings
from app.core import crypto


def _key() -> str:
    return base64.urlsafe_b64encode(os.urandom(32)).decode()


def test_roundtrip():
    token = crypto.encrypt("s3cret", "git:1:github.com")
    assert "s3cret" not in token
    assert crypto.decrypt(token, "git:1:github.com") == "s3cret"


def test_roundtrip_unicode():
    assert crypto.decrypt(crypto.encrypt("clé-🔑", "ctx"), "ctx") == "clé-🔑"


def test_nonce_makes_every_token_different():
    assert crypto.encrypt("same", "ctx") != crypto.encrypt("same", "ctx")


def test_other_context_does_not_open():
    """A ciphertext moved to another user's row, or kept after the host
    changed, is useless."""
    token = crypto.encrypt("s3cret", "git:1:github.com")
    assert crypto.decrypt(token, "git:2:github.com") is None
    assert crypto.decrypt(token, "git:1:gitlab.com") is None


def test_tampered_or_garbage_token():
    token = crypto.encrypt("s3cret", "ctx")
    tampered = token[:-2] + ("A" if token[-2] != "A" else "B") + token[-1]
    assert crypto.decrypt(tampered, "ctx") is None
    assert crypto.decrypt("not-a-token", "ctx") is None
    assert crypto.decrypt("v2.deadbeef.!!!", "ctx") is None
    assert crypto.decrypt(None, "ctx") is None
    assert crypto.decrypt("", "ctx") is None


def test_another_key_does_not_open(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", _key())
    crypto.reset_keyring()
    token = crypto.encrypt("s3cret", "ctx")

    monkeypatch.setattr(settings, "encryption_key", _key())
    crypto.reset_keyring()
    assert crypto.decrypt(token, "ctx") is None


def test_a_key_id_collision_still_fails_closed(monkeypatch):
    """Rewriting the key id in a token to the current key's must not open it."""
    monkeypatch.setattr(settings, "encryption_key", _key())
    crypto.reset_keyring()
    token = crypto.encrypt("s3cret", "ctx")

    monkeypatch.setattr(settings, "encryption_key", _key())
    crypto.reset_keyring()
    current_id = crypto.encrypt("x", "ctx").split(".")[1]
    prefix, _, body = token.split(".", 2)
    assert crypto.decrypt(f"{prefix}.{current_id}.{body}", "ctx") is None


def test_key_file_generated_private_and_stable():
    token = crypto.encrypt("s3cret", "ctx")
    path = settings.data_path / "secret.key"
    assert path.is_file()
    assert stat.S_IMODE(path.stat().st_mode) == 0o600
    crypto.reset_keyring()
    assert crypto.decrypt(token, "ctx") == "s3cret"


def test_env_key_wins_over_file(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", _key())
    crypto.reset_keyring()
    crypto.encrypt("x", "ctx")
    assert not (settings.data_path / "secret.key").exists()


def test_a_malformed_key_is_refused(monkeypatch):
    monkeypatch.setattr(settings, "encryption_key", base64.urlsafe_b64encode(b"too short").decode())
    crypto.reset_keyring()
    with pytest.raises(RuntimeError, match="32 bytes"):
        crypto.encrypt("x", "ctx")


def test_rotation_keeps_old_tokens_readable(monkeypatch):
    old, new = _key(), _key()
    monkeypatch.setattr(settings, "encryption_key", old)
    crypto.reset_keyring()
    token = crypto.encrypt("s3cret", "ctx")
    assert not crypto.needs_reseal(token)

    monkeypatch.setattr(settings, "encryption_key", new)
    monkeypatch.setattr(settings, "encryption_old_keys", old)
    crypto.reset_keyring()
    assert crypto.decrypt(token, "ctx") == "s3cret"
    assert crypto.needs_reseal(token)
    assert not crypto.needs_reseal(crypto.encrypt("s3cret", "ctx"))

    monkeypatch.setattr(settings, "encryption_old_keys", "")
    crypto.reset_keyring()
    assert crypto.decrypt(token, "ctx") is None
