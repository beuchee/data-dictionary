import asyncio
from contextlib import asynccontextmanager

import structlog
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy.exc import IntegrityError
from starlette.middleware.base import BaseHTTPMiddleware

from app.api.v1.routes.auth import router as auth_router
from app.api.v1.routes.concept_sets import router as concept_sets_router
from app.api.v1.routes.drafts import router as drafts_router
from app.api.v1.routes.git import router as git_router
from app.api.v1.routes.health import router as health_router
from app.api.v1.routes.instance import router as instance_router
from app.api.v1.routes.mapping_recommendations import router as mapping_recommendations_router
from app.api.v1.routes.oauth import router as oauth_router
from app.api.v1.routes.projects import router as projects_router
from app.api.v1.routes.setup import router as setup_router
from app.api.v1.routes.units import router as units_router
from app.config import INSECURE_SECRET_KEY, settings
from app.core.database import async_session
from app.core.logging import setup_logging
from app.core.migrations import run_migrations
from app.core.permissions import seed_default_roles
from app.core.security_headers import SecurityHeadersMiddleware
from app.services import git_service
from app.services.content_store import ContentError

logger = structlog.get_logger()


def check_production_settings() -> None:
    """Refuse to boot on settings that are only safe on a developer's machine."""
    # The secret signs every JWT: the shipped default would let anyone forge an admin token.
    if settings.secret_key == INSECURE_SECRET_KEY and not settings.debug:
        raise RuntimeError(
            "DD_SECRET_KEY is still the insecure default. Set a strong secret "
            "(python3 -c 'import secrets; print(secrets.token_urlsafe(48))') "
            "or run with DD_DEBUG=true for local development."
        )
    # RFC 7518 3.2: an HS256 key shorter than the hash output weakens the signature.
    if len(settings.secret_key.encode()) < 32 and not settings.debug:
        raise RuntimeError("DD_SECRET_KEY must be at least 32 bytes long.")
    # A wildcard origin with allow_credentials=True (below) would let any site
    # make credentialed requests to the API.
    if "*" in settings.cors_origin_list:
        if not settings.debug:
            raise RuntimeError(
                "DD_CORS_ORIGINS contains '*' while credentials are allowed. List explicit "
                "origins in production, or run with DD_DEBUG=true for local development."
            )
        logger.warning("cors_wildcard_with_credentials", origins=settings.cors_origin_list)


@asynccontextmanager
async def lifespan(app: FastAPI):
    setup_logging(debug=settings.debug)
    check_production_settings()
    logger.info("starting_data_dictionary", version=settings.app_version)
    # In a worker thread: Alembic's async env.py calls asyncio.run(), which
    # cannot run inside the lifespan's already-running event loop.
    await asyncio.to_thread(run_migrations)
    async with async_session() as db:
        await seed_default_roles(db)
    # The content repository: cloned on first start when DD_CONTENT_REPO_URL is set.
    try:
        await asyncio.to_thread(git_service.ensure_clone)
    except git_service.GitError as exc:
        logger.error("content_repo_clone_failed", code=exc.code, error=str(exc))
    yield
    logger.info("shutting_down_data_dictionary")


app = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)


class _ErrorLoggingMiddleware(BaseHTTPMiddleware):
    """Turn unhandled exceptions into a real JSON response.

    Without it, the error propagates past the CORS middleware and the browser
    reports a misleading "CORS header missing" instead of the actual error.
    """

    async def dispatch(self, request: Request, call_next):
        try:
            return await call_next(request)
        except IntegrityError:
            # A unique/FK violation is a client-side conflict, not a server fault.
            logger.warning("integrity_conflict", path=request.url.path)
            return JSONResponse(
                status_code=409,
                content={"detail": "Resource already exists or violates a constraint"},
            )
        except Exception:
            logger.exception("unhandled_error", path=request.url.path)
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.exception_handler(ContentError)
async def _content_unavailable(request: Request, exc: ContentError):
    logger.error("content_unavailable", path=request.url.path, error=str(exc))
    return JSONResponse(status_code=503, content={"detail": "The content repository is unavailable"})


app.add_middleware(_ErrorLoggingMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SecurityHeadersMiddleware)

app.include_router(health_router, prefix="/api/v1")
app.include_router(setup_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(instance_router, prefix="/api/v1")
app.include_router(concept_sets_router, prefix="/api/v1")
app.include_router(projects_router, prefix="/api/v1")
app.include_router(units_router, prefix="/api/v1")
app.include_router(mapping_recommendations_router, prefix="/api/v1")
app.include_router(oauth_router, prefix="/api/v1")
app.include_router(git_router, prefix="/api/v1")
app.include_router(drafts_router, prefix="/api/v1")
