"""Read access to the content repository: the working copy holding
`concept_sets/`, `projects/`, `units/`, `config.json`… (`settings.content_path`).

The catalogue (config, concept sets, projects, units, mapping recommendations,
versions index, id counters, and per-set resolved counts) is loaded lazily and
reloaded when a content file changes: every access compares a fingerprint of
the content files' (name, mtime, size), at most once per `check_interval`.

Resolved lists are not part of it (67 MB on the INDICATE repo): each is parsed
on demand and kept in a small LRU keyed by its file's mtime.

Past versions come from git: `concept_sets_versions.json` maps (id, version) to
the commit that introduced it, read with `git cat-file`. Commits are immutable,
so those results are cached for good.
"""

from __future__ import annotations

import os
import re
import subprocess
import threading
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import structlog
from dictionary_format import parse, validate

logger = structlog.get_logger()

CONCEPT_SETS_DIR = "concept_sets"
RESOLVED_DIR = "concept_sets_resolved"
PROJECTS_DIR = "projects"
RECOMMENDED_UNITS = "units/recommended_units.json"
UNIT_CONVERSIONS = "units/unit_conversions.json"
MAPPING_RECOMMENDATIONS = "mapping_recommendations/mapping_recommendations.json"
CONFIG = "config.json"
VERSIONS_INDEX = "concept_sets_versions.json"
ID_COUNTERS = "id_counters.json"

_WATCHED_DIRS = (CONCEPT_SETS_DIR, RESOLVED_DIR, PROJECTS_DIR, "units", "mapping_recommendations")
_WATCHED_FILES = (CONFIG, VERSIONS_INDEX, ID_COUNTERS)

_ID_FILE = re.compile(r"^([1-9][0-9]*)\.json$")
_SHA = re.compile(r"^[0-9a-f]{7,64}$")
_GIT_TIMEOUT_S = 15

# Each resolved file holds exactly one "conceptId" key per resolved concept, and
# a quote inside a string value is escaped (\"), so a byte count is exact and
# avoids parsing 67 MB to fill the list's counts.
_RESOLVED_CONCEPT_KEY = b'"conceptId"'


class ContentError(RuntimeError):
    """The content directory is missing or unreadable."""


@dataclass
class Catalogue:
    config: dict
    concept_sets: dict[int, dict]
    projects: dict[int, dict]
    recommended_units: list
    unit_conversions: list
    mapping_recommendations: dict | None
    versions_index: dict[str, dict[str, str]]
    id_counters: dict | None
    resolved_counts: dict[int, int]
    # "path: message" for every file that failed to parse or validate. A file
    # that fails to parse is left out; one that only fails validation is kept.
    issues: list[str] = field(default_factory=list)
    summaries: list[dict] = field(default_factory=list)

    @property
    def anonymous_read(self) -> bool:
        access = self.config.get("access")
        value = access.get("anonymousRead") if isinstance(access, dict) else None
        return value if isinstance(value, bool) else True


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------


def find_content_root(start: Path) -> Path | None:
    """The first directory from `start` upwards holding `concept_sets/` and `config.json`."""
    for candidate in [start, *start.parents]:
        if (candidate / CONCEPT_SETS_DIR).is_dir() and (candidate / CONFIG).is_file():
            return candidate
    return None


def normalize_organization(org: Any) -> dict | None:
    """`{created, current}`; the legacy flat `{name, url}` stands for both."""
    if not isinstance(org, dict):
        return None
    if "created" in org or "current" in org:
        created = org.get("created")
        return {"created": created, "current": org.get("current") or created}
    return {"created": org, "current": org}


