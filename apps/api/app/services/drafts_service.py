"""Submitting a draft: a proposal (branch + pull / merge request) or a commit
on the content branch. The contract: docs/design/drafts-and-proposals.md.

Everything that touches git happens under the content repository's lock, in a
worker thread, on top of the freshly fetched remote head:

1. base = remote head (`ContentRepo.base_for_write`); a direct commit also needs
   the working copy exactly there (`pull_required`), on the content branch, clean.
2. the file at base (404 when an edited target is gone); a draft started from an
   older commit whose file has changed since → 409 `base_changed`.
3. permission checks that depend on the diff (reviews-only rule).
4. id allocation for a new concept set / project from `id_counters.json`, bumped
   in the same commit.
5. provenance stamping (services/provenance.py), validation (422), canonical
   bytes (`dictionary_format.serialize`), numbers the browser rounded put back.
6. commit(s) built off-tree, push, then the working copy fast-forwards (direct
   commits). A direct commit that changes a concept set's version gets a second
   commit indexing (id, version) → first commit (the two-commit flow, automated).
"""

from __future__ import annotations

import asyncio
import datetime
import re
from dataclasses import dataclass, field
from typing import Any

import structlog
from dictionary_format import parse, serialize_bytes, validate
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.permissions import user_permissions
from app.models.draft import Draft
from app.models.user import User
from app.services import branding_assets, forge, git_credential_service, oauth_service, versioning
from app.services.content_store import ContentStore
from app.services.git_service import Author, ContentRepo, GitError, strip_credentials
from app.services.provenance import (
    Instance,
    Submitter,
    only_reviews_appended,
    preserve_numbers,
    stamp_concept_set,
    stamp_project,
    tool_tag,
)

logger = structlog.get_logger()

ID_COUNTERS = "id_counters.json"


@dataclass(frozen=True)
class KindSpec:
    format_kind: str
    # For one file per id: its directory. Else the single file's path.
    directory: str | None = None
    path: str | None = None
    propose: str = ""
    commit: tuple[str, ...] = ()
    counter: str | None = None
    label: str = ""

    def file_path(self, target_id: int | None) -> str:
        return f"{self.directory}/{int(target_id)}.json" if self.directory else self.path  # type: ignore[return-value]


# Committing a single-file kind takes its write permission plus a commit
# permission: by default only maintainers hold both.
KINDS: dict[str, KindSpec] = {
    "concept-set": KindSpec(
        "concept-set",
        directory="concept_sets",
        propose="concept-sets:propose",
        commit=("concept-sets:commit",),
        counter="nextConceptSetId",
        label="concept set",
    ),
    "project": KindSpec(
        "project",
        directory="projects",
        propose="projects:propose",
        commit=("projects:commit",),
        counter="nextProjectId",
        label="project",
    ),
    "recommended-units": KindSpec(
        "recommended-units",
        path="units/recommended_units.json",
        propose="units:write",
        commit=("units:write", "concept-sets:commit"),
        label="recommended units",
    ),
    "unit-conversions": KindSpec(
        "unit-conversions",
        path="units/unit_conversions.json",
        propose="units:write",
        commit=("units:write", "concept-sets:commit"),
        label="unit conversions",
    ),
    "mapping-recommendations": KindSpec(
        "mapping-recommendations",
        path="mapping_recommendations/mapping_recommendations.json",
        propose="mappings:write",
        commit=("mappings:write", "concept-sets:commit"),
        label="mapping recommendations",
    ),
    "config": KindSpec(
        "config",
        path="config.json",
        propose="branding:write",
        commit=("branding:write", "concept-sets:commit"),
        label="configuration",
    ),
}

ID_KINDS = ("concept-set", "project")


class SubmitError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def detail(self) -> dict:
        return {"code": self.code, "message": self.message, **self.extra}


# HTTP status of each GitError code.
GIT_ERROR_STATUS = {
    "pull_required": 409,
    "diverged": 409,
    "dirty": 409,
    "wrong_branch": 409,
    "no_remote": 409,
    "not_a_repo": 409,
    "invalid_ref": 422,
    "auth_failed": 502,
    "auth_required": 502,
    "not_found": 502,
    "network": 502,
    "unknown": 502,
}


def may_draft(kind: str, permissions: list[str]) -> bool:
    """Whether a user may keep a draft of `kind` at all."""
    spec = KINDS[kind]
    return spec.propose in permissions or (kind == "concept-set" and "reviews:write" in permissions)


