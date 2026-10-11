"""One parser per format. Twin of apps/web/src/lib/mapping-import/formats.ts."""

import json
import re

from app.services.mapping_import.errors import MappingImportError
from app.services.mapping_import.table import (
    InputFile,
    Table,
    extension_of,
    is_tabular,
    read_cells,
    read_table,
    table_from_cells,
)
from app.services.mapping_import.text import clean, decode, header_key, parse_delimited
from app.services.mapping_import.values import (
    RowSink,
    equivalence,
    parse_frequency,
    parse_id,
    parse_targets,
    status,
    text,
)


def find_column(headers: list[str], *names: str) -> int:
    keys = [header_key(h) for h in headers]
    for name in names:
        k = header_key(name)
        if k in keys:
            return keys.index(k)
    return -1


def _cell(row: list[str], index: int) -> str | None:
    return row[index] if 0 <= index < len(row) else None


def _source_id(value: object) -> int | None:
    id_ = parse_id(value)
    return id_ or None


def _has_source(source: dict) -> bool:
    return any(source.get(k) is not None for k in ("sourceCode", "sourceName", "sourceConceptId"))


def _add_or_blank(sink: RowSink, source: dict, target: str | None, row: int) -> None:
    if not _has_source(source) and text(target) is None:
        sink.skip("blank_row", row)
    else:
        sink.add_cell(source, target, row)


def _require(columns: dict[str, int]) -> None:
    missing = [name for name, i in columns.items() if i < 0]
    if missing:
        raise MappingImportError("missing_columns", ", ".join(missing))


def first_tabular(files: list[InputFile]) -> InputFile:
    for f in files:
        if is_tabular(f):
            return f
    raise MappingImportError("unsupported_file" if files else "no_file", files[0].name if files else None)


# --- Generic table -------------------------------------------------------------------------


def parse_generic(table: Table, options: dict) -> dict:
    roles = options.get("columns") or {}
    if not roles.get("targetConceptId"):
        raise MappingImportError("missing_columns", "targetConceptId")

    def index(role: str) -> int:
        name = roles.get(role)
        if not name:
            return -1
        if name not in table.headers:
            raise MappingImportError("missing_columns", name)
        return table.headers.index(name)

    target = index("targetConceptId")
    roles_ = ("sourceVocabularyId", "sourceCode", "sourceName", "sourceConceptId", "equivalence", "status", "frequency")
    cols = {r: index(r) for r in roles_}
    sink = RowSink()
    for i, r in enumerate(table.rows):
        sink.read()
        source = {
            "sourceVocabularyId": text(_cell(r, cols["sourceVocabularyId"])),
            "sourceCode": text(_cell(r, cols["sourceCode"])),
            "sourceName": text(_cell(r, cols["sourceName"])),
            "sourceConceptId": _source_id(_cell(r, cols["sourceConceptId"])),
            "equivalence": text(_cell(r, cols["equivalence"])),
            "status": status(_cell(r, cols["status"])),
            "frequency": parse_frequency(_cell(r, cols["frequency"])),
        }
        _add_or_blank(sink, source, _cell(r, target), i + 1)
    return sink.result("generic")


# --- A list of concept ids ------------------------------------------------------------------


def parse_concept_ids(files: list[InputFile], options: dict) -> dict:
    cells, _, _ = read_cells(first_tabular(files), options)
    skip = max(0, int(options.get("skipRows") or 0))
    first = cells[skip][0] if len(cells) > skip and cells[skip] else None
    has_header = options.get("hasHeader")
    if has_header is None:
        has_header = first is not None and parse_id(first) is None
    table = table_from_cells(cells, {**options, "hasHeader": has_header})
    column = (options.get("columns") or {}).get("targetConceptId")
    if column and column not in table.headers:
        raise MappingImportError("missing_columns", column)
    index = table.headers.index(column) if column else 0
    sink = RowSink()
    for i, r in enumerate(table.rows):
        sink.read()
        t = parse_targets(_cell(r, index))
        if not t.ids:
            sink.skip("invalid_target" if t.invalid else "blank_row", i + 1)
        else:
            if t.invalid:
                sink.warn("invalid_target", i + 1)
            sink.add({}, t.ids)
    return sink.result("concept_ids")


# --- source_to_concept_map --------------------------------------------------------------------


