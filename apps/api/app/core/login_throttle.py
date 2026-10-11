"""Failed-login throttling, in memory (one API process: docker/api-entrypoint.sh).

Keyed by (client address, username): after `MAX_FAILURES` failed attempts
within `WINDOW_SECONDS`, that pair is refused (429) until the oldest failure
leaves the window. Not by username alone, which would let anyone lock an
account out; a success clears the pair. The client address is nginx's
`X-Real-IP` when present (docker/nginx.conf), else the socket peer. A caller
reaching the API directly could forge that header, which only lets them
dodge their own throttle.
"""

import threading
import time
from collections import deque

MAX_FAILURES = 10
WINDOW_SECONDS = 15 * 60
# Bounds the memory a flood of distinct usernames can take.
MAX_KEYS = 100_000

_lock = threading.Lock()
_failures: dict[tuple[str, str], deque[float]] = {}


def _key(client: str, username: str) -> tuple[str, str]:
    return client, username.strip().lower()[:255]


def _prune(entries: deque[float], now: float) -> None:
    while entries and entries[0] <= now - WINDOW_SECONDS:
        entries.popleft()


def retry_after(client: str, username: str, now: float | None = None) -> int | None:
    """Seconds until this pair may try again, or None when it may now."""
    now = time.monotonic() if now is None else now
    with _lock:
        entries = _failures.get(_key(client, username))
        if not entries:
            return None
        _prune(entries, now)
        if len(entries) < MAX_FAILURES:
            return None
        return max(1, int(entries[0] + WINDOW_SECONDS - now) + 1)


def record_failure(client: str, username: str, now: float | None = None) -> None:
    now = time.monotonic() if now is None else now
    with _lock:
        if len(_failures) >= MAX_KEYS:
            for key in [k for k, v in _failures.items() if not v or v[-1] <= now - WINDOW_SECONDS]:
                del _failures[key]
            if len(_failures) >= MAX_KEYS:
                _failures.clear()
        entries = _failures.setdefault(_key(client, username), deque())
        _prune(entries, now)
        entries.append(now)


def record_success(client: str, username: str) -> None:
    with _lock:
        _failures.pop(_key(client, username), None)


def reset() -> None:
    with _lock:
        _failures.clear()
