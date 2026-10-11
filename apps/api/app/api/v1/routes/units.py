from fastapi import APIRouter, Depends

from app.core.deps import require_read
from app.core.json_response import json_response
from app.services.content_store import ContentStore, get_content_store

router = APIRouter(prefix="/units", tags=["units"])

# Units belong to the concept sets they describe: same read permission.
_read = require_read("concept-sets:read")


@router.get("/recommended")
def recommended_units(_user=Depends(_read), store: ContentStore = Depends(get_content_store)):
    return json_response(store.catalogue().recommended_units)


@router.get("/conversions")
def unit_conversions(_user=Depends(_read), store: ContentStore = Depends(get_content_store)):
    """Conversion factors; number lexemes such as `1.0` are kept."""
    return json_response(store.catalogue().unit_conversions)
