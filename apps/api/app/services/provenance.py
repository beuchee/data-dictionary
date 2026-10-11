"""Provenance stamping of a submitted file: the one place the server applies
v1's rules (legacy/app.js `stampModified`, `normalizeConceptSetMeta`,
`setSourceRepoOrdered`, `updateConceptSet`; legacy/concept-sets.js
`submitCreateCS` for new sets and the root name/description mirroring).

Pure functions on parsed JSON. A key that is missing is inserted at its
canonical position (concept_set.example.json), so a stamped file keeps the
field order of every other file.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from dictionary_format import RawFloat

CONCEPT_SET_ORDER = [
    "id",
    "name",
    "description",
    "version",
    "createdBy",
    "createdDate",
    "modifiedBy",
    "modifiedDate",
    "createdByTool",
    "expression",
    "tags",
    "metadata",
]
METADATA_ORDER = [
    "uniqueId",
    "organization",
    "sourceRepo",
    "reviewStatus",
    "origin",
    "translations",
    "createdByDetails",
    "reviews",
    "versions",
    "distributionStats",
]
PROJECT_ORDER = ["id", "translations", "createdBy", "createdDate", "modifiedDate", "groups"]

APP_NAME = "INDICATE Data Dictionary"
APP_REPOSITORY_URL = "https://github.com/indicate-eu/data-dictionary"


def tool_tag(app_version: str) -> str:
    """`INDICATE Data Dictionary v<version> (<url>)`, as v1's `App.toolTag()`."""
    return f"{APP_NAME} v{app_version} ({APP_REPOSITORY_URL})"


@dataclass
class Submitter:
    """Who submits: the profile fields of the logged-in user."""

    username: str
    first_name: str | None = None
    last_name: str | None = None
    affiliation: str | None = None
    profession: str | None = None
    orcid: str | None = None
    email: str | None = None

    @property
    def full_name(self) -> str:
        return f"{self.first_name or ''} {self.last_name or ''}".strip()

    @property
    def display_name(self) -> str:
        return self.full_name or self.username

    def created_by_details(self) -> dict:
        return {
            "firstName": self.first_name or "",
            "lastName": self.last_name or "",
            "affiliation": self.affiliation or "",
            "profession": self.profession or "",
            "orcid": self.orcid or "",
        }


@dataclass
class Instance:
    """What this instance stamps: its repository URL and organization."""

    repo_url: str
    organization: dict | None
    tool_tag: str


# ---------------------------------------------------------------------------
# Ordered insertion
# ---------------------------------------------------------------------------


def set_ordered(obj: dict, key: str, value: Any, order: list[str]) -> None:
    """`obj[key] = value`, in place. An existing key keeps its position; a new one
    goes right after the last key preceding it in `order` (first if none)."""
    if key in obj:
        obj[key] = value
        return
    predecessors = set(order[: order.index(key)]) if key in order else set(order)
    items = list(obj.items())
    position = 0
    for i, (k, _) in enumerate(items):
        if k in predecessors:
            position = i + 1
    items.insert(position, (key, value))
    obj.clear()
    obj.update(items)


def set_source_repo_ordered(metadata: dict, url: str) -> None:
    """v1 `setSourceRepoOrdered`: `sourceRepo` right after `organization` (appended
    when there is no organization)."""
    if metadata.get("sourceRepo", object()) == url and "sourceRepo" in metadata:
        return
    rebuilt: dict = {}
    placed = False
    for k, v in metadata.items():
        if k == "sourceRepo":
            continue
        rebuilt[k] = v
        if k == "organization":
            rebuilt["sourceRepo"] = url
            placed = True
    if not placed:
        rebuilt["sourceRepo"] = url
    metadata.clear()
    metadata.update(rebuilt)


