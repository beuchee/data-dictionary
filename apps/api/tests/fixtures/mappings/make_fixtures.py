"""Writes the mapping-import fixtures under inputs/, read by both the Python
(tests/test_mapping_import.py) and the TS (apps/web/src/lib/mapping-import/
parity.test.ts) suites through cases.json.

The text formats copy what Linkr's exporters write (linkr@1310cf4a4
apps/web/src/lib/concept-mapping/{stcm-export,ccr-export,export}.ts): the
source_to_concept_map CSV with its extra `source_domain_id` column, the
CONCEPT + CONCEPT_RELATIONSHIP pair ('Maps to' + 'Mapped from', 2-billion source
ids), the SSSOM TSV with its `#curie_map` block and `sssom:NoTermFound`, the
Usagi CSV, and the project folder (entity.json + mappings.json, as in Linkr's
export-golden fixture). Then the awkward cases a real file brings: a BOM, CRLF,
`;` and tab separators, Windows-1252 and UTF-16 text, quoted fields with commas,
quotes and newlines, multi-target cells, huge ids, `0` targets, invalid
relationship rows, a negated SSSOM row, an XLSX workbook, ZIPs with macOS junk.

Binary files (XLSX, ZIP) are written with fixed timestamps so a rerun is
byte-stable. After editing: `python3 make_fixtures.py`, then regenerate the
expected outputs from the TS implementation (`UPDATE_MAPPING_GOLDEN=1 npx vitest
run src/lib/mapping-import` in apps/web), review the diff, and run pytest.
"""

import io
import json
import re
import zipfile
from pathlib import Path

from openpyxl import Workbook

OUT = Path(__file__).resolve().parent / "inputs"
ZIP_DATE = (2026, 1, 1, 0, 0, 0)


def write(name: str, data: bytes | str, encoding: str = "utf-8") -> None:
    path = OUT / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data if isinstance(data, bytes) else data.encode(encoding))


def zip_bytes(entries: list[tuple[str, bytes | str]]) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for name, data in entries:
            info = zipfile.ZipInfo(name, ZIP_DATE)
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, data if isinstance(data, bytes) else data.encode("utf-8"))
    return buf.getvalue()


# --- source_to_concept_map (Linkr's STCM CSV: OMOP columns + source_domain_id) -----------

STCM_HEADER = (
    "source_code,source_concept_id,source_vocabulary_id,source_code_description,target_concept_id,"
    "target_vocabulary_id,valid_start_date,valid_end_date,invalid_reason,source_domain_id"
)
STCM_ROWS = [
    'HR,2000000001,EHOP,Heart rate,3027018,LOINC,1970-01-01,2099-12-31,,Measurement',
    '"NA","2000000002","EHOP","Sodium [Moles/volume] in Serum, Plasma","3019550","LOINC",1970-01-01,2099-12-31,,Measurement',
    'TEMP,2000000003,EHOP,"Temp ""core""",0,,1970-01-01,2099-12-31,,Measurement',
    'OLD,2000000004,EHOP,Deprecated code,3004249,LOINC,1970-01-01,2020-12-31,D,Measurement',
    'SPO2,0,EHOP,Oxygen saturation,40762499,LOINC,1970-01-01,2099-12-31,,Measurement',
    'BAD,2000000006,EHOP,Not an id,abc,LOINC,1970-01-01,2099-12-31,,Measurement',
    ',,,,,,,,,',
    'HUGE,2000000007,EHOP,Too large,9007199254740993,LOINC,1970-01-01,2099-12-31,,Measurement',
]


def stcm() -> None:
    write("stcm/source_to_concept_map.csv", "\n".join([STCM_HEADER, *STCM_ROWS]) + "\n")
    # Same content, as Excel on Windows writes it: BOM, CRLF, `;`.
    semicolon = [
        "﻿source_code;source_concept_id;source_vocabulary_id;source_code_description;target_concept_id;invalid_reason",
        "HR;2000000001;EHOP;Heart rate, bedside;3027018;",
        "PAS;2000000008;EHOP;Pression artérielle systolique;3004249;",
        "NOTE;2000000009;EHOP;\"Multi\r\nline; quoted\";0;",
    ]
    write("stcm/stcm_semicolon_bom.csv", "\r\n".join(semicolon) + "\r\n")
    latin = "source_code,source_vocabulary_id,source_code_description,target_concept_id\nFC,EHOP,Fréquence cardiaque,3027018\n"
    write("stcm/stcm_cp1252.csv", latin, encoding="cp1252")
    utf16 = "source_code\ttarget_concept_id\r\nHR\t3027018\r\nRR\t3024171\r\n"
    write("stcm/stcm_utf16.txt", b"\xff\xfe" + utf16.encode("utf-16-le"))
    write("stcm/stcm_missing_target.csv", "source_code,source_vocabulary_id\nHR,EHOP\n")


