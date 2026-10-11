from fastapi import APIRouter, Depends, HTTPException, Path, Query, status

from app.core.deps import require_read
from app.core.json_response import json_response
from app.services.content_store import ContentStore, filter_resolved, get_content_store, version_history

router = APIRouter(prefix="/concept-sets", tags=["concept-sets"])

_read = require_read("concept-sets:read")

CsId = Path(..., ge=1, le=2_000_000_000)
# Only ever a key into concept_sets_versions.json, never handed to git as is.
Version = Query(None, min_length=1, max_length=64, pattern=r"^[0-9A-Za-z][0-9A-Za-z.+-]*$")


def _not_found(cs_id: int, version: str | None) -> HTTPException:
    what = f"Concept set {cs_id}" + (f" version {version}" if version else "")
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


@router.get("")
def list_concept_sets(_user=Depends(_read), store: ContentStore = Depends(get_content_store)):
    """One summary per concept set (current version), ordered by id."""
    return json_response(store.catalogue().summaries)


@router.get("/{cs_id}")
def get_concept_set(
    cs_id: int = CsId,
    version: str | None = Version,
    _user=Depends(_read),
    store: ContentStore = Depends(get_content_store),
):
    """The full concept set, current or at a past `version`."""
    cs = store.concept_set(cs_id, version)
    if cs is None:
        raise _not_found(cs_id, version)
    return json_response(cs)


@router.get("/{cs_id}/resolved")
def get_resolved(
    cs_id: int = CsId,
    version: str | None = Version,
    search: str | None = Query(None, max_length=200),
    offset: int = Query(0, ge=0),
    limit: int | None = Query(None, ge=1, le=100_000),
    _user=Depends(_read),
    store: ContentStore = Depends(get_content_store),
):
    """The resolved concepts of a concept set (current or past `version`). Without
    `limit` the whole list; `search` filters on id, name, code and vocabulary
    before `offset`/`limit` apply, and `total` counts the filtered list."""
    resolved = store.resolved_at(cs_id, version)
    if resolved is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No resolved list for concept set {cs_id}")
    concepts = filter_resolved(resolved.get("resolvedConcepts") or [], search)
    page = concepts[offset : offset + limit] if limit is not None else concepts[offset:]
    current = store.catalogue().concept_sets.get(cs_id)
    return json_response(
        {
            "conceptSetId": cs_id,
            "version": version or (current or {}).get("version"),
            "vocabularyVersion": resolved.get("vocabularyVersion"),
            "total": len(concepts),
            "offset": offset,
            "limit": limit,
            "resolvedConcepts": page,
        }
    )


@router.get("/{cs_id}/versions")
def get_versions(cs_id: int = CsId, _user=Depends(_read), store: ContentStore = Depends(get_content_store)):
    """Every known version, newest first; `commit` is null for one never snapshotted
    (it cannot be fetched)."""
    catalogue = store.catalogue()
    current = catalogue.concept_sets.get(cs_id)
    indexed = catalogue.versions_index.get(str(cs_id))
    if current is None and not indexed:
        raise _not_found(cs_id, None)
    return json_response(
        {
            "id": cs_id,
            "currentVersion": (current or {}).get("version"),
            "versions": version_history(current, indexed),
        }
    )
