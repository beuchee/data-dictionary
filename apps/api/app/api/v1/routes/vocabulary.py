"""The OMOP vocabulary: ATHENA import and inventory (admin), concept queries
and expression resolution (readers). See services/vocabulary.py (library),
services/vocabulary_queries.py (SQL) and services/resolver.py (resolution).

Queries are sync routes: FastAPI runs them in its thread pool, each on its own
DuckDB cursor.
"""

import asyncio
import os
from typing import Annotated, Any, Literal

import duckdb
import structlog
from fastapi import APIRouter, Depends, HTTPException, Path, Query, Request, status
from fastapi.responses import Response
from pydantic import BaseModel, ConfigDict, Field
from starlette.requests import ClientDisconnect

from app.config import settings
from app.core.deps import require_permission, require_read
from app.core.json_response import json_response
from app.schemas.base import CamelModel
from app.services import resolver
from app.services import vocabulary as lib
from app.services import vocabulary_queries as q

logger = structlog.get_logger()

router = APIRouter(prefix="/vocabulary", tags=["vocabulary"])

_read = require_read("concept-sets:read")
_manage = require_permission("settings:manage")

ConceptId = Annotated[int, Path(ge=0, le=q.MAX_CONCEPT_ID)]
MODE: q.HierarchyMode = "closure"


def _unavailable() -> HTTPException:
    return HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No OMOP vocabulary has been imported")


def _rows(cursor, query: q.Query) -> list[dict[str, Any]]:
    sql, params = query
    cur = cursor.execute(sql, params)
    names = [d[0] for d in cur.description]
    return [dict(zip(names, r, strict=True)) for r in cur.fetchall()]


def _run(fn):
    """Run `fn(cursor)` against the library, mapping its failures to HTTP."""
    try:
        cursor = lib.get_library().cursor()
    except lib.VocabularyUnavailable:
        raise _unavailable() from None
    try:
        return fn(cursor)
    except q.QueryError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    except duckdb.Error as e:
        # A partition removed under a live connection, a corrupt file: rebuild next time.
        logger.error("vocabulary_query_failed", error=str(e))
        lib.get_library().invalidate()
        raise HTTPException(status.HTTP_500_INTERNAL_SERVER_ERROR, "Vocabulary query failed") from None
    finally:
        cursor.close()


# --- Reads ---------------------------------------------------------------------------


def _release() -> str | None:
    return next((v.get("release") for v in lib.read_inventory() if v.get("release")), None)


def _version(cursor) -> dict | None:
    def compute():
        version = resolver.read_vocabulary_version(cursor)
        # The release sits on the VOCABULARY row of the 'None' vocabulary, which an
        # import that left that vocabulary out does not hold: the inventory does.
        release = _release()
        if release and not (version or {}).get("release"):
            version = {**(version or {}), "release": release}
        return version

    return lib.get_library().cached("version", compute)


@router.get("/info")
def get_info(_user=Depends(_read)):
    """Whether a vocabulary is loaded, its release and vocabularies (no server
    details: readable by anyone who may read the dictionary)."""
    vocabularies = [
        {k: v.get(k) for k in ("vocabularyId", "vocabularyName", "vocabularyVersion", "conceptCount")}
        for v in lib.read_inventory()
    ]
    available = lib.get_library().available()
    return json_response({"available": available, "release": _release(), "vocabularies": vocabularies})


@router.get("/concepts/search")
def search_concepts(
    q_: str = Query("", alias="q", max_length=200),
    domain: list[str] = Query([], max_length=50),
    vocabulary: list[str] = Query([], max_length=50),
    concept_class: list[str] = Query([], alias="conceptClass", max_length=50),
    standard: list[Literal["S", "C", "N"]] = Query([]),
    valid_only: bool = Query(False, alias="validOnly"),
    limit: int = Query(50, ge=1, le=q.SEARCH_MAX_LIMIT),
    offset: int = Query(0, ge=0, le=2**31 - 1),
    _user=Depends(_read),
):
    """Ranked concept search (see vocabulary_queries.concept_search), with the
    total count of matches."""
    page_q, count_q = q.concept_search(
        q_,
        domain_ids=domain,
        vocabulary_ids=vocabulary,
        concept_class_ids=concept_class,
        standard=standard,
        valid_only=valid_only,
        limit=limit,
        offset=offset,
    )

    def run(cursor):
        total = int(_rows(cursor, count_q)[0]["total"])
        concepts = [q.concept_from_row(r) for r in _rows(cursor, page_q)]
        return {"total": total, "offset": offset, "limit": limit, "concepts": concepts}

    return json_response(_run(run))