def parse_stcm(table: Table) -> dict:
    h = table.headers
    cols = {"source_code": find_column(h, "source_code"), "target_concept_id": find_column(h, "target_concept_id")}
    _require(cols)
    concept_id = find_column(h, "source_concept_id")
    vocabulary = find_column(h, "source_vocabulary_id")
    description = find_column(h, "source_code_description")
    invalid = find_column(h, "invalid_reason")
    sink = RowSink()
    for i, r in enumerate(table.rows):
        sink.read()
        if text(_cell(r, invalid)) is not None:
            sink.skip("invalid_mapping", i + 1)
            continue
        source = {
            "sourceVocabularyId": text(_cell(r, vocabulary)),
            "sourceCode": text(_cell(r, cols["source_code"])),
            "sourceName": text(_cell(r, description)),
            "sourceConceptId": _source_id(_cell(r, concept_id)),
        }
        _add_or_blank(sink, source, _cell(r, cols["target_concept_id"]), i + 1)
    return sink.result("stcm")


# --- Usagi ------------------------------------------------------------------------------------


def parse_usagi(table: Table) -> dict:
    h = table.headers
    cols = {"sourceCode": find_column(h, "sourceCode"), "conceptId": find_column(h, "conceptId")}
    _require(cols)
    name = find_column(h, "sourceName")
    frequency = find_column(h, "sourceFrequency")
    mapping_status = find_column(h, "mappingStatus")
    equiv = find_column(h, "equivalence")
    sink = RowSink()
    for i, r in enumerate(table.rows):
        sink.read()
        source = {
            "sourceCode": text(_cell(r, cols["sourceCode"])),
            "sourceName": text(_cell(r, name)),
            "equivalence": equivalence(_cell(r, equiv)),
            "status": status(_cell(r, mapping_status)),
            "frequency": parse_frequency(_cell(r, frequency)),
        }
        _add_or_blank(sink, source, _cell(r, cols["conceptId"]), i + 1)
    return sink.result("usagi", ["approved"])


# --- CONCEPT + CONCEPT_RELATIONSHIP -------------------------------------------------------------

_MAPS_TO = {"maps to", "maps to value"}


def _table_kind(file: InputFile, table: Table) -> str | None:
    base = file.name.rsplit("/", 1)[-1]
    ext = extension_of(file.name)
    base = (base[: -len(ext)] if ext else base).lower()
    if base == "concept_relationship":
        return "relationship"
    if base == "concept":
        return "concept"
    if find_column(table.headers, "concept_id_1") >= 0 and find_column(table.headers, "concept_id_2") >= 0:
        return "relationship"
    if find_column(table.headers, "concept_id") >= 0 and find_column(table.headers, "concept_code") >= 0:
        return "concept"
    return None


def ccr_tables(files: list[InputFile], options: dict) -> tuple[Table | None, Table | None]:
    concept = relationship = None
    for f in files:
        if not is_tabular(f):
            continue
        table = read_table(f, {**options, "hasHeader": True, "skipRows": 0})
        kind = _table_kind(f, table)
        if kind == "concept" and concept is None:
            concept = table
        elif kind == "relationship" and relationship is None:
            relationship = table
    return concept, relationship