def concept_set_summary(cs: dict, resolved_count: int | None) -> dict:
    """The fields the concept set list shows, per language (no cross-language fallback)."""
    metadata = cs.get("metadata") if isinstance(cs.get("metadata"), dict) else {}
    translations = metadata.get("translations") if isinstance(metadata.get("translations"), dict) else {}
    items = (cs.get("expression") or {}).get("items") if isinstance(cs.get("expression"), dict) else None
    return {
        "id": cs.get("id"),
        "version": cs.get("version"),
        "uniqueId": metadata.get("uniqueId"),
        "translations": {
            lang: {
                key: t.get(key)
                for key in ("name", "category", "subcategory", "shortDescription")
            }
            for lang, t in translations.items()
            if isinstance(t, dict)
        },
        "reviewStatus": metadata.get("reviewStatus"),
        "organization": normalize_organization(metadata.get("organization")),
        "itemCount": len(items) if isinstance(items, list) else 0,
        "resolvedCount": resolved_count,
        "modifiedDate": cs.get("modifiedDate"),
        "modifiedBy": cs.get("modifiedBy"),
    }


def _version_key(version: str) -> tuple:
    """Semver-ish sort key: numeric parts compare as numbers, a pre-release sorts first."""
    core, _, pre = version.partition("-")
    parts = tuple(int(p) if p.isdigit() else -1 for p in core.split("+")[0].split("."))
    return (parts, pre == "", pre)


def version_history(cs: dict | None, index_entry: dict[str, str] | None) -> list[dict]:
    """Every known version of a concept set, newest first: those indexed in git,
    those its metadata lists, and the current one."""
    current = cs.get("version") if cs else None
    metadata = (cs or {}).get("metadata") if isinstance((cs or {}).get("metadata"), dict) else {}
    entries = {
        e["version"]: e
        for e in (metadata.get("versions") or [])
        if isinstance(e, dict) and isinstance(e.get("version"), str)
    }
    index_entry = index_entry or {}
    versions = set(index_entry) | set(entries) | ({current} if current else set())
    out = []
    for version in sorted(versions, key=_version_key, reverse=True):
        meta = entries.get(version, {})
        out.append(
            {
                "version": version,
                "commit": index_entry.get(version),
                "isCurrent": version == current,
                "date": meta.get("date"),
                "author": meta.get("author"),
                "message": meta.get("message"),
            }
        )
    return out


def filter_resolved(concepts: list[dict], search: str | None) -> list[dict]:
    """Concepts whose id, name, code or vocabulary contains `search` (case-insensitive)."""
    needle = (search or "").strip().lower()
    if not needle:
        return concepts
    out = []
    for c in concepts:
        haystack = " ".join(
            str(c.get(k) or "") for k in ("conceptId", "conceptName", "conceptCode", "vocabularyId")
        ).lower()
        if needle in haystack:
            out.append(c)
    return out


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------