def normalize_concept_set_meta(cs: dict, repo_url: str) -> dict:
    """v1 `normalizeConceptSetMeta`, in place: flat `organization` → `{created,
    current}`, `created` alone → `current` = `created`, missing `sourceRepo` →
    `repo_url` after `organization`."""
    m = cs.get("metadata") if isinstance(cs, dict) else None
    if not isinstance(m, dict):
        return cs
    o = m.get("organization")
    if isinstance(o, dict) and "created" not in o and "current" not in o:
        m["organization"] = {
            "created": {"name": o.get("name") or "", "url": o.get("url") or ""},
            "current": {"name": o.get("name") or "", "url": o.get("url") or ""},
        }
    elif isinstance(o, dict) and "created" in o and "current" not in o:
        m["organization"] = {"created": o["created"], "current": o["created"]}
    if m.get("sourceRepo") is None:
        set_source_repo_ordered(m, repo_url)
    return cs


def mirror_root_from_english(cs: dict) -> None:
    """Root `name` / `description` = `translations.en.name` / `.shortDescription`."""
    m = cs.get("metadata")
    t = m.get("translations") if isinstance(m, dict) else None
    en = t.get("en") if isinstance(t, dict) else None
    if not isinstance(en, dict):
        return
    if "name" in en:
        set_ordered(cs, "name", en.get("name"), CONCEPT_SET_ORDER)
    set_ordered(cs, "description", en.get("shortDescription") or None, CONCEPT_SET_ORDER)


# Fields an edit may not rewrite: lineage, authorship, import provenance.
_FROZEN_ROOT = ("createdBy", "createdDate")
_FROZEN_METADATA = ("uniqueId", "origin", "createdByDetails")


def stamp_concept_set(
    cs: dict,
    *,
    cs_id: int,
    base: dict | None,
    submitter: Submitter,
    instance: Instance,
    today: str,
    new_uuid: Callable[[], str] = lambda: str(uuid.uuid4()),
) -> dict:
    """Stamp a concept set about to be committed, in place. `base` is the file as
    it is in the repository (None for a new set)."""
    set_ordered(cs, "id", cs_id, CONCEPT_SET_ORDER)
    metadata = cs.get("metadata")
    if not isinstance(metadata, dict):
        metadata = {}
        set_ordered(cs, "metadata", metadata, CONCEPT_SET_ORDER)
    org = (
        instance.organization if isinstance(instance.organization, dict) and instance.organization.get("name") else None
    )

    if base is None:
        set_ordered(cs, "createdBy", submitter.display_name, CONCEPT_SET_ORDER)
        set_ordered(cs, "createdDate", today, CONCEPT_SET_ORDER)
        if not cs.get("version"):
            set_ordered(cs, "version", "1.0.0", CONCEPT_SET_ORDER)
        set_ordered(cs, "createdByTool", instance.tool_tag, CONCEPT_SET_ORDER)
        if not metadata.get("uniqueId"):
            set_ordered(metadata, "uniqueId", new_uuid(), METADATA_ORDER)
        if org is not None and not isinstance(metadata.get("organization"), dict):
            set_ordered(metadata, "organization", {"created": dict(org), "current": dict(org)}, METADATA_ORDER)
        if "reviewStatus" not in metadata:
            set_ordered(metadata, "reviewStatus", "draft", METADATA_ORDER)
        if "origin" not in metadata:
            set_ordered(metadata, "origin", None, METADATA_ORDER)
        set_ordered(metadata, "createdByDetails", submitter.created_by_details(), METADATA_ORDER)
    else:
        normalize_concept_set_meta(cs, instance.repo_url)
        for key in _FROZEN_ROOT:
            if key in base:
                set_ordered(cs, key, base[key], CONCEPT_SET_ORDER)
        base_meta = base.get("metadata") if isinstance(base.get("metadata"), dict) else {}
        for key in _FROZEN_METADATA:
            if key in base_meta:
                set_ordered(metadata, key, base_meta[key], METADATA_ORDER)
        base_org = normalize_concept_set_meta({"metadata": {"organization": base_meta.get("organization")}}, "")
        created = (base_org["metadata"].get("organization") or {}).get("created")
        if created is not None and isinstance(metadata.get("organization"), dict):
            metadata["organization"]["created"] = created

    if org is not None:
        if not isinstance(metadata.get("organization"), dict):
            set_ordered(metadata, "organization", {"created": dict(org), "current": dict(org)}, METADATA_ORDER)
        else:
            normalize_concept_set_meta(cs, instance.repo_url)
            metadata["organization"]["current"] = dict(org)
    normalize_concept_set_meta(cs, instance.repo_url)
    if instance.repo_url:
        set_source_repo_ordered(metadata, instance.repo_url)

    set_ordered(cs, "modifiedDate", today, CONCEPT_SET_ORDER)
    name = submitter.display_name.strip()
    if name:
        set_ordered(cs, "modifiedBy", name, CONCEPT_SET_ORDER)
    mirror_root_from_english(cs)
    return cs


