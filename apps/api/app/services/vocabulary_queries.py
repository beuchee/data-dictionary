"""SQL builders over the OMOP vocabulary tables (concept, concept_ancestor,
concept_relationship, concept_synonym, relationship, vocabulary).

Pure functions returning ``(sql, params)``. Twin of
``apps/web/src/lib/vocabulary/sql.ts``: both must produce the **same text** for
the same input, which ``tests/fixtures/vocab/sql-golden.json`` checks from both
test suites (the Python suite also runs every golden query against the fixture
vocabulary, so the browser's queries are exercised here too).

Safety: user text only ever travels as a ``$n`` parameter. Concept ids are
inlined, but only after ``concept_id`` has checked they are plain integers;
limits and depths are clamped integers; every other literal is a constant.

``mode`` says what ``concept_ancestor`` holds: ``closure`` is the full ATHENA
table (the server), ``edges`` only its direct parent-child rows (the browser,
which cannot hold the 80 M-row closure), walked with a recursive CTE. Both give
the same answers; the ``edges`` SQL also runs on a closure table, since it reads
only the ``min_levels_of_separation = 1`` rows.
"""

from collections.abc import Iterable, Sequence
from typing import Any, Literal

Query = tuple[str, list[Any]]
HierarchyMode = Literal["closure", "edges"]

# Same bound as JavaScript's Number.MAX_SAFE_INTEGER, so both sides accept the same ids.
MAX_CONCEPT_ID = 2**53 - 1
JW_FUZZY_THRESHOLD = "0.75"
SEARCH_MAX_LIMIT = 1000
RELATED_LIMIT = 10_000
HIERARCHY_MAX_DEPTH = 10
HIERARCHY_MAX_NODES = 2000
STANDARD_FILTERS = ("S", "C", "N")
FILTER_OPTION_COLUMNS = ("domain_id", "vocabulary_id", "concept_class_id")

CONCEPT_COLUMNS = (
    "c.concept_id, c.concept_name, c.domain_id, c.vocabulary_id, c.concept_class_id, c.standard_concept, "
    "c.concept_code, CAST(c.valid_start_date AS VARCHAR) AS valid_start_date, "
    "CAST(c.valid_end_date AS VARCHAR) AS valid_end_date, c.invalid_reason"
)


class QueryError(ValueError):
    """An input no query may be built from (a non-integer id, an unknown filter)."""


def concept_id(value: Any) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= MAX_CONCEPT_ID:
        raise QueryError(f"Invalid concept id: {value!r}")
    return value


def _id_list(ids: Iterable[Any]) -> str:
    return ", ".join(str(concept_id(i)) for i in sorted({concept_id(i) for i in ids}))


def _clamp(value: Any, low: int, high: int) -> int:
    if isinstance(value, bool) or not isinstance(value, int):
        raise QueryError(f"Invalid integer: {value!r}")
    return max(low, min(high, value))


class _Params:
    def __init__(self) -> None:
        self.values: list[Any] = []

    def add(self, value: Any) -> str:
        self.values.append(value)
        return f"${len(self.values)}"


def _fold(expr: str) -> str:
    return f"strip_accents(lower({expr}))"


def _in_params(column: str, values: Sequence[str], params: _Params) -> str:
    return f"{column} IN ({', '.join(params.add(v) for v in values)})"


# --- Concept search -----------------------------------------------------------


