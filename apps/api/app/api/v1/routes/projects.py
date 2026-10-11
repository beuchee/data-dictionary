from fastapi import APIRouter, Depends, HTTPException, Path, status

from app.core.deps import require_read
from app.core.json_response import json_response
from app.services.content_store import ContentStore, get_content_store

router = APIRouter(prefix="/projects", tags=["projects"])

_read = require_read("projects:read")


@router.get("")
def list_projects(_user=Depends(_read), store: ContentStore = Depends(get_content_store)):
    """Every project, whole (they are small), ordered by id."""
    return json_response(list(store.catalogue().projects.values()))


@router.get("/{project_id}")
def get_project(
    project_id: int = Path(..., ge=1),
    _user=Depends(_read),
    store: ContentStore = Depends(get_content_store),
):
    project = store.catalogue().projects.get(project_id)
    if project is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"Project {project_id} not found")
    return json_response(project)