def submitter_of(user: User) -> Submitter:
    return Submitter(
        username=user.username,
        first_name=user.first_name,
        last_name=user.last_name,
        affiliation=user.affiliation,
        profession=user.profession,
        orcid=user.orcid,
        email=user.email,
    )


def _slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_-]+", "-", value).strip("-").lower() or "user"


def _parse_bytes(raw: bytes | None) -> Any:
    if raw is None:
        return None
    try:
        return parse(raw)
    except ValueError:
        return None


@dataclass
class _Plan:
    """What the git thread prepared: the commits, ready to push."""

    base: str
    commit_sha: str
    head_sha: str
    target_id: int | None
    title: str
    body: str
    files: dict[str, bytes | None] = field(default_factory=dict)
    index_sha: str | None = None


def _default_message(spec: KindSpec, kind: str, target_id: int | None, content: Any, is_new: bool) -> str:
    if kind in ID_KINDS:
        name = None
        if isinstance(content, dict):
            t = (
                content.get("metadata", {}).get("translations")
                if kind == "concept-set"
                else content.get("translations")
            )
            en = t.get("en") if isinstance(t, dict) else None
            name = en.get("name") if isinstance(en, dict) else None
        verb = "Add" if is_new else "Update"
        version = content.get("version") if kind == "concept-set" and isinstance(content, dict) else None
        suffix = f" v{version}" if version else ""
        return f"{verb} {spec.label} {target_id}{f': {name}' if name else ''}{suffix}"
    return f"Update {spec.label}"


def _trailer(submitter: Submitter) -> str:
    if submitter.email:
        return f"Co-authored-by: {submitter.display_name} <{submitter.email}>"
    return f"Submitted-by: {submitter.display_name} (@{submitter.username})"


