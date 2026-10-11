"""The content repository: status and pull (docs/design/drafts-and-proposals.md)."""

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import JSONResponse

from app.core.deps import get_current_user, require_permission
from app.models.user import User
from app.services import versioning
from app.services.content_store import ContentStore, get_content_store
from app.services.drafts_service import GIT_ERROR_STATUS
from app.services.git_service import Author, ContentRepo, GitError, get_content_repo, git_env

router = APIRouter(prefix="/git", tags=["git"])
logger = structlog.get_logger()


def git_error_response(exc: GitError) -> JSONResponse:
    return JSONResponse(
        status_code=GIT_ERROR_STATUS.get(exc.code, 502),
        content={"detail": {"code": exc.code, "message": str(exc)}},
    )


@router.get("/status")
async def git_status(
    fetch: bool = Query(False, description="Fetch the remote first, so ahead / behind are current"),
    _user: User = Depends(get_current_user),
    repo: ContentRepo = Depends(get_content_repo),
):
    """`{branch, contentBranch, head, remote, remoteHead, ahead, behind, dirty}`;
    ahead / behind are null before the first fetch."""

    def work() -> dict:
        if fetch and repo.is_repo() and repo.remote_url():
            repo.fetch()
        return repo.status()

    try:
        return await repo.run(work)
    except GitError as exc:
        return git_error_response(exc)


def _pull_and_index(repo: ContentRepo) -> dict:
    """Fast-forward, then index the versions the pulled commits introduced
    (additive backfill), committed and pushed as one more commit."""
    result = repo.pull()
    backfill = versioning.backfill(repo.path, env=git_env(), write=False)
    result["indexed"] = [{"id": key, "version": version, "commit": sha} for key, version, sha, _ in backfill.added]
    result["indexCommitSha"] = None
    if backfill.added:
        index = versioning.load_index(repo.path)
        for key, version, sha, _ in backfill.added:
            versioning.record(index, key, version, sha)
        head = repo.rev("HEAD")
        sha = repo.commit_files(
            head,
            {versioning.INDEX_FILE: versioning.index_bytes(index)},
            f"Index {len(backfill.added)} concept set version(s) merged since the last pull\n",
            Author(repo.committer.name, repo.committer.email),
        )
        try:
            if repo.remote_url():
                repo.push(sha, repo.branch, repo.token)
        except GitError as exc:
            # Not committed locally either: the working copy stays a plain
            # fast-forward of the remote, and the next pull retries.
            logger.warning("version_index_push_failed", code=exc.code)
            result["indexError"] = {"code": exc.code, "message": str(exc)}
            return result
        repo.fast_forward(sha)
        result["indexCommitSha"] = sha
        result["head"] = sha
    return result


@router.post("/pull")
async def git_pull(
    _user: User = Depends(require_permission("concept-sets:commit")),
    repo: ContentRepo = Depends(get_content_repo),
    store: ContentStore = Depends(get_content_store),
):
    """Maintainer: fetch + fast-forward the content working copy (409 `diverged`
    / `dirty` / `wrong_branch` otherwise), then the additive version backfill.
    → `{before, head, updated, indexed: [{id, version, commit}], indexCommitSha}`."""
    try:
        result = await repo.run(_pull_and_index, repo)
    except GitError as exc:
        return git_error_response(exc)
    except versioning.VersioningError as exc:
        raise HTTPException(500, {"code": "versioning_failed", "message": str(exc)}) from None
    store.invalidate()
    return result