def concept_search(
    term: str = "",
    *,
    domain_ids: Sequence[str] = (),
    vocabulary_ids: Sequence[str] = (),
    concept_class_ids: Sequence[str] = (),
    standard: Sequence[str] = (),
    valid_only: bool = False,
    limit: int = 50,
    offset: int = 0,
) -> tuple[Query, Query]:
    """The page and the count query of a concept search.

    Ranking (ported from Linkr's fuzzy search, lower = better): 0 exact id (a
    numeric term), 1 exact code, 2 exact name, 3 name prefix, 4 every word in the
    name or code, 5 whole-string Jaro-Winkler >= 0.75 on name or code; within a
    tier, higher similarity first, then concept_id. Accent- and case-folded on
    both sides. `standard` holds 'S', 'C' and/or 'N' (non-standard), OR-ed.
    """
    params = _Params()
    where: list[str] = []
    order = "c.concept_id"
    q = term.strip()
    if q:
        name = _fold("c.concept_name")
        code = _fold("COALESCE(c.concept_code, '')")
        folded = _fold(params.add(q))
        tiers: list[tuple[int, str]] = []
        if q.isascii() and q.isdigit() and len(q) <= 15:
            tiers.append((0, f"c.concept_id = {int(q)}"))
        tiers.append((1, f"{code} = {folded}"))
        tiers.append((2, f"{name} = {folded}"))
        tiers.append((3, f"starts_with({name}, {folded})"))
        words = []
        for w in q.split():
            p = _fold(params.add(w))
            words.append(f"(contains({name}, {p}) OR contains({code}, {p}))")
        tiers.append((4, " AND ".join(words)))
        name_sim = f"jaro_winkler_similarity({name}, {folded})"
        code_sim = f"jaro_winkler_similarity({code}, {folded})"
        tiers.append((5, f"({name_sim} >= {JW_FUZZY_THRESHOLD} OR {code_sim} >= {JW_FUZZY_THRESHOLD})"))
        where.append("(" + " OR ".join(f"({clause})" for _, clause in tiers) + ")")
        case = " ".join(f"WHEN {clause} THEN {tier}" for tier, clause in tiers[:-1])
        order = f"(CASE {case} ELSE 5 END + (1.0 - GREATEST({name_sim}, {code_sim}))), c.concept_id"
    for column, values in (
        ("c.domain_id", domain_ids),
        ("c.vocabulary_id", vocabulary_ids),
        ("c.concept_class_id", concept_class_ids),
    ):
        if values:
            where.append(_in_params(column, list(values), params))
    if standard:
        unknown = set(standard) - set(STANDARD_FILTERS)
        if unknown:
            raise QueryError(f"Unknown standard filter: {sorted(unknown)}")
        conds = []
        if "S" in standard:
            conds.append("c.standard_concept = 'S'")
        if "C" in standard:
            conds.append("c.standard_concept = 'C'")
        if "N" in standard:
            conds.append("(c.standard_concept IS NULL OR c.standard_concept NOT IN ('S', 'C'))")
        where.append("(" + " OR ".join(conds) + ")")
    if valid_only:
        where.append("(c.invalid_reason IS NULL OR c.invalid_reason = '')")
    where_sql = f" WHERE {' AND '.join(where)}" if where else ""
    page = (
        f"SELECT {CONCEPT_COLUMNS} FROM concept c{where_sql} ORDER BY {order} "
        f"LIMIT {_clamp(limit, 1, SEARCH_MAX_LIMIT)} OFFSET {_clamp(offset, 0, 2**31 - 1)}"
    )
    count = f"SELECT COUNT(*) AS total FROM concept c{where_sql}"
    return (page, list(params.values)), (count, list(params.values))


# --- One concept -----------------------------------------------------------------


def concept_by_id(cid: Any) -> Query:
    return f"SELECT {CONCEPT_COLUMNS} FROM concept c WHERE c.concept_id = {concept_id(cid)}", []


def related_concepts(cid: Any) -> Query:
    """Valid relationships from the concept, with the relationship's name."""
    i = concept_id(cid)
    return (
        "SELECT cr.relationship_id, r.relationship_name, "
        f"{CONCEPT_COLUMNS} FROM concept_relationship cr "
        "JOIN concept c ON c.concept_id = cr.concept_id_2 "
        "LEFT JOIN relationship r ON r.relationship_id = cr.relationship_id "
        f"WHERE cr.concept_id_1 = {i} AND (cr.invalid_reason IS NULL OR cr.invalid_reason = '') "
        f"ORDER BY cr.relationship_id, c.concept_name, c.concept_id LIMIT {RELATED_LIMIT}",
        [],
    )


def synonyms(cid: Any) -> Query:
    return (
        "SELECT cs.concept_synonym_name, cs.language_concept_id, l.concept_name AS language_name "
        "FROM concept_synonym cs LEFT JOIN concept l ON l.concept_id = cs.language_concept_id "
        f"WHERE cs.concept_id = {concept_id(cid)} "
        "ORDER BY l.concept_name NULLS LAST, cs.concept_synonym_name",
        [],
    )


# --- Hierarchy -------------------------------------------------------------------


