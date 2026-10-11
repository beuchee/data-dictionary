"""Regenerates the two files shared by the API and web test suites:

- resolve-cases.json: expressions with what the repo's resolve.py makes of them
  on the athena/ fixture (`expected`). The Python resolver and the TS resolver
  must both match it.
- sql-golden.json: the SQL text and parameters the query builders produce for a
  set of inputs (from app/services/vocabulary_queries.py). The TS builders must
  produce the very same text, and the inputs under `rejects` must throw in both.

Run from apps/api after changing a builder or the fixture, then review the diff:
    .venv/bin/python tests/fixtures/vocab/make_expected.py
"""

import importlib.util
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
API = HERE.parents[2]
REPO = API.parents[1]
sys.path.insert(0, str(API))

from app.services import vocabulary_queries as q  # noqa: E402


def concept(cid: int, name: str = "") -> dict:
    return {"conceptId": cid, "conceptName": name}


def item(cid: int, *, excluded=False, descendants=False, mapped=False, **concept_fields) -> dict:
    return {
        "concept": {**concept(cid), **concept_fields},
        "isExcluded": excluded,
        "includeDescendants": descendants,
        "includeMapped": mapped,
    }


CUSTOM = {
    "conceptName": "Local triage score",
    "domainId": "Observation",
    "vocabularyId": "INDICATE",
    "conceptClassId": "Custom",
    "conceptCode": "TRIAGE-1",
    "standardConcept": "S",
}

CASES = [
    ("empty expression", []),
    ("one concept, no flag", [item(103)]),
    ("descendants", [item(103, descendants=True)]),
    ("descendants minus one excluded concept", [item(102, descendants=True), item(105, excluded=True)]),
    ("excluded branch", [item(102, descendants=True), item(104, excluded=True, descendants=True)]),
    ("mapped from a standard concept brings its source codes", [item(104, mapped=True)]),
    ("non-standard concept mapped to its standard one", [item(200, mapped=True)]),
    ("mapped applies to the item, not its descendants", [item(102, descendants=True, mapped=True)]),
    ("multi-parent hierarchy", [item(110, descendants=True)]),
    ("classification concept over flat LOINC tests", [item(310, descendants=True)]),
    ("custom concept kept from the expression", [item(300), item(2_100_000_001, **CUSTOM)]),
    ("custom concept listed twice appears once", [item(2_100_000_001, **CUSTOM), item(2_100_000_001, **CUSTOM)]),
    ("excluded custom concept", [item(2_100_000_001, **CUSTOM), item(2_100_000_001, excluded=True), item(301)]),
    ("only excluded items", [item(103, excluded=True, descendants=True)]),
    ("everything excluded", [item(103), item(103, excluded=True)]),
    ("invalid concept with its replacement mapped", [item(120, mapped=True)]),
    ("unknown concept id is dropped", [item(999_999), item(302)]),
    ("excluded mapped codes", [item(107, descendants=True, mapped=True), item(201, excluded=True)]),
    ("drug ingredient with descendants", [item(400, descendants=True), item(402, excluded=True)]),
]


