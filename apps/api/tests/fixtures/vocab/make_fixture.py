"""Writes the tiny ATHENA export under athena/ (tab-separated, unquoted, dates as
YYYYMMDD, as ATHENA ships them) used by the vocabulary, resolver and parity
tests of both the API and the web app.

Synthetic concepts, not real OMOP rows: the shapes are what matter. They cover a
the "No matching concept" row ATHENA ships (vocabulary 'None', whose VOCABULARY
row carries the release), a multi-level SNOMED hierarchy with a two-parent concept, ICD10 codes that `Maps
to` standard concepts (and the reverse `Mapped from` rows), an invalid concept,
a LOINC classification concept over flat LOINC tests, an accented name, and
synonyms in two languages. CONCEPT_ANCESTOR is the full transitive closure,
self rows included, computed from the parent edges below.

Rerun after editing (`python3 make_fixture.py`), then regenerate the expected
outputs: `python -m pytest tests/test_vocabulary_parity.py --regen` from apps/api.
"""

from collections import deque
from pathlib import Path

OUT = Path(__file__).resolve().parent / "athena"

# id, name, domain, vocabulary, class, standard, code, invalid_reason
CONCEPTS = [
    (0, "No matching concept", "Metadata", "None", "Undefined", "", "No matching concept", ""),
    (100, "Clinical finding", "Condition", "SNOMED", "Clinical Finding", "S", "404684003", ""),
    (101, "Disorder of cardiovascular system", "Condition", "SNOMED", "Disorder", "S", "49601007", ""),
    (102, "Heart disease", "Condition", "SNOMED", "Disorder", "S", "56265001", ""),
    (103, "Myocardial infarction", "Condition", "SNOMED", "Disorder", "S", "22298006", ""),
    (104, "Acute myocardial infarction", "Condition", "SNOMED", "Disorder", "S", "57054005", ""),
    (105, "Old myocardial infarction", "Condition", "SNOMED", "Disorder", "S", "1755008", ""),
    (106, "Acute anterior myocardial infarction", "Condition", "SNOMED", "Disorder", "S", "54329005", ""),
    (107, "Heart failure", "Condition", "SNOMED", "Disorder", "S", "84114007", ""),
    (108, "Congestive heart failure", "Condition", "SNOMED", "Disorder", "S", "42343007", ""),
    (109, "Hypertensive heart disease", "Condition", "SNOMED", "Disorder", "S", "64715009", ""),
    (110, "Hypertensive disorder", "Condition", "SNOMED", "Disorder", "S", "38341003", ""),
    (111, "Essential hypertension", "Condition", "SNOMED", "Disorder", "S", "59621000", ""),
    (112, "Ménière's disease", "Condition", "SNOMED", "Disorder", "S", "13445001", ""),
    (120, "Myocardial infarction, old concept", "Condition", "SNOMED", "Disorder", "", "1000120", "U"),
    (200, "Acute myocardial infarction", "Condition", "ICD10", "3-char nonbill code", "", "I21", ""),
    (201, "Heart failure", "Condition", "ICD10", "3-char nonbill code", "", "I50", ""),
    (202, "Essential (primary) hypertension", "Condition", "ICD10", "3-char billing code", "", "I10", ""),
    (300, "Heart rate", "Measurement", "LOINC", "Clinical Observation", "S", "8867-4", ""),
    (301, "Heart rate --resting", "Measurement", "LOINC", "Clinical Observation", "S", "40443-4", ""),
    (302, "Body temperature", "Measurement", "LOINC", "Clinical Observation", "S", "8310-5", ""),
    (310, "Vital signs", "Measurement", "LOINC", "LOINC Group", "C", "LG41810-1", ""),
    (400, "aspirin", "Drug", "RxNorm", "Ingredient", "S", "1191", ""),
    (401, "aspirin 81 MG Oral Tablet", "Drug", "RxNorm", "Clinical Drug", "S", "243670", ""),
    (402, "aspirin 325 MG Oral Tablet", "Drug", "RxNorm", "Clinical Drug", "S", "198467", ""),
    (500, "millimeter mercury column", "Unit", "UCUM", "Unit", "S", "mm[Hg]", ""),
    (600, "Heart structure", "Spec Anatomic Site", "SNOMED", "Body Structure", "S", "80891009", ""),
    (4180186, "English language", "Observation", "SNOMED", "Qualifier Value", "S", "297496003", ""),
    (4180190, "French language", "Observation", "SNOMED", "Qualifier Value", "S", "297500009", ""),
]

# child → parents (direct `Is a` edges among standard / classification concepts)
PARENTS = {
    101: [100],
    102: [101],
    103: [102],
    104: [103],
    105: [103],
    106: [104],
    107: [102],
    108: [107],
    110: [101],
    109: [102, 110],
    111: [110],
    112: [100],
    300: [310],
    301: [310],
    302: [310],
    401: [400],
    402: [400],
}

# (concept_id_1, concept_id_2, relationship_id, invalid_reason); reverse rows are added.
RELATIONSHIPS = [
    (200, 104, "Maps to", ""),
    (201, 107, "Maps to", ""),
    (202, 111, "Maps to", ""),
    (120, 103, "Maps to", ""),
    (120, 103, "Concept replaced by", ""),
    (103, 600, "Has finding site", ""),
    (102, 600, "Has finding site", "D"),
]
REVERSE = {
    "Maps to": "Mapped from",
    "Concept replaced by": "Concept replaces",
    "Has finding site": "Finding site of",
    "Is a": "Subsumes",
}

