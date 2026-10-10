"""The canonical on-disk bytes of a content file.

2-space indent, one item per line, `": "` after keys, empty containers as `[]` /
`{}`, non-ASCII written as is, keys in insertion order, final newline except for
resolved concept sets. That is `json.dumps(v, indent=2, ensure_ascii=False)` and
JavaScript's `JSON.stringify(v, null, 2)`, plus: a `RawFloat` is written with its
original lexeme, and lone surrogates are escaped (`\\ud800`) as JavaScript does.
So `serialize(parse(text))` gives back `text` byte for byte, and the bytes are the
same as the TypeScript twin (../../../src/serialize.ts).
"""

from __future__ import annotations

import math
import re
from json.encoder import encode_basestring
from typing import Any

from .kinds import TRAILING_NEWLINE
from .numbers import RawFloat

_LONE_SURROGATE = re.compile("[\ud800-\udfff]")


def _string(value: str) -> str:
    out = encode_basestring(value)  # escapes " \\ \n \r \t \b \f and other C0 as \u00xx
    if _LONE_SURROGATE.search(out):
        out = _LONE_SURROGATE.sub(lambda m: f"\\u{ord(m.group()):04x}", out)
    return out


def _write(value: Any, indent: str, out: list[str]) -> None:
    if isinstance(value, str):
        out.append(_string(value))
    elif value is None:
        out.append("null")
    elif value is True:
        out.append("true")
    elif value is False:
        out.append("false")
    elif isinstance(value, RawFloat):
        out.append(value.raw)
    elif isinstance(value, int):
        out.append(int.__repr__(value))
    elif isinstance(value, float):
        if not math.isfinite(value):
            raise ValueError(f"Cannot serialize non-finite number {value!r}")
        out.append(float.__repr__(value))
    elif isinstance(value, (list, tuple)):
        if not value:
            out.append("[]")
            return
        inner = indent + "  "
        out.append("[")
        for i, item in enumerate(value):
            out.append(",\n" if i else "\n")
            out.append(inner)
            _write(item, inner, out)
        out.append("\n" + indent + "]")
    elif isinstance(value, dict):
        if not value:
            out.append("{}")
            return
        inner = indent + "  "
        out.append("{")
        for i, (key, item) in enumerate(value.items()):
            if not isinstance(key, str):
                raise TypeError(f"Object keys must be strings, got {key!r}")
            out.append(",\n" if i else "\n")
            out.append(inner)
            out.append(_string(key))
            out.append(": ")
            _write(item, inner, out)
        out.append("\n" + indent + "}")
    else:
        raise TypeError(f"Cannot serialize {type(value).__name__}")


def serialize(value: Any, kind: str | None = None, *, trailing_newline: bool | None = None) -> str:
    """Canonical text of `value`; `kind` decides the trailing newline (default: one)."""
    if trailing_newline is None:
        trailing_newline = TRAILING_NEWLINE[kind] if kind else True
    out: list[str] = []
    _write(value, "", out)
    if trailing_newline:
        out.append("\n")
    return "".join(out)


def serialize_bytes(value: Any, kind: str | None = None, *, trailing_newline: bool | None = None) -> bytes:
    """`serialize` encoded as UTF-8: the exact bytes to write to disk."""
    return serialize(value, kind, trailing_newline=trailing_newline).encode("utf-8", "surrogatepass")
