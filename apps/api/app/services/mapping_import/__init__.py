"""Mapping import: files of any supported format → normalized mapping rows
(docs/planning/v2-plan.md §7). Twin of apps/web/src/lib/mapping-import/: both
are checked against tests/fixtures/mappings/cases.json.

A row is `{sourceVocabularyId?, sourceCode?, sourceName?, sourceConceptId?,
targetConceptId (0 = unmapped), equivalence?, status?, frequency?}`.
"""

import io
import zipfile

from app.services.mapping_import.errors import ERROR_CODES, MappingImportError
from app.services.mapping_import.formats import (
    ccr_tables,
    find_column,
    first_tabular,
    parse_ccr,
    parse_concept_ids,
    parse_generic,
    parse_linkr,
    parse_sssom,
    parse_stcm,
    parse_usagi,
)
from app.services.mapping_import.table import (
    InputFile,
    extension_of,
    is_tabular,
    read_cells,
    read_table,
    table_from_cells,
)
from app.services.mapping_import.text import decode, header_key
from app.services.mapping_import.values import parse_id

__all__ = [
    "ERROR_CODES",
    "FORMATS",
    "InputFile",
    "MappingImportError",
    "detect_format",
    "expand_files",
    "guess_roles",
    "parse_mapping",
]

FORMATS = ("generic", "stcm", "ccr", "sssom", "usagi", "linkr", "concept_ids")
COLUMN_ROLES = (
    "sourceVocabularyId",
    "sourceCode",
    "sourceName",
    "sourceConceptId",
    "targetConceptId",
    "equivalence",
    "status",
    "frequency",
)

# Uncompressed bytes a ZIP may expand to (zip bombs).
MAX_UNZIPPED_BYTES = 1024**3


def _skip_entry(name: str) -> bool:
    if name.endswith("/"):
        return True
    if name.startswith("__MACOSX/") or "/__MACOSX/" in name:
        return True
    return name.rsplit("/", 1)[-1].startswith(".")


def expand_files(files: list[InputFile]) -> list[InputFile]:
    """ZIPs replaced by their entries (directories, `__MACOSX` and dotfiles dropped)."""
    out: list[InputFile] = []
    for f in files:
        if extension_of(f.name) != ".zip":
            out.append(f)
            continue
        try:
            with zipfile.ZipFile(io.BytesIO(f.data)) as z:
                infos = [i for i in z.infolist() if not _skip_entry(i.filename)]
                if sum(i.file_size for i in infos) > MAX_UNZIPPED_BYTES:
                    raise MappingImportError("bad_zip", "too large")
                for info in infos:
                    out.append(InputFile(info.filename, z.read(info)))
        except MappingImportError:
            raise
        except (zipfile.BadZipFile, OSError, ValueError, EOFError):
            raise MappingImportError("bad_zip", f.name) from None
    return out


_ROLE_NAMES = [
    (
        "targetConceptId",
        ["target_concept_id", "concept_id", "omop_concept_id", "standard_concept_id", "target_id", "omop_id", "omop"],
    ),
    ("sourceConceptId", ["source_concept_id"]),
    ("sourceCode", ["source_code", "code", "source_value", "concept_code", "local_code"]),
    (
        "sourceVocabularyId",
        ["source_vocabulary_id", "vocabulary_id", "vocabulary", "terminology", "source_vocabulary", "vocab"],
    ),
    (
        "sourceName",
        [
            "source_code_description",
            "source_name",
            "source_label",
            "label",
            "name",
            "description",
            "concept_name",
            "libelle",
            "libellé",
        ],
    ),
    ("status", ["status", "mapping_status", "statut"]),
    ("equivalence", ["equivalence", "predicate_id", "predicate"]),
    ("frequency", ["frequency", "source_frequency", "count", "record_count", "records", "n", "nb"]),
]


def guess_roles(headers: list[str]) -> dict[str, str]:
    """Column roles guessed from header names (each header used once)."""
    keys = [header_key(h) for h in headers]
    used: set[int] = set()
    roles: dict[str, str] = {}
    for role, names in _ROLE_NAMES:
        for name in names:
            k = header_key(name)
            if k in keys and keys.index(k) not in used:
                i = keys.index(k)
                roles[role] = headers[i]
                used.add(i)
                break
    return roles


def detect_format(files: list[InputFile], options: dict | None = None) -> dict:
    """`{format, options}`: the likely format of (already unzipped) files, and
    options to start from. Same rules as the TS twin."""
    options = options or {}
    if not files:
        raise MappingImportError("no_file")
    if any(extension_of(f.name) == ".json" for f in files):
        return {"format": "linkr", "options": {}}
    tabular = [f for f in files if is_tabular(f)]
    if not tabular:
        raise MappingImportError("unsupported_file", files[0].name)
    if len(tabular) > 1 and ccr_tables(tabular, options)[1] is not None:
        return {"format": "ccr", "options": {}}
    f = tabular[0]
    if extension_of(f.name) != ".xlsx" and decode(f.data, options.get("encoding") or "auto").startswith("#"):
        return {"format": "sssom", "options": {}}
    cells, _, _ = read_cells(f, options)
    headers = table_from_cells(cells, {**options, "hasHeader": True}).headers

    def has(*names: str) -> bool:
        return all(find_column(headers, n) >= 0 for n in names)

    if has("subject_id", "object_id"):
        return {"format": "sssom", "options": {}}
    if has("sourceCode", "conceptId", "mappingStatus"):
        return {"format": "usagi", "options": {}}
    if has("source_code", "target_concept_id"):
        return {"format": "stcm", "options": {}}
    if has("concept_id_1", "concept_id_2", "relationship_id"):
        return {"format": "ccr", "options": {}}
    if len(headers) == 1:
        rows = cells[max(0, int(options.get("skipRows") or 0)) :]
        has_header = bool(rows) and parse_id(rows[0][0] if rows[0] else None) is None
        data = rows[1:] if has_header else rows
        if any(parse_id(r[0] if r else None) is not None for r in data):
            return {"format": "concept_ids", "options": {"hasHeader": has_header}}
    return {"format": "generic", "options": {"columns": guess_roles(headers)}}


def parse_mapping(files: list[InputFile], options: dict) -> dict:
    """Parse `files` (ZIPs expanded first) as `options["format"]`. Raises
    MappingImportError. The result has the TS `ParseResult` shape."""
    expanded = expand_files(files)
    if not expanded:
        raise MappingImportError("no_file")
    fmt = options.get("format")
    if fmt == "generic":
        return parse_generic(read_table(first_tabular(expanded), options), options)
    if fmt == "concept_ids":
        return parse_concept_ids(expanded, options)
    if fmt == "stcm":
        return parse_stcm(read_table(first_tabular(expanded), options))
    if fmt == "usagi":
        return parse_usagi(read_table(first_tabular(expanded), options))
    if fmt == "ccr":
        return parse_ccr(expanded, options)
    if fmt == "sssom":
        return parse_sssom(expanded, options)
    if fmt == "linkr":
        return parse_linkr(expanded)
    raise ValueError(f"Unknown format {fmt!r}")