SYNONYMS = [
    (103, "Heart attack", 4180186),
    (103, "Infarctus du myocarde", 4180190),
    (300, "Pulse rate", 4180186),
    (300, "Fréquence cardiaque", 4180190),
]

VOCABULARIES = [
    ("None", "OMOP Standardized Vocabularies", "OMOP generated", "v5.0 01-SEP-26", 44819096),
    (
        "SNOMED",
        "Systematic Nomenclature of Medicine - Clinical Terms (IHTSDO)",
        "http://snomed.info",
        "2026-03-01 SNOMED CT International Edition",
        44819097,
    ),
    (
        "ICD10",
        "International Classification of Diseases, Tenth Revision (WHO)",
        "http://www.who.int",
        "2021 Release",
        44819124,
    ),
    (
        "LOINC",
        "Logical Observation Identifiers Names and Codes (Regenstrief Institute)",
        "http://loinc.org",
        "LOINC 2.81",
        44819102,
    ),
    ("RxNorm", "RxNorm (NLM)", "http://www.nlm.nih.gov/research/umls/rxnorm", "RxNorm 20260901", 44819104),
    (
        "UCUM",
        "Unified Code for Units of Measure (Regenstrief Institute)",
        "http://unitsofmeasure.org",
        "Version 1.8.2",
        44819107,
    ),
]

RELATIONSHIP_ROWS = [
    ("Is a", "Is a", "1", "1", "Subsumes", 44818821),
    ("Subsumes", "Subsumes", "1", "0", "Is a", 44818723),
    ("Maps to", "Non-standard to Standard map (OMOP)", "0", "0", "Mapped from", 44818977),
    ("Mapped from", "Standard to Non-standard map (OMOP)", "0", "0", "Maps to", 44818978),
    ("Concept replaced by", "Concept replaced by (LOINC)", "0", "0", "Concept replaces", 44818720),
    ("Concept replaces", "Concept replaces (LOINC)", "0", "0", "Concept replaced by", 44818721),
    ("Has finding site", "Has finding site (SNOMED)", "0", "0", "Finding site of", 44818800),
    ("Finding site of", "Finding site of (SNOMED)", "0", "0", "Has finding site", 44818801),
]


def closure() -> list[tuple[int, int, int, int]]:
    """(ancestor, descendant, min, max) for every pair, self rows at level 0."""
    children: dict[int, list[int]] = {}
    for child, parents in PARENTS.items():
        for p in parents:
            children.setdefault(p, []).append(child)
    in_hierarchy = {c[0] for c in CONCEPTS if c[5] in ("S", "C")}
    rows = []
    for a in sorted(in_hierarchy):
        levels: dict[int, list[int]] = {a: [0]}
        queue = deque([(a, 0)])
        while queue:
            node, depth = queue.popleft()
            for ch in children.get(node, []):
                levels.setdefault(ch, []).append(depth + 1)
                queue.append((ch, depth + 1))
        for d, ls in sorted(levels.items()):
            rows.append((a, d, min(ls), max(ls)))
    return rows


def write(name: str, header: list[str], rows) -> None:
    lines = ["\t".join(header)] + ["\t".join("" if v is None else str(v) for v in r) for r in rows]
    (OUT / f"{name}.csv").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    write(
        "CONCEPT",
        [
            "concept_id",
            "concept_name",
            "domain_id",
            "vocabulary_id",
            "concept_class_id",
            "standard_concept",
            "concept_code",
            "valid_start_date",
            "valid_end_date",
            "invalid_reason",
        ],
        [
            (i, n, d, v, k, s, code, "19700101", "20991231" if not inv else "20200101", inv)
            for i, n, d, v, k, s, code, inv in CONCEPTS
        ],
    )
    write(
        "CONCEPT_ANCESTOR",
        ["ancestor_concept_id", "descendant_concept_id", "min_levels_of_separation", "max_levels_of_separation"],
        closure(),
    )
    rel = []
    for c1, c2, r, inv in RELATIONSHIPS:
        rel.append((c1, c2, r, "19700101", "20991231", inv))
        rel.append((c2, c1, REVERSE[r], "19700101", "20991231", inv))
    for child, parents in PARENTS.items():
        for p in parents:
            rel.append((child, p, "Is a", "19700101", "20991231", ""))
            rel.append((p, child, "Subsumes", "19700101", "20991231", ""))
    write(
        "CONCEPT_RELATIONSHIP",
        ["concept_id_1", "concept_id_2", "relationship_id", "valid_start_date", "valid_end_date", "invalid_reason"],
        sorted(rel),
    )
    write("CONCEPT_SYNONYM", ["concept_id", "concept_synonym_name", "language_concept_id"], SYNONYMS)
    write(
        "VOCABULARY",
        ["vocabulary_id", "vocabulary_name", "vocabulary_reference", "vocabulary_version", "vocabulary_concept_id"],
        VOCABULARIES,
    )
    write(
        "RELATIONSHIP",
        [
            "relationship_id",
            "relationship_name",
            "is_hierarchical",
            "defines_ancestry",
            "reverse_relationship_id",
            "relationship_concept_id",
        ],
        RELATIONSHIP_ROWS,
    )
    domains = sorted({c[2] for c in CONCEPTS})
    write(
        "DOMAIN", ["domain_id", "domain_name", "domain_concept_id"], [(d, d, 1000 + i) for i, d in enumerate(domains)]
    )
    classes = sorted({c[4] for c in CONCEPTS})
    write(
        "CONCEPT_CLASS",
        ["concept_class_id", "concept_class_name", "concept_class_concept_id"],
        [(k, k, 2000 + i) for i, k in enumerate(classes)],
    )


if __name__ == "__main__":
    main()
