"""Lossless JSON parsing. Twin of ../../../src/parse.ts."""

from __future__ import annotations

import json
from typing import Any

from .numbers import parse_float, parse_int


def _reject_constant(name: str) -> Any:
    raise ValueError(f"Invalid JSON constant {name}")


def _no_duplicates(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for key, value in pairs:
        if key in out:
            raise ValueError(f"Duplicate key {key!r}")
        out[key] = value
    return out


def parse(text: str | bytes) -> Any:
    """Parse JSON keeping key order and number lexemes; duplicate keys and NaN are errors."""
    if isinstance(text, bytes):
        text = text.decode("utf-8")
    return json.loads(
        text,
        parse_float=parse_float,
        parse_int=parse_int,
        parse_constant=_reject_constant,
        object_pairs_hook=_no_duplicates,
    )