def hierarchy_nodes(cid: Any, mode: HierarchyMode, max_depth: int = 5, limit: int = 150) -> Query:
    """The concept (level 0), its ancestors (negative levels) and descendants
    (positive levels) up to `max_depth` steps, nearest first, at most `limit`
    rows (ask for one more than you show to know it was cut)."""
    i = concept_id(cid)
    depth = _clamp(max_depth, 1, HIERARCHY_MAX_DEPTH)
    if mode == "closure":
        levels = (
            "SELECT ca.ancestor_concept_id AS concept_id, -MIN(ca.min_levels_of_separation) AS level "
            f"FROM concept_ancestor ca WHERE ca.descendant_concept_id = {i} AND ca.ancestor_concept_id <> {i} "
            f"AND ca.min_levels_of_separation <= {depth} GROUP BY ca.ancestor_concept_id "
            "UNION ALL "
            "SELECT ca.descendant_concept_id AS concept_id, MIN(ca.min_levels_of_separation) AS level "
            f"FROM concept_ancestor ca WHERE ca.ancestor_concept_id = {i} AND ca.descendant_concept_id <> {i} "
            f"AND ca.min_levels_of_separation <= {depth} GROUP BY ca.descendant_concept_id "
            f"UNION ALL SELECT {i} AS concept_id, 0 AS level"
        )
        prefix = ""
    elif mode == "edges":
        # UNION (not UNION ALL) on (id, depth): a multi-parent DAG would
        # otherwise enumerate every path.
        prefix = (
            "WITH RECURSIVE up(concept_id, depth) AS ("
            "SELECT ca.ancestor_concept_id, 1 FROM concept_ancestor ca "
            f"WHERE ca.min_levels_of_separation = 1 AND ca.descendant_concept_id = {i} "
            "UNION SELECT ca.ancestor_concept_id, up.depth + 1 FROM concept_ancestor ca "
            "JOIN up ON ca.descendant_concept_id = up.concept_id "
            f"WHERE ca.min_levels_of_separation = 1 AND up.depth < {depth}), "
            "down(concept_id, depth) AS ("
            "SELECT ca.descendant_concept_id, 1 FROM concept_ancestor ca "
            f"WHERE ca.min_levels_of_separation = 1 AND ca.ancestor_concept_id = {i} "
            "UNION SELECT ca.descendant_concept_id, down.depth + 1 FROM concept_ancestor ca "
            "JOIN down ON ca.ancestor_concept_id = down.concept_id "
            f"WHERE ca.min_levels_of_separation = 1 AND down.depth < {depth}) "
        )
        levels = (
            f"SELECT concept_id, -MIN(depth) AS level FROM up WHERE concept_id <> {i} GROUP BY concept_id "
            f"UNION ALL SELECT concept_id, MIN(depth) AS level FROM down WHERE concept_id <> {i} GROUP BY concept_id "
            f"UNION ALL SELECT {i} AS concept_id, 0 AS level"
        )
    else:
        raise QueryError(f"Unknown hierarchy mode: {mode!r}")
    return (
        f"{prefix}SELECT {CONCEPT_COLUMNS}, h.level AS hierarchy_level FROM ({levels}) h "
        "JOIN concept c ON c.concept_id = h.concept_id "
        f"ORDER BY abs(h.level), h.level, c.concept_id LIMIT {_clamp(limit, 1, HIERARCHY_MAX_NODES + 1)}",
        [],
    )


def hierarchy_edges(ids: Iterable[Any]) -> Query:
    """Direct parent → child edges among `ids` (for the graph)."""
    id_list = _id_list(ids)
    if not id_list:
        raise QueryError("No concept ids")
    return (
        "SELECT DISTINCT ca.ancestor_concept_id AS from_id, ca.descendant_concept_id AS to_id "
        "FROM concept_ancestor ca WHERE ca.min_levels_of_separation = 1 "
        f"AND ca.ancestor_concept_id IN ({id_list}) AND ca.descendant_concept_id IN ({id_list}) "
        "ORDER BY from_id, to_id",
        [],
    )


# --- Resolution (see resolver.py) ---------------------------------------------------


