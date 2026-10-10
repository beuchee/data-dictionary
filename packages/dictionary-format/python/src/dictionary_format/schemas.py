"""Locate the shared JSON Schemas (packages/dictionary-format/schemas).

Installed from a wheel, they are package data (dictionary_format/schemas). In the
repo or an editable install, they are found by walking up to the package root.
"""

from __future__ import annotations

import json
from functools import cache
from pathlib import Path

_HERE = Path(__file__).resolve().parent


def _find(name: str) -> Path:
    candidates = [_HERE / name, _HERE.parents[2] / name]  # wheel, repo (python/src/dictionary_format → package root)
    for path in candidates:
        if path.is_dir():
            return path
    raise FileNotFoundError(f"dictionary-format {name}/ not found (looked in {', '.join(map(str, candidates))})")


SCHEMAS_DIR = _find("schemas")


@cache
def load_schema(kind: str) -> dict:
    path = SCHEMAS_DIR / f"{kind}.schema.json"
    if not path.is_file():
        raise ValueError(f"Unknown file kind: {kind}")
    return json.loads(path.read_text(encoding="utf-8"))


def fixtures_dir() -> Path:
    return _find("fixtures")
