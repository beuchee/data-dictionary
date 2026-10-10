"""Content file kinds, where each lives, and per-kind on-disk details.

Twin of ../../../src/kinds.ts.
"""

from __future__ import annotations

import re
from typing import Literal

FileKind = Literal[
    "concept-set",
    "concept-set-resolved",
    "project",
    "recommended-units",
    "unit-conversions",
    "mapping-recommendations",
    "config",
    "concept-sets-versions",
    "id-counters",
]

FILE_KINDS: tuple[FileKind, ...] = (
    "concept-set",
    "concept-set-resolved",
    "project",
    "recommended-units",
    "unit-conversions",
    "mapping-recommendations",
    "config",
    "concept-sets-versions",
    "id-counters",
)

# Whether the canonical bytes end with a newline. Every file does, except the
# resolved concept sets: resolve.py writes them with a bare json.dump.
TRAILING_NEWLINE: dict[str, bool] = {kind: kind != "concept-set-resolved" for kind in FILE_KINDS}

_FIXED_PATHS: dict[str, FileKind] = {
    "units/recommended_units.json": "recommended-units",
    "units/unit_conversions.json": "unit-conversions",
    "mapping_recommendations/mapping_recommendations.json": "mapping-recommendations",
    "config.json": "config",
    "concept_sets_versions.json": "concept-sets-versions",
    "id_counters.json": "id-counters",
}

_ID_DIRS: dict[str, FileKind] = {
    "concept_sets": "concept-set",
    "concept_sets_resolved": "concept-set-resolved",
    "projects": "project",
}

_ID_FILE = re.compile(r"^([a-z_]+)/[1-9][0-9]*\.json$")


def kind_for_path(rel_path: str) -> FileKind | None:
    """Kind of a file from its path relative to the repo root, or None."""
    path = rel_path.replace("\\", "/")
    if path.startswith("./"):
        path = path[2:]
    if path in _FIXED_PATHS:
        return _FIXED_PATHS[path]
    m = _ID_FILE.match(path)
    return _ID_DIRS.get(m.group(1)) if m else None
