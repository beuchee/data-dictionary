from fastapi import APIRouter, Depends

from app.config import settings
from app.core.json_response import json_response
from app.services import oauth_service
from app.services.content_store import ContentStore, get_content_store

router = APIRouter(prefix="/instance", tags=["instance"])


@router.get("/config")
def instance_config(store: ContentStore = Depends(get_content_store)):
    """Public: the instance's config.json and what this server offers, so the web
    app can brand itself and pick its login screen before anyone signs in."""
    catalogue = store.catalogue()
    return json_response(
        {
            "config": catalogue.config,
            "server": {
                "appVersion": settings.app_version,
                # "local", then the enabled OAuth providers (github, gitlab, orcid).
                "authProviders": ["local", *oauth_service.enabled_providers()],
                "anonymousRead": catalogue.anonymous_read,
                "versionHistory": store.history_available(),
                "passwordMinLength": settings.password_min_length,
            },
        }
    )
