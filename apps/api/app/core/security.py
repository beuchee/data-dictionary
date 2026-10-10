import gzip
from datetime import UTC, datetime, timedelta
from functools import cache
from pathlib import Path

import bcrypt
import jwt

from app.config import settings

# bcrypt's cost factor. Tests lower it to 4, its minimum, which keeps the same code path.
BCRYPT_ROUNDS = 12

# bcrypt hashes only the first 72 bytes: anything past them would be accepted
# and silently ignored (bcrypt >= 5 raises instead).
PASSWORD_MAX_BYTES = 72
_COMMON_PASSWORDS = Path(__file__).parent / "data" / "common-passwords.txt.gz"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt(rounds=BCRYPT_ROUNDS)).decode()


def verify_password(plain_password: str, hashed_password: str) -> bool:
    encoded = plain_password.encode()
    if len(encoded) > PASSWORD_MAX_BYTES:
        return False
    try:
        return bcrypt.checkpw(encoded, hashed_password.encode())
    except ValueError:
        return False


# A real hash to check against when the username is unknown, so a failed
# login takes as long whether or not the account exists.
_DUMMY_HASH: str | None = None


def burn_password_check(password: str) -> None:
    global _DUMMY_HASH
    if _DUMMY_HASH is None:
        _DUMMY_HASH = hash_password("dummy-password-for-timing")
    verify_password(password, _DUMMY_HASH)


@cache
def _common_passwords() -> frozenset[str]:
    with gzip.open(_COMMON_PASSWORDS, "rt", encoding="utf-8") as f:
        return frozenset(line.rstrip("\n") for line in f)


def password_policy_error(password: str, username: str) -> dict | None:
    """Why `password` may not be set for `username` (`{code, message}`, the
    detail of the 422 the caller raises, which the front translates by `code`),
    or None when it may."""
    min_length = settings.password_min_length
    if len(password) < min_length:
        return {
            "code": "password_too_short",
            "minLength": min_length,
            "message": f"The password must be at least {min_length} characters.",
        }
    if len(password.encode()) > PASSWORD_MAX_BYTES:
        return {
            "code": "password_too_long",
            "maxBytes": PASSWORD_MAX_BYTES,
            "message": f"The password must be at most {PASSWORD_MAX_BYTES} bytes.",
        }
    if password.strip().lower() == username.strip().lower():
        return {"code": "password_is_username", "message": "The password must not be the username."}
    if password.lower() in _common_passwords():
        return {"code": "password_common", "message": "This password is among the most commonly used ones."}
    return None


def set_password(user, password: str) -> None:
    """Hash `password` onto `user` and end the sessions issued before it."""
    user.password_hash = hash_password(password)
    user.password_changed_at = datetime.now(UTC)


_EPOCH = datetime(1970, 1, 1, tzinfo=UTC)


def _epoch_us(moment: datetime) -> int:
    return (moment - _EPOCH) // timedelta(microseconds=1)


def predates_password_change(payload: dict, user) -> bool:
    """Whether a session token was issued before `user` last set a password.

    `iat` has whole-second resolution, so the comparison uses `iat_us`: the
    tokens handed out right after a change, in the same second, must stay valid."""
    changed = user.password_changed_at
    if changed is None:
        return False
    if changed.tzinfo is None:
        changed = changed.replace(tzinfo=UTC)
    issued_us = payload.get("iat_us")
    if isinstance(issued_us, int):
        return issued_us < _epoch_us(changed)
    return int(payload.get("iat", 0)) < int(changed.timestamp())


def _create_token(user_id: int, username: str, role: str, token_type: str, lifetime: timedelta) -> str:
    now = datetime.now(UTC)
    payload = {
        "sub": str(user_id),
        "username": username,
        "role": role,
        "type": token_type,
        "iat": now,
        "iat_us": _epoch_us(now),
        "exp": now + lifetime,
    }
    return jwt.encode(payload, settings.secret_key, algorithm=settings.algorithm)


def create_access_token(user_id: int, username: str, role: str) -> str:
    lifetime = timedelta(minutes=settings.access_token_expire_minutes)
    return _create_token(user_id, username, role, "access", lifetime)


def create_refresh_token(user_id: int, username: str, role: str) -> str:
    lifetime = timedelta(days=settings.refresh_token_expire_days)
    return _create_token(user_id, username, role, "refresh", lifetime)


def decode_token(token: str) -> dict:
    """Decode and validate a JWT. Raises jwt.PyJWTError on failure."""
    return jwt.decode(token, settings.secret_key, algorithms=[settings.algorithm])