@router.get("/filter-options")
def get_filter_options(_user=Depends(_read)):
    def run(cursor):
        def compute():
            return {
                key: [r["value"] for r in _rows(cursor, q.filter_options(col))]
                for key, col in (
                    ("domains", "domain_id"),
                    ("vocabularies", "vocabulary_id"),
                    ("conceptClasses", "concept_class_id"),
                )
            }

        return lib.get_library().cached("filter-options", compute)

    return json_response(_run(run))


@router.get("/concepts/{concept_id}")
def get_concept(concept_id: ConceptId, _user=Depends(_read)):
    rows = _run(lambda cursor: _rows(cursor, q.concept_by_id(concept_id)))
    if not rows:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Concept {concept_id} not found")
    return json_response(q.concept_from_row(rows[0]))


@router.get("/concepts/{concept_id}/related")
def get_related(concept_id: ConceptId, _user=Depends(_read)):
    """Valid relationships from the concept (`Maps to`, `Is a`, …), with the
    related concept."""
    rows = _run(lambda cursor: _rows(cursor, q.related_concepts(concept_id)))
    return json_response(
        [
            {
                "relationshipId": r["relationship_id"],
                "relationshipName": r["relationship_name"],
                **q.concept_from_row(r),
            }
            for r in rows
        ]
    )


@router.get("/concepts/{concept_id}/synonyms")
def get_synonyms(concept_id: ConceptId, _user=Depends(_read)):
    rows = _run(lambda cursor: _rows(cursor, q.synonyms(concept_id)))
    return json_response(
        [
            {
                "synonymName": r["concept_synonym_name"],
                "languageConceptId": r["language_concept_id"],
                "languageName": r["language_name"],
            }
            for r in rows
        ]
    )


@router.get("/concepts/{concept_id}/hierarchy")
def get_hierarchy(
    concept_id: ConceptId,
    max_depth: int = Query(5, alias="maxDepth", ge=1, le=q.HIERARCHY_MAX_DEPTH),
    limit: int = Query(150, ge=1, le=q.HIERARCHY_MAX_NODES),
    _user=Depends(_read),
):
    """The concept's ancestors (negative `hierarchyLevel`) and descendants
    (positive), nearest first, with the direct edges between them. `truncated`
    when more than `limit` nodes were within `maxDepth`."""

    def run(cursor):
        rows = _rows(cursor, q.hierarchy_nodes(concept_id, MODE, max_depth, limit + 1))
        if not any(int(r["concept_id"]) == concept_id for r in rows):
            return None
        truncated = len(rows) > limit
        rows = rows[:limit]
        nodes = [{**q.concept_from_row(r), "hierarchyLevel": int(r["hierarchy_level"])} for r in rows]
        edges = [
            {"fromId": int(e["from_id"]), "toId": int(e["to_id"])}
            for e in _rows(cursor, q.hierarchy_edges(n["conceptId"] for n in nodes))
        ]
        return {"conceptId": concept_id, "nodes": nodes, "edges": edges, "truncated": truncated}

    result = _run(run)
    if result is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Concept {concept_id} not found")
    return json_response(result)


# --- Resolution ----------------------------------------------------------------------------

StrictConceptId = Annotated[int, Field(strict=True, ge=0, le=q.MAX_CONCEPT_ID)]


class ResolveConcept(BaseModel):
    # Other fields (conceptName, vocabularyId…) are kept: a custom concept takes
    # its details from them.
    model_config = ConfigDict(extra="allow")
    conceptId: StrictConceptId  # noqa: N815 — the content files' field name


class ResolveItem(BaseModel):
    model_config = ConfigDict(extra="allow")
    concept: ResolveConcept
    isExcluded: bool = False  # noqa: N815
    includeDescendants: bool = False  # noqa: N815
    includeMapped: bool = False  # noqa: N815


class ResolveExpression(BaseModel):
    model_config = ConfigDict(extra="allow")
    items: list[ResolveItem] = Field(default_factory=list, max_length=50_000)


class ResolveRequest(BaseModel):
    conceptSetId: StrictConceptId | None = None  # noqa: N815
    expression: ResolveExpression


@router.post("/resolve")
def resolve_expression(body: ResolveRequest, _user=Depends(_read)):
    """An expression → `{conceptSetId, vocabularyVersion, resolvedConcepts}`,
    the shape of concept_sets_resolved/{id}.json (resolve.py's algorithm)."""
    items = [i.model_dump() for i in body.expression.items]

    def run(cursor):
        concepts = resolver.resolve_items(cursor, items, MODE)
        version = resolver.stamp_version(_version(cursor), concepts)
        return {"conceptSetId": body.conceptSetId, "vocabularyVersion": version, "resolvedConcepts": concepts}

    return json_response(_run(run))


