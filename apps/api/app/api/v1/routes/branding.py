"""The instance's current logo and favicon, read from the content repository.

Public, like `/instance/config`: the login page shows the logo. The web app
of a server build is static and does not carry the content repo's images, so
it loads them from here; a branding commit shows up without a rebuild."""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from fastapi.concurrency import run_in_threadpool

from app.services import branding_assets
from app.services.content_store import ContentStore, get_content_store

router = APIRouter(prefix="/instance/branding", tags=["instance"])


@router.get("/{kind}")
async def branding_asset(kind: str, store: ContentStore = Depends(get_content_store)):
    if kind not in branding_assets.KINDS:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Unknown branding asset")
    catalogue = await run_in_threadpool(store.catalogue)
    path = branding_assets.resolve_asset_file(store.root, catalogue.config, kind)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"No {kind} configured")
    data = await run_in_threadpool(path.read_bytes)
    ext = branding_assets.sniff_type(data)
    if ext is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, f"The {kind} is not a supported image")
    return Response(
        content=data,
        media_type=branding_assets.CONTENT_TYPES[ext],
        headers={
            "Cache-Control": "no-cache",
            # An SVG opened directly must not run anything nor load anything.
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
            "X-Content-Type-Options": "nosniff",
        },
    )
