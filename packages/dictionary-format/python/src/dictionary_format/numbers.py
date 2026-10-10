"""Number lexemes Python would not print back identically.

`parse` returns a `RawFloat` (a float subclass carrying its source text) for a
number whose lexeme differs from `repr(float(lexeme))` — `0.10`, `1E+2`, `-0`…
— so `serialize` can write the original bytes back. Most numbers (ints, `1.0`,
`5.55062`) stay plain `int` / `float`.
"""

from __future__ import annotations

import re

_JSON_NUMBER = re.compile(r"-?(0|[1-9][0-9]*)(\.[0-9]+)?([eE][+-]?[0-9]+)?")


class RawFloat(float):
    """A float that remembers its JSON lexeme (`raw`)."""

    __slots__ = ("raw",)
    raw: str

    def __new__(cls, raw: str) -> "RawFloat":
        if not isinstance(raw, str) or not _JSON_NUMBER.fullmatch(raw):
            raise ValueError(f"Not a JSON number: {raw!r}")
        obj = super().__new__(cls, raw)
        obj.raw = raw
        return obj

    def __getnewargs__(self) -> tuple[str]:  # copy / deepcopy / pickle
        return (self.raw,)

    def __getstate__(self) -> None:
        return None

    def __repr__(self) -> str:
        return f"RawFloat({self.raw!r})"


def parse_float(lexeme: str) -> float:
    value = float(lexeme)
    return value if repr(value) == lexeme else RawFloat(lexeme)


def parse_int(lexeme: str) -> int | float:
    value = int(lexeme)
    return value if str(value) == lexeme else RawFloat(lexeme)  # only "-0"


def to_plain(value):
    """Deep copy with every RawFloat replaced by a plain float."""
    if isinstance(value, RawFloat):
        return float(value)
    if isinstance(value, list):
        return [to_plain(v) for v in value]
    if isinstance(value, dict):
        return {k: to_plain(v) for k, v in value.items()}
    return value