# --- CONCEPT + CONCEPT_RELATIONSHIP (Linkr's C/CR export; ATHENA's tab layout in the ZIP) --

CONCEPT_ROWS = [
    ["concept_id", "concept_name", "domain_id", "vocabulary_id", "concept_class_id", "standard_concept",
     "concept_code", "valid_start_date", "valid_end_date", "invalid_reason"],
    ["2000000001", "Heart rate", "Measurement", "EHOP", "Clinical Observation", "", "HR", "1970-01-01", "2099-12-31", ""],
    ["2000000002", "Sodium, serum", "Measurement", "EHOP", "Lab Test", "", "NA", "1970-01-01", "2099-12-31", ""],
    ["2000000003", "Ventilation mode", "Observation", "EHOP", "Observation", "", "VMODE", "1970-01-01", "2099-12-31", ""],
    ["2000000004", "Unmapped code", "Observation", "EHOP", "Observation", "", "FREE", "1970-01-01", "2099-12-31", ""],
    ["2000000005", "Retired code", "Observation", "EHOP", "Observation", "", "RET", "1970-01-01", "2020-12-31", "D"],
    ["2000000006", "Only an invalid map", "Observation", "EHOP", "Observation", "", "INV", "1970-01-01", "2099-12-31", ""],
]
RELATIONSHIP_ROWS = [
    ["concept_id_1", "concept_id_2", "relationship_id", "valid_start_date", "valid_end_date", "invalid_reason"],
    ["2000000001", "3027018", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["3027018", "2000000001", "Mapped from", "1970-01-01", "2099-12-31", ""],
    ["2000000002", "3019550", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["2000000002", "3019550", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["2000000003", "4230167", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["2000000003", "45878245", "Maps to value", "1970-01-01", "2099-12-31", ""],
    ["2000000006", "3004249", "Maps to", "1970-01-01", "2020-12-31", "D"],
    ["2000000005", "3004249", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["2000000001", "x", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["9999999", "3027018", "Maps to", "1970-01-01", "2099-12-31", ""],
    ["2000000002", "4000000", "Is a", "1970-01-01", "2099-12-31", ""],
]


def table(rows: list[list[str]], sep: str) -> str:
    """Quoted only where needed (Linkr's csvField); ATHENA's TSV is never quoted."""

    def field(v: str) -> str:
        return f'"{v}"' if sep == "," and ("," in v or '"' in v) else v

    return "\n".join(sep.join(field(v) for v in r) for r in rows) + "\n"


def ccr() -> None:
    write("ccr/concept.csv", table(CONCEPT_ROWS, ","))
    write("ccr/concept_relationship.csv", table(RELATIONSHIP_ROWS, ","))
    write(
        "ccr/ccr_athena.zip",
        zip_bytes(
            [
                ("export/CONCEPT.csv", table(CONCEPT_ROWS, "\t")),
                ("export/CONCEPT_RELATIONSHIP.csv", table(RELATIONSHIP_ROWS, "\t")),
                ("__MACOSX/export/._CONCEPT.csv", b"\x00\x05\x16\x07junk"),
                ("export/.DS_Store", b"\x00junk"),
            ]
        ),
    )
    write("ccr/relationship_only.tsv", table(RELATIONSHIP_ROWS, "\t"))


# --- SSSOM (Linkr's exportToSssomTsv, plus a predicate_modifier column and foreign objects) --

SSSOM = """#curie_map:
#  skos: "http://www.w3.org/2004/02/skos/core#"
#  semapv: "https://w3id.org/semapv/vocab/"
#  sssom: "https://w3id.org/sssom/"
#  OHDSI: "http://ohdsi.org/concept/"
#  omopc: "https://omop.example.org/concept/"
#  SNOMED: "http://snomed.info/id/"
#mapping_set_id: "adult-icu"
#mapping_set_title: "Adult ICU"
#mapping_date: "2026-01-01"
#license: "https://creativecommons.org/publicdomain/zero/1.0/"
subject_id\tsubject_label\tsubject_source\tpredicate_id\tpredicate_modifier\tobject_id\tobject_label\tobject_source\tmapping_cardinality\tmapping_justification\tconfidence\tauthor_id\tcomment
EHOP:HR\tHeart rate\tEHOP\tskos:exactMatch\t\tOHDSI:3027018\tHeart rate\tLOINC\t\tsemapv:ManualMappingCuration\t\tBoris\t
EHOP:NA\tSodium, serum\tEHOP\tskos:broadMatch\t\tomopc:3019550\tSodium\tLOINC\t\tsemapv:UnspecifiedMatching\t0.9\tBoris\ta | b
EHOP:FREE\tFree text\tEHOP\tskos:exactMatch\t\tsssom:NoTermFound\t\tOHDSI\t1:0\tsemapv:ManualMappingCuration\t\t\t
EHOP:NEG\tNegated\tEHOP\tskos:exactMatch\tNot\tOHDSI:3004249\t\tLOINC\t\tsemapv:ManualMappingCuration\t\t\t
EHOP:SCT\tTo SNOMED IRI\tEHOP\tskos:exactMatch\t\tSNOMED:22298006\t\tSNOMED\t\tsemapv:ManualMappingCuration\t\t\t
LOCAL1\tNo prefix\tEHOP\tskos:closeMatch\t\thttps://athena.ohdsi.org/search-terms/terms/40762499\t\tLOINC\t\t\t\t\t
EHOP:BAD\tBad id\tEHOP\tskos:exactMatch\t\tOHDSI:12ab\t\tLOINC\t\t\t\t\t
"""


def sssom() -> None:
    write("sssom/mappings.sssom.tsv", SSSOM)


# --- Usagi -------------------------------------------------------------------------------------

USAGI_HEADER = (
    "sourceCode,sourceName,sourceFrequency,sourceAutoAssignedConceptIds,matchScore,mappingStatus,equivalence,"
    "statusSetBy,statusSetOn,conceptId,conceptName,domainId,mappingType,comment,createdBy,createdOn,assignedReviewer"
)
USAGI_ROWS = [
    'HR,Heart rate,1520,,0.98,APPROVED,EQUAL,Boris,1767225600000,3027018,Heart rate,Measurement,MAPS_TO,,Boris,1767225600000,',
    'NA,"Sodium, serum",88,,0.7,UNCHECKED,EQUIVALENT,,0,3019550,Sodium,Measurement,MAPS_TO,,Boris,0,',
    'VMODE,"Mode ""VS-AI""\nventilation",12,,0,APPROVED,WIDER,Boris,0,4230167,Ventilation,Observation,MAPS_TO,,Boris,0,',
    'VMODE,"Mode ""VS-AI""\nventilation",12,,0,APPROVED,NARROWER,Boris,0,45878245,Pressure support,Observation,MAPS_TO_VALUE,,Boris,0,',
    'FREE,Free text,<5,,0,APPROVED,UNMATCHED,Boris,0,0,,,,,Boris,0,',
    'FLAG,Flagged one,3.5,,0,FLAGGED,INEXACT,Boris,0,3004249,SBP,Measurement,MAPS_TO,,Boris,0,',
    'BIG,Too large,1,,0,APPROVED,EQUAL,,0,99999999999999999999,,,,,,0,',
]


def usagi() -> None:
    write("usagi/usagi.csv", "\n".join([USAGI_HEADER, *USAGI_ROWS]) + "\n")


# --- Linkr mapping project (entity.json + mappings.json; its JSON export) ---------------------

ENTITY = {
    "entityId": "adult-icu",
    "type": "mapping-project",
    "name": {"en": "Adult ICU", "fr": "Réanimation adulte"},
    "status": "in_progress",
    "version": "0.1.0",
}


def mapping(code: str, name: str, target, status: str, **extra) -> dict:
    return {
        "sourceConceptName": name,
        "sourceVocabularyId": "LOINC",
        "sourceDomainId": None,
        "sourceConceptCode": code,
        "sourceFrequency": extra.get("frequency"),
        "targetConceptId": target,
        "targetConceptName": "Tidal volume",
        "targetVocabularyId": "LOINC",
        "equivalence": extra.get("equivalence", "skos:exactMatch"),
        "status": status,
        "mappedBy": "Boris",
        "createdAt": "2026-01-01T00:00:00.000Z",
        **({"sourceConceptId": extra["sourceConceptId"]} if "sourceConceptId" in extra else {}),
    }


LINKR_MAPPINGS = [
    mapping("AA", "first", 3000905, "unchecked"),
    mapping("ZZ", "last", 3000905, "approved", frequency=42, sourceConceptId=2000000010),
    mapping("IGN", "ignored", 0, "ignored"),
    mapping("NUL", "no target", None, "approved", equivalence="equal"),
    mapping("STR", "string target", "3027018", "Approved", frequency=7.0),
    mapping("REJ", "rejected", 3004249, "rejected", equivalence="wider"),
    "not a mapping",
    mapping("FLT", "float target", 3019550.0, "approved"),
    mapping("BOOL", "bool target", True, "approved"),
]


def linkr() -> None:
    write(
        "linkr/project.zip",
        zip_bytes(
            [
                ("adult-icu/entity.json", json.dumps(ENTITY, indent=2, ensure_ascii=False)),
                ("adult-icu/mappings.json", json.dumps(LINKR_MAPPINGS, indent=2, ensure_ascii=False)),
                ("adult-icu/README.md", "# Adult ICU\n"),
                ("adult-icu/source-concepts.csv", "terminology,concept_code,concept_name\nLOINC,AA,first\n"),
            ]
        ),
    )
    export = {
        "exportFormat": "linkr-concept-mapping",
        "exportVersion": "1.0",
        "exportedAt": "2026-01-01T00:00:00.000Z",
        "project": {"id": "p1", "name": "Exported project"},
        "mappings": LINKR_MAPPINGS[:2],
    }
    write("linkr/export.json", json.dumps(export, indent=2))
    write("linkr/broken.json", '{"exportFormat": "linkr-concept-mapping", "mappings": [')
    write("linkr/bad.zip", b"PK\x03\x04 this is not really a zip")


# --- Plain lists and generic tables --------------------------------------------------------------


def lists() -> None:
    write("list/ids.txt", "3027018\n\n3019550\n0\nabc\n3027018\n9007199254740993\n3004249.0\n")
    write("list/ids_header.csv", "concept_id\n3027018\n 3019550 \n")
    write("list/empty.csv", "\n\n  \n")
    write("list/notes.pdf", b"%PDF-1.4 not a table")


def generic() -> None:
    tsv = (
        "code\tlibellé\tomop\tstatut\tnb\tvocab\n"
        "HR\tFréquence cardiaque\t3027018\tValidé\t1 520\tEHOP\n"
        "NA\tNatrémie\t3019550;3000285 | 3000285\tvalidé\t88\tEHOP\n"
        "FREE\tTexte libre\t\t\t\tEHOP\n"
        "MIX\tMixed cell\t3004249, oops\t\t2.5\tEHOP\n"
        "\t\t\t\t\t\n"
        "ZERO\tZéro\t0\t\t\tEHOP\n"
        "\t\tnope\t\t\t\n"
    )
    write("generic/custom.tsv", tsv)
    noheader = "exported by tool X\nversion 2\nHR,3027018\nNA,3019550\n"
    write("generic/noheader.csv", noheader)

    wb = Workbook()
    first = wb.active
    first.title = "Readme"
    first.append(["This workbook holds the mapping on the second sheet."])
    sheet = wb.create_sheet("Mapping")
    sheet.append(["Code", "Label", "Concept ID", "Count", "Reviewed"])
    sheet.append(["HR", "Heart rate", 3027018, 1520, True])
    sheet.append(["NA", "Sodium", 3019550.0, 88.5, False])
    sheet.append(["FREE", "Free text", None, None, None])
    sheet.append([None, None, None, None, None])
    sheet.append(["MULTI", "Two targets", "3004249|3012888", 3, None])
    buf = io.BytesIO()
    wb.save(buf)
    write("generic/workbook.xlsx", stable_xlsx(buf.getvalue()))


def stable_xlsx(data: bytes) -> bytes:
    """openpyxl stamps the save time into docProps/core.xml and the ZIP entries."""
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        entries = [(n, z.read(n)) for n in z.namelist()]
    fixed = []
    for name, content in entries:
        if name == "docProps/core.xml":
            content = re.sub(rb"(<dcterms:(?:created|modified)[^>]*>)[^<]*", rb"\g<1>2026-01-01T00:00:00Z", content)
        fixed.append((name, content))
    return zip_bytes(fixed)


if __name__ == "__main__":
    stcm()
    ccr()
    sssom()
    usagi()
    linkr()
    lists()
    generic()
