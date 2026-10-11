"""Drafts and their submission (docs/design/drafts-and-proposals.md)."""

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.v1.routes.git import git_error_response
from app.core.database import get_db
from app.core.deps import get_current_user
from app.core.permissions import user_permissions
from app.models.draft import Draft
from app.models.user import User
from app.schemas.draft import DraftCreate, DraftResponse, DraftSubmit, DraftUpdate
from app.services import drafts_service
from app.services.content_store import ContentStore, get_content_store
from app.services.git_service import ContentRepo, GitError, get_content_repo

router = APIRouter(prefix="/drafts", tags=["drafts"])


async def _own_draft(db: AsyncSession, user: User, draft_id: str) -> Draft:
    draft = await db.get(Draft, draft_id)
    # Someone else's draft reads as absent: ids are not to be probed.
    if draft is None or draft.user_id != user.id:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Draft not found")
    return draft


async def _require_may_draft(db: AsyncSession, user: User, kind: str) -> None:
    if not drafts_service.may_draft(kind, await user_permissions(db, user)):
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Insufficient permissions")


@router.get("", response_model=list[DraftResponse])
async def list_drafts(user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    rows = await db.scalars(select(Draft).where(Draft.user_id == user.id).order_by(Draft.updated_at.desc()))
    return list(rows)


@router.post("", response_model=DraftResponse, status_code=status.HTTP_201_CREATED)
async def create_draft(body: DraftCreate, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    await _require_may_draft(db, user, body.kind)
    draft = Draft(
        user_id=user.id,
        kind=body.kind,
        target_id=body.target_id,
        base_commit=body.base_commit,
        content=body.content,
    )
    db.add(draft)
    await db.commit()
    await db.refresh(draft)
    return draft


@router.get("/{draft_id}", response_model=DraftResponse)
async def get_draft(draft_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    return await _own_draft(db, user, draft_id)


@router.put("/{draft_id}", response_model=DraftResponse)
async def update_draft(
    draft_id: str,
    body: DraftUpdate,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    draft = await _own_draft(db, user, draft_id)
    await _require_may_draft(db, user, draft.kind)
    draft.content = body.content
    if "base_commit" in body.model_fields_set:
        draft.base_commit = body.base_commit
    await db.commit()
    await db.refresh(draft)
    return draft


@router.delete("/{draft_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_draft(draft_id: str, user: User = Depends(get_current_user), db: AsyncSession = Depends(get_db)):
    draft = await _own_draft(db, user, draft_id)
    await db.delete(draft)
    await db.commit()


@router.post("/{draft_id}/submit")
async def submit_draft(
    draft_id: str,
    body: DraftSubmit,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    repo: ContentRepo = Depends(get_content_repo),
    store: ContentStore = Depends(get_content_store),
):
    """→ `{mode, commitSha, headSha, targetId, conceptSetId?, indexCommitSha?,
    branch?, proposalUrl?, proposalError?}`. Errors: `detail = {code, message,
    …}` (403 forbidden / reviews_only, 404 target_not_found, 409 pull_required /
    base_changed / version_published / no_changes / dirty / diverged…, 422
    invalid_content with `errors: [{pointer, message}]`, 502 git or forge)."""
    draft = await _own_draft(db, user, draft_id)
    try:
        return await drafts_service.submit(
            db, draft=draft, user=user, mode=body.mode, message=body.message, repo=repo, store=store
        )
    except drafts_service.SubmitError as exc:
        return JSONResponse(status_code=exc.status, content={"detail": exc.detail()})
    except GitError as exc:
        return git_error_response(exc)