class ContentStore:
    def __init__(self, root: Path, *, check_interval: float = 1.0, resolved_cache_size: int = 16):
        self.root = Path(root)
        self.check_interval = check_interval
        self._lock = threading.RLock()
        self._catalogue: Catalogue | None = None
        self._fingerprint: int | None = None
        self._checked_at = 0.0
        self._resolved_cache: OrderedDict[int, tuple[tuple[int, int], dict]] = OrderedDict()
        self._resolved_cache_size = resolved_cache_size
        self._history_cache: OrderedDict[tuple[str, int, str], dict | None] = OrderedDict()
        self._history_cache_size = 64

    # --- catalogue ---------------------------------------------------------

    def catalogue(self) -> Catalogue:
        with self._lock:
            now = time.monotonic()
            if self._catalogue is not None and now - self._checked_at < self.check_interval:
                return self._catalogue
            fingerprint = self._compute_fingerprint()
            self._checked_at = now
            if self._catalogue is None or fingerprint != self._fingerprint:
                self._catalogue = self._load()
                self._fingerprint = fingerprint
            return self._catalogue

    def invalidate(self) -> None:
        with self._lock:
            self._catalogue = None
            self._fingerprint = None

    def _compute_fingerprint(self) -> int:
        if not self.root.is_dir():
            raise ContentError(f"Content directory not found: {self.root}")
        entries: list[tuple[str, int, int]] = []
        for name in _WATCHED_DIRS:
            directory = self.root / name
            if not directory.is_dir():
                continue
            with os.scandir(directory) as it:
                for entry in it:
                    if entry.name.endswith(".json"):
                        st = entry.stat()
                        entries.append((f"{name}/{entry.name}", st.st_mtime_ns, st.st_size))
        for name in _WATCHED_FILES:
            try:
                st = (self.root / name).stat()
            except FileNotFoundError:
                continue
            entries.append((name, st.st_mtime_ns, st.st_size))
        entries.sort()
        return hash(tuple(entries))

    def _read(self, rel: str, kind: str, issues: list[str]) -> Any:
        path = self.root / rel
        try:
            value = parse(path.read_bytes())
        except FileNotFoundError:
            return None
        except (OSError, ValueError) as exc:
            issues.append(f"{rel}: {exc}")
            return None
        result = validate(kind, value)
        if not result.valid:
            issues.append(f"{rel}: " + "; ".join(str(e) for e in result.errors[:3]))
        return value

    def _read_id_dir(self, dirname: str, kind: str, issues: list[str]) -> dict[int, dict]:
        out: dict[int, dict] = {}
        directory = self.root / dirname
        if not directory.is_dir():
            return out
        for path in sorted(directory.iterdir(), key=lambda p: p.name):
            m = _ID_FILE.match(path.name)
            if not m:
                continue
            value = self._read(f"{dirname}/{path.name}", kind, issues)
            if isinstance(value, dict):
                out[int(m.group(1))] = value
        return dict(sorted(out.items()))

    def _resolved_counts(self) -> dict[int, int]:
        counts: dict[int, int] = {}
        directory = self.root / RESOLVED_DIR
        if not directory.is_dir():
            return counts
        for path in directory.iterdir():
            m = _ID_FILE.match(path.name)
            if m:
                counts[int(m.group(1))] = path.read_bytes().count(_RESOLVED_CONCEPT_KEY)
        return counts

    def _load(self) -> Catalogue:
        started = time.monotonic()
        issues: list[str] = []
        config = self._read(CONFIG, "config", issues)
        if not isinstance(config, dict):
            raise ContentError(f"{CONFIG} is missing or unreadable in {self.root}")
        concept_sets = self._read_id_dir(CONCEPT_SETS_DIR, "concept-set", issues)
        resolved_counts = self._resolved_counts()
        catalogue = Catalogue(
            config=config,
            concept_sets=concept_sets,
            projects=self._read_id_dir(PROJECTS_DIR, "project", issues),
            recommended_units=self._read(RECOMMENDED_UNITS, "recommended-units", issues) or [],
            unit_conversions=self._read(UNIT_CONVERSIONS, "unit-conversions", issues) or [],
            mapping_recommendations=self._read(MAPPING_RECOMMENDATIONS, "mapping-recommendations", issues),
            versions_index=self._read(VERSIONS_INDEX, "concept-sets-versions", issues) or {},
            id_counters=self._read(ID_COUNTERS, "id-counters", issues),
            resolved_counts=resolved_counts,
            issues=issues,
        )
        catalogue.summaries = [
            concept_set_summary(cs, resolved_counts.get(cs_id)) for cs_id, cs in concept_sets.items()
        ]
        for issue in issues:
            logger.warning("content_file_issue", issue=issue)
        logger.info(
            "content_catalogue_loaded",
            root=str(self.root),
            concept_sets=len(concept_sets),
            projects=len(catalogue.projects),
            issues=len(issues),
            seconds=round(time.monotonic() - started, 3),
        )
        return catalogue

    # --- resolved lists ----------------------------------------------------

    def resolved(self, cs_id: int) -> dict | None:
        """The current resolved file of a concept set, or None when it has none."""
        path = self.root / RESOLVED_DIR / f"{int(cs_id)}.json"
        try:
            st = path.stat()
        except FileNotFoundError:
            return None
        stamp = (st.st_mtime_ns, st.st_size)
        with self._lock:
            cached = self._resolved_cache.get(cs_id)
            if cached and cached[0] == stamp:
                self._resolved_cache.move_to_end(cs_id)
                return cached[1]
        value = parse(path.read_bytes())
        if not isinstance(value, dict):
            return None
        with self._lock:
            self._resolved_cache[cs_id] = (stamp, value)
            self._resolved_cache.move_to_end(cs_id)
            while len(self._resolved_cache) > self._resolved_cache_size:
                self._resolved_cache.popitem(last=False)
        return value

    # --- versions ----------------------------------------------------------

    def concept_set(self, cs_id: int, version: str | None = None) -> dict | None:
        """Concept set `cs_id` as it is now, or at `version` (from git), or None."""
        current = self.catalogue().concept_sets.get(cs_id)
        if not version or (current is not None and current.get("version") == version):
            return current
        return self._at_version(CONCEPT_SETS_DIR, cs_id, version)

    def resolved_at(self, cs_id: int, version: str | None = None) -> dict | None:
        """The resolved list of `cs_id` now, or the one committed with `version`."""
        current = self.catalogue().concept_sets.get(cs_id)
        if not version or (current is not None and current.get("version") == version):
            return self.resolved(cs_id)
        return self._at_version(RESOLVED_DIR, cs_id, version)

    def version_commit(self, cs_id: int, version: str) -> str | None:
        sha = self.catalogue().versions_index.get(str(cs_id), {}).get(version)
        return sha if isinstance(sha, str) and _SHA.match(sha) else None

    def _at_version(self, dirname: str, cs_id: int, version: str) -> dict | None:
        sha = self.version_commit(cs_id, version)
        if sha is None:
            return None
        key = (dirname, int(cs_id), sha)
        with self._lock:
            if key in self._history_cache:
                self._history_cache.move_to_end(key)
                return self._history_cache[key]
        raw = git_blob(self.root, sha, f"{dirname}/{int(cs_id)}.json")
        value = None
        if raw is not None:
            try:
                parsed = parse(raw)
                value = parsed if isinstance(parsed, dict) else None
            except ValueError:
                logger.warning("content_history_unparsable", path=f"{dirname}/{cs_id}.json", commit=sha)
        with self._lock:
            self._history_cache[key] = value
            while len(self._history_cache) > self._history_cache_size:
                self._history_cache.popitem(last=False)
        return value

    def history_available(self) -> bool:
        return git_toplevel(self.root) is not None