def parse_ccr(files: list[InputFile], options: dict) -> dict:
    concept, relationship = ccr_tables(files, options)
    if relationship is None:
        raise MappingImportError("missing_file", "CONCEPT_RELATIONSHIP")
    rh = relationship.headers
    rc = {
        "concept_id_1": find_column(rh, "concept_id_1"),
        "concept_id_2": find_column(rh, "concept_id_2"),
        "relationship_id": find_column(rh, "relationship_id"),
    }
    _require(rc)
    r_invalid = find_column(rh, "invalid_reason")
    sink = RowSink()

    sources: dict[int, dict] = {}
    order: list[int] = []
    if concept is not None:
        ch = concept.headers
        cc = {"concept_id": find_column(ch, "concept_id")}
        _require(cc)
        code = find_column(ch, "concept_code")
        vocabulary = find_column(ch, "vocabulary_id")
        name = find_column(ch, "concept_name")
        invalid = find_column(ch, "invalid_reason")
        for i, r in enumerate(concept.rows):
            sink.read()
            id_ = parse_id(_cell(r, cc["concept_id"]))
            if not id_ or text(_cell(r, invalid)) is not None:
                sink.skip("invalid_concept", i + 1)
                continue
            if id_ in sources:
                continue
            sources[id_] = {
                "sourceVocabularyId": text(_cell(r, vocabulary)),
                "sourceCode": text(_cell(r, code)),
                "sourceName": text(_cell(r, name)),
                "sourceConceptId": id_,
            }
            order.append(id_)

    targets: dict[int, list[int]] = {}
    for i, r in enumerate(relationship.rows):
        rel = clean(_cell(r, rc["relationship_id"]) or "").lower()
        if rel not in _MAPS_TO:
            continue
        from_ = parse_id(_cell(r, rc["concept_id_1"]))
        if concept is not None and (from_ is None or from_ not in sources):
            continue
        sink.read()
        if text(_cell(r, r_invalid)) is not None:
            sink.skip("invalid_mapping", i + 1)
            continue
        to = parse_id(_cell(r, rc["concept_id_2"]))
        if not from_ or not to:
            sink.skip("invalid_target", i + 1)
            continue
        lst = targets.get(from_)
        if lst is None:
            targets[from_] = [to]
            if concept is None:
                order.append(from_)
        elif to not in lst:
            lst.append(to)

    for id_ in order:
        sink.add(sources.get(id_) or {"sourceConceptId": id_}, targets.get(id_, []))
    return sink.result("ccr")


# --- SSSOM ---------------------------------------------------------------------------------------

_OMOP_PREFIXES = ("ohdsi", "omop", "athena")
_OMOP_BASES = ("https://athena.ohdsi.org/search-terms/terms/",)
_NESTED = re.compile(r"^[ \t]+([^:\s]+)[ \t]*:[ \t]*(.*)$")
_TOP = re.compile(r"^([^:\s]+)[ \t]*:[ \t]*(.*)$")
_IRI = re.compile(r"^https?://", re.IGNORECASE)


def _unquote(value: str) -> str:
    v = clean(value)
    if len(v) >= 2 and v[0] in "\"'" and v[-1] == v[0]:
        return v[1:-1]
    return v


def sssom_metadata(lines: list[str]) -> dict:
    curie_map: dict[str, str] = {}
    title = None
    in_curie_map = False
    for raw in lines:
        line = raw[1:] if raw.startswith("#") else raw
        nested = _NESTED.match(line)
        if in_curie_map and nested:
            curie_map[nested.group(1)] = _unquote(nested.group(2))
            continue
        in_curie_map = False
        top = _TOP.match(line)
        if not top:
            continue
        if top.group(1) == "curie_map":
            in_curie_map = clean(top.group(2)) == ""
        elif top.group(1) == "mapping_set_title":
            title = _unquote(top.group(2)) or None
    return {"curieMap": curie_map, "title": title}


def sssom_object(object_id: str, meta: dict) -> tuple[str, int | None]:
    """('id', n) | ('unmapped', None) | ('invalid', None) | ('foreign', None)."""
    value = clean(object_id)
    if value == "" or value.lower() == "sssom:notermfound":
        return "unmapped", None
    prefixes = set(_OMOP_PREFIXES)
    bases = list(_OMOP_BASES)
    for prefix, uri in meta["curieMap"].items():
        u = uri.lower()
        if "ohdsi" in u or "omop" in u:
            prefixes.add(prefix.lower())
            bases.append(uri)
    local = None
    if _IRI.match(value):
        base = next((b for b in bases if value.startswith(b)), None)
        if base is not None:
            local = value[len(base) :]
    else:
        colon = value.find(":")
        if colon > 0 and value[:colon].lower() in prefixes:
            local = value[colon + 1 :]
    if local is None:
        return "foreign", None
    id_ = parse_id(local)
    if id_ is None:
        return "invalid", None
    return ("unmapped", None) if id_ == 0 else ("id", id_)


def split_sssom(content: str) -> tuple[list[str], str]:
    lines = re.split(r"\r\n|\n|\r", content)
    n = 0
    while n < len(lines) and lines[n].startswith("#"):
        n += 1
    return lines[:n], "\n".join(lines[n:])


