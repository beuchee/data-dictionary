from __future__ import annotations

import json
from pathlib import Path

import pytest

from dictionary_format import kind_for_path

PACKAGE_ROOT = Path(__file__).resolve().parents[2]
REPO_ROOT = PACKAGE_ROOT.parents[1]

_ID_DIRS = ("concept_sets", "concept_sets_resolved", "projects")
_FIXED = (
    "units/recommended_units.json",
    "units/unit_conversions.json",
    "mapping_recommendations/mapping_recommendations.json",
    "config.json",
    "id_counters.json",
    "concept_sets_versions.json",
)


def content_files() -> list[tuple[str, str]]:
    """(path relative to the repo root, kind) for every content file."""
    paths = [f"{d}/{p.name}" for d in _ID_DIRS for p in sorted((REPO_ROOT / d).glob("*.json"))]
    paths += list(_FIXED)
    out = []
    for path in paths:
        kind = kind_for_path(path)
        assert kind, path
        out.append((path, kind))
    return out


def read_bytes(rel: str) -> bytes:
    return (REPO_ROOT / rel).read_bytes()


NON_CANONICAL: dict[str, str] = json.loads((PACKAGE_ROOT / "fixtures" / "non-canonical.json").read_text("utf-8"))


@pytest.fixture(scope="session")
def files() -> list[tuple[str, str]]:
    return content_files()