def stamp_project(project: dict, *, project_id: int, base: dict | None, submitter: Submitter, today: str) -> dict:
    set_ordered(project, "id", project_id, PROJECT_ORDER)
    if base is None:
        set_ordered(project, "createdBy", submitter.display_name, PROJECT_ORDER)
        set_ordered(project, "createdDate", today, PROJECT_ORDER)
    else:
        for key in ("createdBy", "createdDate"):
            if key in base:
                set_ordered(project, key, base[key], PROJECT_ORDER)
    set_ordered(project, "modifiedDate", today, PROJECT_ORDER)
    return project


# ---------------------------------------------------------------------------
# Diffs
# ---------------------------------------------------------------------------

# What the server stamps anyway: ignored when deciding whether a draft only
# appends reviews.
_STAMPED_ROOT = ("name", "description", "modifiedBy", "modifiedDate")
_STAMPED_METADATA = ("organization", "sourceRepo")


def _without(cs: dict) -> dict:
    out = {k: v for k, v in cs.items() if k not in _STAMPED_ROOT}
    meta = out.get("metadata")
    if isinstance(meta, dict):
        out["metadata"] = {k: v for k, v in meta.items() if k not in (*_STAMPED_METADATA, "reviews")}
    return out


def only_reviews_appended(base: dict, draft: dict) -> bool:
    """True when `draft` differs from `base` only by new entries appended to
    `metadata.reviews` (and by fields the server stamps)."""
    if not isinstance(base, dict) or not isinstance(draft, dict):
        return False
    base_reviews = (base.get("metadata") or {}).get("reviews") or []
    draft_meta = draft.get("metadata")
    draft_reviews = (draft_meta.get("reviews") if isinstance(draft_meta, dict) else None) or []
    if not isinstance(base_reviews, list) or not isinstance(draft_reviews, list):
        return False
    n = len(base_reviews)
    if len(draft_reviews) <= n or draft_reviews[:n] != base_reviews:
        return False
    return _without(base) == _without(draft)


def preserve_numbers(new: Any, base: Any) -> Any:
    """`new` with every number equal to its counterpart in `base` replaced by the
    base value, so lexemes a browser cannot keep (`1.0` read as `1`, `0.10`) are
    written back as they were. Structure and every other value come from `new`."""
    if isinstance(new, bool) or isinstance(base, bool):
        return new
    if isinstance(new, (int, float)) and isinstance(base, (int, float)):
        if float(new) == float(base) and (isinstance(base, RawFloat) or type(new) is not type(base)):
            return base
        return new
    if isinstance(new, dict) and isinstance(base, dict):
        return {k: preserve_numbers(v, base[k]) if k in base else v for k, v in new.items()}
    if isinstance(new, list) and isinstance(base, list):
        return [preserve_numbers(v, base[i]) if i < len(base) else v for i, v in enumerate(new)]
    return new