def parse_sssom(files: list[InputFile], options: dict) -> dict:
    f = first_tabular(files)
    metadata, body = split_sssom(decode(f.data, options.get("encoding") or "auto"))
    meta = sssom_metadata(metadata)
    table = table_from_cells(parse_delimited(body, "\t"), {})
    headers, rows = table.headers, table.rows
    cols = {"subject_id": find_column(headers, "subject_id"), "object_id": find_column(headers, "object_id")}
    _require(cols)
    label = find_column(headers, "subject_label")
    subject_source = find_column(headers, "subject_source")
    predicate = find_column(headers, "predicate_id")
    modifier = find_column(headers, "predicate_modifier")
    sink = RowSink()
    for i, r in enumerate(rows):
        sink.read()
        if clean(_cell(r, modifier) or "").lower() == "not":
            sink.skip("negated", i + 1)
            continue
        subject = clean(_cell(r, cols["subject_id"]) or "")
        colon = subject.find(":")
        curie = colon > 0 and not _IRI.match(subject)
        source = {
            "sourceVocabularyId": subject[:colon] if curie else text(_cell(r, subject_source)),
            "sourceCode": text(subject[colon + 1 :] if curie else subject),
            "sourceName": text(_cell(r, label)),
            "equivalence": text(_cell(r, predicate)),
        }
        kind, id_ = sssom_object(_cell(r, cols["object_id"]) or "", meta)
        if kind == "foreign":
            sink.skip("non_omop_object", i + 1)
        elif kind == "invalid":
            sink.skip("invalid_target", i + 1)
        elif kind == "unmapped" and not _has_source(source):
            sink.skip("blank_row", i + 1)
        else:
            sink.add(source, [id_] if kind == "id" else [])
    return sink.result("sssom", None, meta["title"])


# --- Linkr mapping project -----------------------------------------------------------------------


def _parse_json(f: InputFile) -> object:
    try:
        return json.loads(decode(f.data, "utf-8"))
    except ValueError:
        raise MappingImportError("invalid_json", f.name) from None


def _dir_of(name: str) -> str:
    i = name.rfind("/")
    return name[: i + 1] if i >= 0 else ""


def _localized_name(value: object) -> str | None:
    if isinstance(value, str):
        return text(value)
    if isinstance(value, dict):
        pick = value.get("en") if isinstance(value.get("en"), str) else None
        if pick is None:
            pick = next((v for v in value.values() if isinstance(v, str)), None)
        return text(pick) if isinstance(pick, str) else None
    return None


def parse_linkr(files: list[InputFile]) -> dict:
    jsons = sorted((f for f in files if extension_of(f.name) == ".json"), key=lambda f: f.name)
    lists: list[list] = []
    name = None
    for f in jsons:
        base = f.name.rsplit("/", 1)[-1]
        if base == "mappings.json":
            data = _parse_json(f)
            if not isinstance(data, list):
                raise MappingImportError("invalid_json", f.name)
            lists.append(data)
            entity = next((e for e in jsons if e.name == f"{_dir_of(f.name)}entity.json"), None)
            if entity is not None and name is None:
                e = _parse_json(entity)
                if isinstance(e, dict):
                    name = _localized_name(e.get("name"))
        elif base != "entity.json":
            data = _parse_json(f)
            if (
                isinstance(data, dict)
                and data.get("exportFormat") == "linkr-concept-mapping"
                and isinstance(data.get("mappings"), list)
            ):
                lists.append(data["mappings"])
                if name is None and isinstance(data.get("project"), dict):
                    name = _localized_name(data["project"].get("name"))
    if not lists:
        raise MappingImportError("missing_file", "mappings.json")
    sink = RowSink()
    n = 0
    for lst in lists:
        for m in lst:
            n += 1
            sink.read()
            if not isinstance(m, dict):
                sink.skip("invalid_mapping", n)
                continue
            source = {
                "sourceVocabularyId": text(m.get("sourceVocabularyId")),
                "sourceCode": text(m.get("sourceConceptCode")),
                "sourceName": text(m.get("sourceConceptName")),
                "sourceConceptId": _source_id(m.get("sourceConceptId")),
                "equivalence": equivalence(m.get("equivalence")),
                "status": status(m.get("status")),
                "frequency": parse_frequency(m.get("sourceFrequency")),
            }
            target = m.get("targetConceptId")
            if target is None or target == "":
                sink.add(source, [])
            else:
                ok = isinstance(target, (int, float, str)) and not isinstance(target, bool)
                sink.add_cell(source, target if ok else False, n)
    return sink.result("linkr", ["approved"], name)