# --- Expression editing (web: features/concept-sets/lib/optimize.ts) ------------------------

IdList = Annotated[list[StrictConceptId], Field(max_length=10_000)]


class IdsRequest(BaseModel):
    ids: IdList


class DescendantPairsRequest(BaseModel):
    ancestorIds: Annotated[list[StrictConceptId], Field(max_length=1_000)]  # noqa: N815
    withinIds: IdList | None = None  # noqa: N815


class AncestorCandidatesRequest(BaseModel):
    ids: IdList
    maxDepth: int = Field(5, ge=1, le=q.ANCESTOR_CANDIDATE_MAX_DEPTH)  # noqa: N815
    limit: int = Field(30, ge=1, le=q.ANCESTOR_CANDIDATE_MAX_LIMIT)


@router.post("/concepts/batch")
def get_concepts(body: IdsRequest, _user=Depends(_read)):
    """Full rows of the concepts the vocabulary holds among `ids`, by id."""
    if not body.ids:
        return json_response([])
    rows = _run(lambda cursor: _rows(cursor, q.concepts_by_ids(body.ids)))
    return json_response([q.concept_from_row(r) for r in rows])


@router.post("/descendant-pairs")
def get_descendant_pairs(body: DescendantPairsRequest, _user=Depends(_read)):
    """`[{ancestorId, descendantId}]`: every descendant of each ancestor (never
    itself), kept to `withinIds` when given."""
    if not body.ancestorIds or (body.withinIds is not None and not body.withinIds):
        return json_response([])
    rows = _run(lambda cursor: _rows(cursor, q.descendant_pairs(body.ancestorIds, MODE, body.withinIds)))
    return json_response([{"ancestorId": int(r["ancestor_id"]), "descendantId": int(r["descendant_id"])} for r in rows])


@router.post("/mapped-ids")
def get_mapped_ids(body: IdsRequest, _user=Depends(_read)):
    """What `ids` map to or from (`Maps to` / `Mapped from`)."""
    if not body.ids:
        return json_response([])
    rows = _run(lambda cursor: _rows(cursor, q.mapped_ids(body.ids)))
    return json_response(sorted(int(r["concept_id"]) for r in rows))


@router.post("/ancestor-candidates")
def get_ancestor_candidates(body: AncestorCandidatesRequest, _user=Depends(_read)):
    """Valid ancestors shared by at least two of `ids`, with `coveredCount` and
    `minDepth`, most covering first."""
    if not body.ids:
        return json_response([])
    rows = _run(lambda cursor: _rows(cursor, q.ancestor_candidates(body.ids, MODE, body.maxDepth, body.limit)))
    return json_response(
        [
            {**q.concept_from_row(r), "coveredCount": int(r["covered_count"]), "minDepth": int(r["min_depth"])}
            for r in rows
        ]
    )


# --- Administration ---------------------------------------------------------------------------


class ExportSource(CamelModel):
    """Where an ATHENA export is: uploaded files, or a server folder under
    DD_VOCABULARY_IMPORT_ROOTS."""

    upload_id: str | None = Field(None, max_length=64)
    server_path: str | None = Field(None, max_length=4096)


class ImportRequest(CamelModel):
    source: ExportSource
    # None: every vocabulary of the export.
    vocabularies: list[str] | None = Field(None, max_length=1000)


def _export_files(source: ExportSource) -> lib.ExportFiles:
    try:
        if source.upload_id:
            files = lib.upload_files(source.upload_id)
        elif source.server_path:
            files = lib.server_folder_files(source.server_path)
        else:
            raise lib.SourceError("No source")
    except lib.SourceError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    if not files:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "No ATHENA vocabulary file found")
    return files


async def _inspect(files: lib.ExportFiles) -> dict:
    try:
        return await asyncio.to_thread(lib.inspect_export, files)
    except (ValueError, duckdb.Error) as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"Unreadable export: {e}") from None


@router.get("/status")
def get_status(_user=Depends(_manage)):
    """The library in full: vocabularies with their size on disk, rows per
    table, running imports, and where imports may come from."""
    inventory = lib.read_inventory()
    return json_response(
        {
            "available": lib.get_library().available(),
            "release": _release(),
            "vocabularies": [{**v, "sizeBytes": lib.library_size(v["vocabularyId"])} for v in inventory],
            "rowCounts": lib.row_counts(),
            "busy": lib.is_busy(),
            "jobs": [s.as_dict() for s in lib.import_states()],
            "importRoots": [str(p) for p in settings.vocabulary_import_root_list],
        }
    )