def _prepare(
    repo: ContentRepo,
    *,
    draft: Draft,
    mode: str,
    message: str | None,
    submitter: Submitter,
    reviews_only: bool,
    instance_config: dict,
    author: Author,
    trailer: str | None,
) -> _Plan:
    """Blocking: everything up to the commits (no push)."""
    spec = KINDS[draft.kind]
    base = repo.base_for_write(direct=mode == "commit")
    is_new = draft.kind in ID_KINDS and draft.target_id is None
    files: dict[str, bytes | None] = {}

    target_id = draft.target_id
    base_doc = None
    if draft.kind in ID_KINDS and not is_new:
        raw = repo.show(base, spec.file_path(target_id))
        if raw is None:
            raise SubmitError(404, "target_not_found", f"{spec.label} {target_id} does not exist in the repository")
        base_doc = _parse_bytes(raw)
    elif draft.kind not in ID_KINDS:
        base_doc = _parse_bytes(repo.show(base, spec.file_path(None)))

    # A draft started from an older commit must not silently revert what
    # changed in its file since.
    if not is_new and draft.base_commit and draft.base_commit != base and repo.has_commit(draft.base_commit):
        path = spec.file_path(target_id)
        if repo.show(draft.base_commit, path) != repo.show(base, path):
            raise SubmitError(
                409,
                "base_changed",
                f"{path} changed in the repository since this draft was started; reapply your edit on the "
                "current version",
                baseCommit=draft.base_commit,
                head=base,
            )

    if reviews_only and not only_reviews_appended(base_doc or {}, draft.content):
        raise SubmitError(
            403,
            "reviews_only",
            "Your role may only add reviews: this draft changes more than metadata.reviews",
        )

    content = draft.content
    if not isinstance(content, (dict, list)):
        raise SubmitError(422, "invalid_content", "The draft content is not a JSON object or array", errors=[])
    if base_doc is not None:
        content = preserve_numbers(content, base_doc)
    content = _copy(content)

    if is_new:
        counters = _parse_bytes(repo.show(base, ID_COUNTERS))
        counters = counters if isinstance(counters, dict) else {}
        existing = [
            int(name[:-5])
            for name in repo.list_dir(base, spec.directory or "")
            if re.fullmatch(r"[1-9][0-9]*\.json", name)
        ]
        counter = counters.get(spec.counter)
        target_id = max(counter if isinstance(counter, int) else 1, max(existing, default=0) + 1)
        counters[spec.counter] = target_id + 1
        files[ID_COUNTERS] = serialize_bytes(counters, "id-counters")

    today = datetime.datetime.now(datetime.UTC).date().isoformat()
    if draft.kind == "concept-set":
        if not isinstance(content, dict):
            raise SubmitError(422, "invalid_content", "A concept set is a JSON object", errors=[])
        instance = Instance(
            repo_url=forge.config_repo_url(instance_config),
            organization=instance_config.get("organization") if isinstance(instance_config, dict) else None,
            tool_tag=tool_tag(settings.app_version),
        )
        stamp_concept_set(content, cs_id=target_id, base=base_doc, submitter=submitter, instance=instance, today=today)
    elif draft.kind == "project":
        if not isinstance(content, dict):
            raise SubmitError(422, "invalid_content", "A project is a JSON object", errors=[])
        stamp_project(content, project_id=target_id, base=base_doc, submitter=submitter, today=today)
    elif draft.kind == "config" and isinstance(content, dict):
        # Branding images ride in the draft's `$assets` (services/branding_assets.py).
        try:
            files.update(branding_assets.apply_assets(content, base_doc, lambda p: repo.show(base, p)))
        except branding_assets.AssetError as exc:
            raise SubmitError(422, exc.code, str(exc), asset=exc.kind) from None

    result = validate(spec.format_kind, content)
    if not result.valid:
        raise SubmitError(
            422,
            "invalid_content",
            f"The {spec.label} does not match the format ({len(result.errors)} error(s))",
            errors=[{"pointer": e.pointer or "/", "message": e.message} for e in result.errors[:50]],
        )

    path = spec.file_path(target_id)
    files[path] = serialize_bytes(content, spec.format_kind)

    # Never reuse a published (id, version) pair.
    version = content.get("version") if draft.kind == "concept-set" else None
    base_version = base_doc.get("version") if isinstance(base_doc, dict) else None
    index = _parse_bytes(repo.show(base, versioning.INDEX_FILE))
    index = index if isinstance(index, dict) else {}
    version_changed = draft.kind == "concept-set" and version and version != base_version
    if version_changed and version in (index.get(str(target_id)) or {}):
        raise SubmitError(
            409,
            "version_published",
            f"Version {version} of concept set {target_id} is already published: bump to a new version",
        )

    if base_doc is not None and files.get(path) == repo.show(base, path) and len(files) == 1:
        raise SubmitError(409, "no_changes", "The draft is identical to the file in the repository")

    text = (message or "").strip() or _default_message(spec, draft.kind, target_id, content, is_new)
    title, _, rest = text.partition("\n")
    full_message = text if not trailer else f"{text}\n\n{trailer}"
    commit_sha = repo.commit_files(base, files, full_message + "\n", author)

    plan = _Plan(
        base=base,
        commit_sha=commit_sha,
        head_sha=commit_sha,
        target_id=target_id,
        title=title.strip(),
        body=rest.strip(),
        files=files,
    )
    if mode == "commit" and version_changed:
        versioning.record(index, target_id, version, commit_sha)
        plan.index_sha = repo.commit_files(
            commit_sha,
            {versioning.INDEX_FILE: versioning.index_bytes(index)},
            f"Index concept set {target_id} v{version}\n",
            Author(repo.committer.name, repo.committer.email),
        )
        plan.head_sha = plan.index_sha
    return plan


def _copy(value: Any) -> Any:
    if isinstance(value, dict):
        return {k: _copy(v) for k, v in value.items()}
    if isinstance(value, list):
        return [_copy(v) for v in value]
    return value


def _proposal_branch(submitter: Submitter, kind: str, target_id: int | None, sha: str) -> str:
    return f"proposal/{_slug(submitter.username)}-{kind}-{target_id if target_id is not None else 'new'}-{sha[:7]}"


def _manual_proposal_url(kind: str, web_url: str, branch: str, base_branch: str) -> str | None:
    try:
        path = forge.project_path(web_url)
    except GitError:
        return None
    origin = web_url.split("/" + path.split("/")[0], 1)[0]
    if kind == "github":
        return f"{origin}/{path}/compare/{base_branch}...{branch}?expand=1"
    return f"{origin}/{path}/-/merge_requests/new?merge_request%5Bsource_branch%5D={branch}"


