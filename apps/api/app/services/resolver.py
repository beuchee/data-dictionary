"""Concept set resolution: port of the repo's ``resolve.py`` (same algorithm,
same output), over any DuckDB connection exposing the vocabulary tables.

1. Split the expression items into included and excluded.
2. Expand each side: the items' own ids, plus the descendants of those with
   ``includeDescendants`` (``concept_ancestor``), plus the concepts those with
   ``includeMapped`` map to or from (``concept_relationship`` ``Maps to`` /
   ``Mapped from``). Mapping applies to the item itself, not to its descendants.
3. Resolved = included − excluded.
4. Details come from ``concept``; a custom concept (id >= 2 100 000 000, no
   vocabulary row) takes them from the expression. An id the vocabulary does
   not hold is dropped. Sorted by ``conceptId``.

Twin of ``apps/web/src/lib/vocabulary/resolver.ts``; both are checked against
``tests/fixtures/vocab/resolve-cases.json``, itself produced by ``resolve.py``.
Only depends on duckdb, so it can run outside the API.
"""

from collections.abc import Iterable, Sequence

from app.services import vocabulary_queries as q

CUSTOM_CONCEPT_BASE = 2_100_000_000


def _item_id(item: dict) -> int:
    return q.concept_id((item.get("concept") or {}).get("conceptId"))


def _ids(con, query: q.Query) -> set[int]:
    sql, params = query
    return {int(r[0]) for r in con.execute(sql, params).fetchall()}


def _expand(con, items: Sequence[dict], mode: q.HierarchyMode) -> set[int]:
    ids = {_item_id(i) for i in items}
    desc = {_item_id(i) for i in items if i.get("includeDescendants", False)}
    if desc:
        ids |= _ids(con, q.descendant_ids(desc, mode))
    mapped = {_item_id(i) for i in items if i.get("includeMapped", False)}
    if mapped:
        ids |= _ids(con, q.mapped_ids(mapped))
    return ids


def resolve_items(con, items: Iterable[dict] | None, mode: q.HierarchyMode = "closure") -> list[dict]:
    """The resolved concepts of an expression's items (resolve.py's shape)."""
    items = list(items or [])
    included = [i for i in items if not i.get("isExcluded", False)]
    excluded = [i for i in items if i.get("isExcluded", False)]
    if not included:
        return []
    resolved = _expand(con, included, mode)
    if excluded:
        resolved -= _expand(con, excluded, mode)
    if not resolved:
        return []

    db_ids = {i for i in resolved if i < CUSTOM_CONCEPT_BASE}
    custom_ids = {i for i in resolved if i >= CUSTOM_CONCEPT_BASE}
    result: list[dict] = []
    if db_ids:
        sql, params = q.resolved_details(db_ids)
        for r in con.execute(sql, params).fetchall():
            result.append(
                {
                    "conceptId": r[0],
                    "conceptName": r[1],
                    "vocabularyId": r[2],
                    "domainId": r[3],
                    "conceptClassId": r[4],
                    "conceptCode": r[5],
                    "standardConcept": r[6],
                }
            )
    remaining = set(custom_ids)
    for item in included + excluded:
        c = item.get("concept") or {}
        cid = c.get("conceptId")
        if cid in remaining:
            remaining.discard(cid)
            result.append(
                {
                    "conceptId": cid,
                    "conceptName": c.get("conceptName", ""),
                    "vocabularyId": c.get("vocabularyId", ""),
                    "domainId": c.get("domainId", ""),
                    "conceptClassId": c.get("conceptClassId", ""),
                    "conceptCode": c.get("conceptCode", ""),
                    "standardConcept": c.get("standardConcept", None),
                }
            )
    result.sort(key=lambda x: x.get("conceptId", 0))
    return result


def read_vocabulary_version(con) -> dict[str, str] | None:
    """`{"release": <the 'None' row's version>, <vocabulary_id>: <version>, …}`,
    or None when the vocabulary table is missing or empty."""
    try:
        sql, params = q.vocabulary_versions()
        rows = con.execute(sql, params).fetchall()
    except Exception:  # noqa: BLE001 — no VOCABULARY table: the version is unknown
        return None
    if not rows:
        return None
    version: dict[str, str] = {}
    for vocab_id, vocab_version in rows:
        version["release" if vocab_id == "None" else vocab_id] = vocab_version
    return version


def stamp_version(version: dict[str, str] | None, concepts: Sequence[dict]) -> dict[str, str | None] | None:
    """The release plus the versions of the vocabularies the resolved concepts
    use, as resolve.py writes into concept_sets_resolved/{id}.json."""
    if version is None:
        return None
    out: dict[str, str | None] = {"release": version.get("release")}
    for vocab_id in sorted({c.get("vocabularyId") for c in concepts if c.get("vocabularyId")}):
        if vocab_id in version:
            out[vocab_id] = version[vocab_id]
    return out