def descendant_ids(ids: Iterable[Any], mode: HierarchyMode) -> Query:
    id_list = _id_list(ids)
    if not id_list:
        raise QueryError("No concept ids")
    if mode == "closure":
        return (
            "SELECT DISTINCT ca.descendant_concept_id AS concept_id FROM concept_ancestor ca "
            f"WHERE ca.ancestor_concept_id IN ({id_list}) AND ca.descendant_concept_id <> ca.ancestor_concept_id",
            [],
        )
    if mode == "edges":
        return (
            "WITH RECURSIVE d(concept_id) AS ("
            "SELECT ca.descendant_concept_id FROM concept_ancestor ca "
            f"WHERE ca.min_levels_of_separation = 1 AND ca.ancestor_concept_id IN ({id_list}) "
            "UNION SELECT ca.descendant_concept_id FROM concept_ancestor ca "
            "JOIN d ON ca.ancestor_concept_id = d.concept_id WHERE ca.min_levels_of_separation = 1) "
            "SELECT DISTINCT concept_id FROM d",
            [],
        )
    raise QueryError(f"Unknown hierarchy mode: {mode!r}")


def mapped_ids(ids: Iterable[Any]) -> Query:
    """Both directions, as resolve.py: a standard concept's `Mapped from` rows
    bring its source codes in."""
    id_list = _id_list(ids)
    if not id_list:
        raise QueryError("No concept ids")
    return (
        "SELECT DISTINCT cr.concept_id_2 AS concept_id FROM concept_relationship cr "
        f"WHERE cr.concept_id_1 IN ({id_list}) AND cr.relationship_id IN ('Maps to', 'Mapped from')",
        [],
    )


def resolved_details(ids: Iterable[Any]) -> Query:
    id_list = _id_list(ids)
    if not id_list:
        raise QueryError("No concept ids")
    return (
        "SELECT c.concept_id, c.concept_name, c.vocabulary_id, c.domain_id, c.concept_class_id, c.concept_code, "
        f"c.standard_concept FROM concept c WHERE c.concept_id IN ({id_list})",
        [],
    )


# --- Expression optimization (web: features/concept-sets/lib/optimize.ts) -----------

ANCESTOR_CANDIDATE_MAX_DEPTH = 10
ANCESTOR_CANDIDATE_MAX_LIMIT = 200


def _required_ids(ids: Iterable[Any]) -> str:
    id_list = _id_list(ids)
    if not id_list:
        raise QueryError("No concept ids")
    return id_list


def concepts_by_ids(ids: Iterable[Any]) -> Query:
    """Full rows of the given concepts, by id."""
    return (
        f"SELECT {CONCEPT_COLUMNS} FROM concept c WHERE c.concept_id IN ({_required_ids(ids)}) ORDER BY c.concept_id",
        [],
    )


def descendant_pairs(
    ancestor_ids: Iterable[Any], mode: HierarchyMode, within_ids: Iterable[Any] | None = None
) -> Query:
    """(ancestor, descendant) pairs: every descendant of each of `ancestor_ids`
    (never itself), kept to `within_ids` when given."""
    id_list = _required_ids(ancestor_ids)
    within = None if within_ids is None else _required_ids(within_ids)
    if mode == "closure":
        return (
            "SELECT DISTINCT ca.ancestor_concept_id AS ancestor_id, ca.descendant_concept_id AS descendant_id "
            f"FROM concept_ancestor ca WHERE ca.ancestor_concept_id IN ({id_list}) "
            "AND ca.descendant_concept_id <> ca.ancestor_concept_id"
            + (f" AND ca.descendant_concept_id IN ({within})" if within else "")
            + " ORDER BY ancestor_id, descendant_id",
            [],
        )
    if mode == "edges":
        # UNION carries the root ancestor down; it dedupes, so a multi-parent DAG terminates.
        return (
            "WITH RECURSIVE d(ancestor_id, descendant_id) AS ("
            "SELECT ca.ancestor_concept_id, ca.descendant_concept_id FROM concept_ancestor ca "
            f"WHERE ca.min_levels_of_separation = 1 AND ca.ancestor_concept_id IN ({id_list}) "
            "UNION SELECT d.ancestor_id, ca.descendant_concept_id FROM concept_ancestor ca "
            "JOIN d ON ca.ancestor_concept_id = d.descendant_id WHERE ca.min_levels_of_separation = 1) "
            "SELECT DISTINCT ancestor_id, descendant_id FROM d WHERE descendant_id <> ancestor_id"
            + (f" AND descendant_id IN ({within})" if within else "")
            + " ORDER BY ancestor_id, descendant_id",
            [],
        )
    raise QueryError(f"Unknown hierarchy mode: {mode!r}")