async def submit(
    db: AsyncSession,
    *,
    draft: Draft,
    user: User,
    mode: str,
    message: str | None,
    repo: ContentRepo,
    store: ContentStore,
) -> dict:
    if draft.kind not in KINDS:
        raise SubmitError(422, "invalid_kind", f"Unknown draft kind {draft.kind!r}")
    spec = KINDS[draft.kind]
    permissions = await user_permissions(db, user)
    reviews_only = False
    if mode == "commit":
        if not all(p in permissions for p in spec.commit):
            raise SubmitError(403, "forbidden", "Committing this kind of file directly needs a maintainer role")
    elif spec.propose not in permissions:
        if draft.kind == "concept-set" and "reviews:write" in permissions and draft.target_id is not None:
            reviews_only = True
        else:
            raise SubmitError(403, "forbidden", "Your role may not propose changes to this kind of file")

    submitter = submitter_of(user)
    config = store.catalogue().config
    remote_url = await repo.run(repo.remote_url)
    host = git_credential_service.host_of(remote_url)
    user_token = await oauth_service.forge_token_for_host(db, user, host) if host else None
    service_token = repo.token

    committer = repo.committer
    user_author = Author(submitter.display_name, submitter.email or committer.email)

    def work() -> dict:
        if mode == "commit":
            token = service_token or user_token
            plan = _prepare(
                repo,
                draft=draft,
                mode=mode,
                message=message,
                submitter=submitter,
                reviews_only=False,
                instance_config=config,
                author=user_author,
                trailer=None,
            )
            if remote_url:
                repo.push(plan.head_sha, repo.branch, token)
            repo.fast_forward(plan.head_sha)
            return {"plan": plan, "branch": None, "token": token}

        if not remote_url:
            raise GitError("proposals need a remote content repository", "no_remote")
        attempts: list[tuple[str | None, Author, str | None]] = []
        if user_token:
            attempts.append((user_token, user_author, None))
        if service_token or not attempts:
            attempts.append((service_token, Author(committer.name, committer.email), _trailer(submitter)))
        last_error: GitError | None = None
        for i, (token, author, trailer) in enumerate(attempts):
            plan = _prepare(
                repo,
                draft=draft,
                mode=mode,
                message=message,
                submitter=submitter,
                reviews_only=reviews_only,
                instance_config=config,
                author=author,
                trailer=trailer,
            )
            branch = _proposal_branch(submitter, draft.kind, draft.target_id, plan.commit_sha)
            try:
                repo.push(plan.head_sha, branch, token)
            except GitError as exc:
                last_error = exc
                # The user's own token may lack push access to this repository:
                # fall back to the instance's service token.
                if i + 1 < len(attempts) and exc.code in ("auth_failed", "not_found"):
                    logger.info("proposal_push_fallback", user=submitter.username, code=exc.code)
                    continue
                raise
            return {"plan": plan, "branch": branch, "token": token}
        raise last_error or GitError("the proposal could not be pushed")

    async with repo.lock:
        outcome = await asyncio.to_thread(work)
    plan: _Plan = outcome["plan"]
    if mode == "commit":
        store.invalidate()

    result: dict[str, Any] = {
        "mode": mode,
        "commitSha": plan.commit_sha,
        "headSha": plan.head_sha,
        "targetId": plan.target_id,
    }
    if draft.kind == "concept-set":
        result["conceptSetId"] = plan.target_id
    if plan.index_sha:
        result["indexCommitSha"] = plan.index_sha

    if mode == "proposal":
        branch = outcome["branch"]
        result["branch"] = branch
        kind = forge.forge_kind(config, remote_url)
        web_url = remote_url if remote_url.startswith(("http://", "https://")) else forge.config_repo_url(config)
        web_url = strip_credentials(web_url) or ""
        body = plan.body
        credit = f"Submitted by {submitter.display_name} (@{submitter.username}) from {settings.app_name}."
        body = f"{body}\n\n{credit}".strip()
        try:
            result["proposalUrl"] = await forge.open_proposal(
                kind=kind,
                remote_url=web_url,
                token=outcome["token"],
                head=branch,
                base=repo.branch,
                title=plan.title,
                body=body,
            )
        except (forge.ForgeError, GitError) as exc:
            logger.warning("proposal_open_failed", branch=branch, error=str(exc))
            result["proposalUrl"] = _manual_proposal_url(kind, web_url, branch, repo.branch)
            result["proposalError"] = str(exc)

    await db.delete(draft)
    await db.commit()
    logger.info(
        "draft_submitted",
        mode=mode,
        kind=draft.kind,
        target=plan.target_id,
        commit=plan.commit_sha,
        user=submitter.username,
    )
    return result