def load_resolve_py():
    spec = importlib.util.spec_from_file_location("resolve_py", REPO / "resolve.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def resolve_cases() -> list[dict]:
    resolve_py = load_resolve_py()
    con = resolve_py.connect_from_csv(str(HERE / "athena"))
    version = resolve_py.read_vocabulary_version(con)
    out = []
    for name, items in CASES:
        concepts = resolve_py.resolve_concept_set(con, items)
        used = {c["vocabularyId"] for c in concepts if c.get("vocabularyId")}
        stamped = {"release": version.get("release")}
        for v in sorted(used):
            if v in version:
                stamped[v] = version[v]
        out.append({"name": name, "items": items, "vocabularyVersion": stamped, "resolvedConcepts": concepts})
    con.close()
    return out


# (builder, input) → the TS call is builder(input) with the same camelCase keys.
GOLDEN_INPUTS = [
    ("conceptSearch", {}),
    ("conceptSearch", {"term": "heart failure"}),
    ("conceptSearch", {"term": "  Ménière  ", "limit": 10, "offset": 20}),
    ("conceptSearch", {"term": "8867-4", "vocabularyIds": ["LOINC"], "validOnly": True}),
    ("conceptSearch", {"term": "103"}),
    (
        "conceptSearch",
        {
            "term": "heart",
            "domainIds": ["Condition", "Measurement"],
            "conceptClassIds": ["Disorder"],
            "standard": ["N", "S"],
        },
    ),
    ("conceptSearch", {"standard": ["C"], "limit": 5000, "offset": -3}),
    ("conceptSearch", {"term": "x' OR 1=1; DROP TABLE concept; --", "domainIds": ["') OR ('1'='1"]}),
    ("conceptSearch", {"term": "1234567890123456"}),
    ("conceptById", {"conceptId": 103}),
    ("relatedConcepts", {"conceptId": 103}),
    ("synonyms", {"conceptId": 103}),
    ("hierarchyNodes", {"conceptId": 103, "mode": "closure"}),
    ("hierarchyNodes", {"conceptId": 109, "mode": "edges", "maxDepth": 2, "limit": 4}),
    ("hierarchyNodes", {"conceptId": 109, "mode": "closure", "maxDepth": 2, "limit": 4}),
    ("hierarchyNodes", {"conceptId": 103, "mode": "edges", "maxDepth": 99, "limit": 0}),
    ("hierarchyEdges", {"ids": [104, 103, 102, 103]}),
    ("descendantIds", {"ids": [102, 110], "mode": "closure"}),
    ("descendantIds", {"ids": [102, 110], "mode": "edges"}),
    ("mappedIds", {"ids": [200, 104]}),
    ("resolvedDetails", {"ids": [300, 103]}),
    ("vocabularyVersions", {}),
    ("filterOptions", {"column": "domain_id"}),
]

REJECTS = [
    ("conceptById", {"conceptId": -1}),
    ("conceptById", {"conceptId": 1.5}),
    ("conceptById", {"conceptId": "103; DROP TABLE concept"}),
    ("conceptById", {"conceptId": True}),
    ("conceptById", {"conceptId": 2**53}),
    ("conceptById", {"conceptId": None}),
    ("hierarchyEdges", {"ids": []}),
    ("hierarchyEdges", {"ids": [1, "2 OR 1=1"]}),
    ("descendantIds", {"ids": [1], "mode": "closure; DROP TABLE concept"}),
    ("hierarchyNodes", {"conceptId": 1, "mode": "tree"}),
    ("mappedIds", {"ids": [1e300]}),
    ("conceptSearch", {"standard": ["S", "X' OR '1'='1"]}),
    ("conceptSearch", {"limit": "10; DROP TABLE concept"}),
    ("filterOptions", {"column": "concept_name FROM concept; DROP TABLE concept; --"}),
]


def call(builder: str, args: dict):
    """Run the Python builder for a golden entry; returns a JSON-able result."""
    if builder == "conceptSearch":
        (page, page_params), (count, count_params) = q.concept_search(
            args.get("term", ""),
            domain_ids=args.get("domainIds", ()),
            vocabulary_ids=args.get("vocabularyIds", ()),
            concept_class_ids=args.get("conceptClassIds", ()),
            standard=args.get("standard", ()),
            valid_only=args.get("validOnly", False),
            limit=args.get("limit", 50),
            offset=args.get("offset", 0),
        )
        return {"page": {"sql": page, "params": page_params}, "count": {"sql": count, "params": count_params}}
    simple = {
        "conceptById": lambda a: q.concept_by_id(a["conceptId"]),
        "relatedConcepts": lambda a: q.related_concepts(a["conceptId"]),
        "synonyms": lambda a: q.synonyms(a["conceptId"]),
        "hierarchyNodes": lambda a: q.hierarchy_nodes(
            a["conceptId"], a["mode"], a.get("maxDepth", 5), a.get("limit", 150)
        ),
        "hierarchyEdges": lambda a: q.hierarchy_edges(a["ids"]),
        "descendantIds": lambda a: q.descendant_ids(a["ids"], a["mode"]),
        "mappedIds": lambda a: q.mapped_ids(a["ids"]),
        "resolvedDetails": lambda a: q.resolved_details(a["ids"]),
        "vocabularyVersions": lambda a: q.vocabulary_versions(),
        "filterOptions": lambda a: q.filter_options(a["column"]),
    }
    sql, params = simple[builder](args)
    return {"sql": sql, "params": params}


def sql_golden() -> dict:
    cases = [{"builder": b, "input": a, "output": call(b, a)} for b, a in GOLDEN_INPUTS]
    for b, a in REJECTS:
        try:
            call(b, a)
        except (q.QueryError, TypeError, ValueError):
            continue
        raise AssertionError(f"{b}({a}) should have been rejected")
    return {"cases": cases, "rejects": [{"builder": b, "input": a} for b, a in REJECTS]}


def write(name: str, value) -> None:
    (HERE / name).write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    write("resolve-cases.json", resolve_cases())
    write("sql-golden.json", sql_golden())
    print("wrote resolve-cases.json, sql-golden.json")
