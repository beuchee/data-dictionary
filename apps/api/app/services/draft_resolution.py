"""The resolved list that rides with a concept-set submit
(docs/design/drafts-and-proposals.md, "Resolved concepts").

When a draft changes a set's expression, the server resolves it itself with the
vocabulary it holds (``resolver.py``, resolve.py's algorithm) and writes
``concept_sets_resolved/{id}.json`` in the same commit, so the repository never
pairs a new expression with a stale list. Whatever the browser resolved is never
trusted. Without a loaded vocabulary the list is left as it is and the submit
answer says so (``resolvedStale``).
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

import structlog
from dictionary_format import serialize_bytes

from app.services import resolver
from app.services import vocabulary as lib

logger = structlog.get_logger()

RESOLVED_DIR = "concept_sets_resolved"
MODE = "closure"


@dataclass(frozen=True)
class Resolution:
    concepts: list[dict]
    vocabulary_version: dict | None


def items_of(cs: Any) -> list:
    if not isinstance(cs, dict):
        return []
    expression = cs.get("expression")
    items = expression.get("items") if isinstance(expression, dict) else None
    return items if isinstance(items, list) else []


def expression_changed(content: Any, base: Any) -> bool:
    """A new set, or items that differ from the repository's."""
    return base is None or items_of(content) != items_of(base)


def _version(cursor) -> dict | None:
    version = resolver.read_vocabulary_version(cursor)
    release = next((v.get("release") for v in lib.read_inventory() if v.get("release")), None)
    if release and not (version or {}).get("release"):
        version = {**(version or {}), "release": release}
    return version


def resolve(items: list) -> Resolution | None:
    """Blocking. None when no vocabulary is loaded (or it cannot be read)."""
    try:
        library = lib.get_library()
        if not library.available():
            return None
        cursor = library.cursor()
    except lib.VocabularyUnavailable:
        return None
    try:
        concepts = resolver.resolve_items(cursor, items, MODE)
        return Resolution(concepts, resolver.stamp_version(_version(cursor), concepts))
    except Exception as exc:  # noqa: BLE001 — an unreadable vocabulary must not block a submit
        logger.warning("draft_resolution_failed", error=str(exc))
        return None
    finally:
        cursor.close()


def resolved_path(cs_id: int) -> str:
    return f"{RESOLVED_DIR}/{int(cs_id)}.json"


def resolved_bytes(cs_id: int, resolution: Resolution) -> bytes:
    """resolve.py's file: same keys, 2-space indent, no trailing newline."""
    return serialize_bytes(
        {
            "conceptSetId": int(cs_id),
            "vocabularyVersion": resolution.vocabulary_version,
            "resolvedConcepts": resolution.concepts,
        },
        "concept-set-resolved",
    )