def ancestor_candidates(ids: Iterable[Any], mode: HierarchyMode, max_depth: Any = 5, limit: Any = 30) -> Query:
    """Valid ancestors (up to `max_depth` steps) shared by at least two of
    `ids`, themselves outside `ids`: how many of `ids` each covers and how
    close it is, most covering first, then nearest, then by id (v1's bottom-up
    optimizer)."""
    id_list = _required_ids(ids)
    depth = _clamp(max_depth, 1, ANCESTOR_CANDIDATE_MAX_DEPTH)
    n = _clamp(limit, 1, ANCESTOR_CANDIDATE_MAX_LIMIT)
    prefix = ""
    if mode == "closure":
        source = (
            "(SELECT ca.ancestor_concept_id AS ancestor_id, ca.descendant_concept_id AS descendant_id, "
            "ca.min_levels_of_separation AS depth FROM concept_ancestor ca "
            f"WHERE ca.descendant_concept_id IN ({id_list}) AND ca.min_levels_of_separation BETWEEN 1 AND {depth}) a"
        )
    elif mode == "edges":
        prefix = (
            "WITH RECURSIVE anc(ancestor_id, descendant_id, depth) AS ("
            "SELECT ca.ancestor_concept_id, ca.descendant_concept_id, 1 FROM concept_ancestor ca "
            f"WHERE ca.min_levels_of_separation = 1 AND ca.descendant_concept_id IN ({id_list}) "
            "UNION SELECT ca.ancestor_concept_id, anc.descendant_id, anc.depth + 1 FROM concept_ancestor ca "
            "JOIN anc ON ca.descendant_concept_id = anc.ancestor_id "
            f"WHERE ca.min_levels_of_separation = 1 AND anc.depth < {depth}) "
        )
        source = "anc a"
    else:
        raise QueryError(f"Unknown hierarchy mode: {mode!r}")
    return (
        f"{prefix}SELECT {CONCEPT_COLUMNS}, "
        "COUNT(DISTINCT a.descendant_id) AS covered_count, MIN(a.depth) AS min_depth "
        f"FROM {source} JOIN concept c ON c.concept_id = a.ancestor_id "
        f"WHERE a.ancestor_id NOT IN ({id_list}) AND (c.invalid_reason IS NULL OR c.invalid_reason = '') "
        "GROUP BY ALL HAVING COUNT(DISTINCT a.descendant_id) >= 2 "
        f"ORDER BY covered_count DESC, min_depth, c.concept_id LIMIT {n}",
        [],
    )


# --- Library metadata ----------------------------------------------------------------


def vocabulary_versions() -> Query:
    return (
        "SELECT vocabulary_id, vocabulary_version FROM vocabulary WHERE vocabulary_version IS NOT NULL "
        "ORDER BY vocabulary_id",
        [],
    )


def filter_options(column: str) -> Query:
    if column not in FILTER_OPTION_COLUMNS:
        raise QueryError(f"Unknown filter column: {column!r}")
    return (
        f"SELECT DISTINCT {column} AS value FROM concept WHERE {column} IS NOT NULL AND {column} <> '' ORDER BY value",
        [],
    )


# --- Rows → API shapes ------------------------------------------------------------------

CONCEPT_KEYS = (
    ("concept_id", "conceptId"),
    ("concept_name", "conceptName"),
    ("domain_id", "domainId"),
    ("vocabulary_id", "vocabularyId"),
    ("concept_class_id", "conceptClassId"),
    ("standard_concept", "standardConcept"),
    ("concept_code", "conceptCode"),
    ("valid_start_date", "validStartDate"),
    ("valid_end_date", "validEndDate"),
    ("invalid_reason", "invalidReason"),
)


def _blank_to_none(value: Any) -> Any:
    return None if value == "" else value


def concept_from_row(row: dict[str, Any]) -> dict[str, Any]:
    out = {camel: row.get(snake) for snake, camel in CONCEPT_KEYS}
    out["conceptId"] = int(out["conceptId"])
    out["standardConcept"] = _blank_to_none(out["standardConcept"])
    out["invalidReason"] = _blank_to_none(out["invalidReason"])
    return out