# ---------------------------------------------------------------------------
# Git (read-only, hardened: fixed argv, validated sha and path, no shell)
# ---------------------------------------------------------------------------


def _git_env() -> dict[str, str]:
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    return env


def _run_git(root: Path, *args: str) -> subprocess.CompletedProcess[bytes] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            capture_output=True,
            timeout=_GIT_TIMEOUT_S,
            env=_git_env(),
            check=False,
        )
    except (FileNotFoundError, subprocess.TimeoutExpired) as exc:
        logger.warning("git_unavailable", error=str(exc))
        return None


def git_toplevel(root: Path) -> str | None:
    result = _run_git(root, "rev-parse", "--show-toplevel")
    if result is None or result.returncode != 0:
        return None
    return result.stdout.decode().strip() or None


_SAFE_REL_PATH = re.compile(r"^[a-z_]+/[1-9][0-9]*\.json$")


def git_blob(root: Path, sha: str, rel_path: str) -> bytes | None:
    """The bytes of `rel_path` (relative to `root`) at commit `sha`, or None."""
    if not _SHA.match(sha) or not _SAFE_REL_PATH.match(rel_path):
        raise ValueError(f"Refusing git lookup of {sha!r}:{rel_path!r}")
    # `<sha>:./path` resolves relative to -C, so the content dir may sit below the
    # repo's top level. cat-file applies no textconv and starts no pager.
    result = _run_git(root, "cat-file", "blob", f"{sha}:./{rel_path}")
    if result is None or result.returncode != 0:
        return None
    return result.stdout


# ---------------------------------------------------------------------------
# Process-wide instance
# ---------------------------------------------------------------------------

_store: ContentStore | None = None
_store_lock = threading.Lock()


def get_content_store() -> ContentStore:
    """FastAPI dependency: the store of `settings.content_path` (override it in tests)."""
    global _store
    from app.config import settings

    with _store_lock:
        if _store is None or _store.root != settings.content_path:
            _store = ContentStore(settings.content_path)
        return _store
