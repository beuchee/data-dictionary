from fastapi import APIRouter, Depends

from app.core.deps import require_read
from app.core.json_response import json_response
from app.services.content_store import ContentStore, get_content_store

router = APIRouter(prefix="/mapping-recommendations", tags=["mapping-recommendations"])


@router.get("")
def mapping_recommendations(
    _user=Depends(require_read("mappings:read")),
    store: ContentStore = Depends(get_content_store),
):
    """`{translations: {<lang>: {content}}}`, or null when the instance has none."""
    return json_response(store.catalogue().mapping_recommendations)