@router.post("/uploads")
def create_upload(_user=Depends(_manage)):
    """A folder for the files of one export; send each with `PUT …/files/{name}`."""
    return {"uploadId": lib.new_upload()}


@router.put("/uploads/{upload_id}/files/{file_name}")
async def upload_file(upload_id: str, file_name: str, request: Request, _user=Depends(_manage)):
    """The raw bytes of one ATHENA file (`CONCEPT.csv`, `concept.parquet`…),
    streamed to disk."""
    try:
        target = lib.upload_file_path(upload_id, file_name)
    except lib.SourceError as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    partial = target.with_name(f".{target.name}.part")
    size = 0
    try:
        with open(partial, "wb") as fh:
            async for chunk in request.stream():
                fh.write(chunk)
                size += len(chunk)
        os.replace(partial, target)
    except ClientDisconnect:
        partial.unlink(missing_ok=True)
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "Upload interrupted") from None
    except BaseException:
        partial.unlink(missing_ok=True)
        raise
    return {"fileName": file_name, "size": size}


@router.delete("/uploads/{upload_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_upload(upload_id: str, _user=Depends(_manage)):
    lib.discard_upload(upload_id)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/inspect")
async def inspect_export(source: ExportSource, _user=Depends(_manage)):
    """The vocabularies an export holds, each with the version the library has
    of it (null when absent), to preview the import."""
    found = await _inspect(_export_files(source))
    held = {v["vocabularyId"]: v for v in lib.read_inventory()}
    for v in found["vocabularies"]:
        v["libraryVersion"] = held.get(v["vocabularyId"], {}).get("vocabularyVersion")
        v["inLibrary"] = v["vocabularyId"] in held
    return found


@router.post("/import")
async def start_import(body: ImportRequest, _user=Depends(_manage)):
    """Write the chosen vocabularies (all by default) into the library, in the
    background; poll `GET /vocabulary/jobs/{id}`. Replaces the vocabularies
    already held. An uploaded export is deleted once the import ends."""
    files = _export_files(body.source)
    found = await _inspect(files)
    available = [v["vocabularyId"] for v in found["vocabularies"]]
    chosen = available if body.vocabularies is None else [v for v in body.vocabularies if v in available]
    if not chosen:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "None of these vocabularies is in the export")
    missing = [t for t in lib.REQUIRED_TABLES if t not in found["tables"]]
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"The export lacks required tables: {', '.join(missing)}")
    source = body.source
    label = source.server_path or "upload"

    async def run(state: lib.ImportState) -> None:
        try:
            written = await asyncio.to_thread(lib.write_partitions, files, chosen, state)
            lib.record_import(found, written, label)
            state.vocabularies = written
        finally:
            lib.get_library().invalidate()
            if source.upload_id:
                lib.discard_upload(source.upload_id)

    return lib.start_import(run).as_dict()


@router.get("/jobs")
def list_jobs(_user=Depends(_manage)):
    return [s.as_dict() for s in lib.import_states()]


@router.get("/jobs/{job_id}")
def get_job(job_id: str, _user=Depends(_manage)):
    state = lib.import_state(job_id)
    if state is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Import not found")
    return state.as_dict()


def _refuse_if_busy() -> None:
    # An import rewrites the inventory it read before writing its partitions: a
    # removal in between would be overwritten. Waiting would hold the request
    # open for as long as the import runs (minutes).
    if lib.is_busy():
        raise HTTPException(status.HTTP_409_CONFLICT, "A vocabulary import is running; retry when it ends")


@router.delete("/vocabularies/{vocabulary_id}", status_code=status.HTTP_204_NO_CONTENT)
async def remove_vocabulary(vocabulary_id: str = Path(max_length=100), _user=Depends(_manage)):
    _refuse_if_busy()
    async with lib.write_lock():
        lib.get_library().invalidate()
        await asyncio.to_thread(lib.remove_partitions, vocabulary_id)
        lib.forget_vocabulary(vocabulary_id)
        lib.get_library().invalidate()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def remove_library(_user=Depends(_manage)):
    """Every vocabulary, the shared tables and the inventory."""
    _refuse_if_busy()
    async with lib.write_lock():
        lib.get_library().invalidate()
        await asyncio.to_thread(lib.remove_library)
        lib.get_library().invalidate()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
