"""The concept set version index: `concept_sets_versions.json`, `{id: {version: sha}}`.

The one implementation of the snapshot rules, shared by the API (after its own
commits, and after pulling merged proposals) and by the `snapshot.py` CLI at the
repo root, which loads this file directly. So it imports nothing but the
standard library, and takes the content root as an argument.

Rules (details in docs/build-pipeline.md and snapshot.py's docstring):

- **HEAD stamping** (`snapshot_head`): every (id, version) on disk that the index
  lacks is recorded at the current HEAD. A file with uncommitted changes is
  skipped, since HEAD would not hold its content.
- **Backfill** (`backfill`): walk the history of every `concept_sets/*.json`
  (deleted ones included) and record, for each missing pair, the commit that
  introduced it.
- **Additive only**: a recorded pair is never repointed, because the app
  resolves published shas at runtime. A disagreement found by the backfill is
  reported as a divergence and left alone.
"""

from __future__ import annotations

import glob
import json
import os
import subprocess
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

INDEX_FILE = "concept_sets_versions.json"
CONCEPT_SETS_DIR = "concept_sets"


class VersioningError(RuntimeError):
    """git is missing, or the repository has no commit to stamp against."""


@dataclass
class SnapshotResult:
    sha: str
    added: list[tuple[int, str]] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


@dataclass
class BackfillResult:
    scanned: int = 0
    # (id key, version, sha, path), in the order they were found
    added: list[tuple[str, str, str, str]] = field(default_factory=list)
    # (id key, version, recorded sha, sha that introduced it)
    divergences: list[tuple[str, str, str, str]] = field(default_factory=list)


# ---------------------------------------------------------------------------
# Index file
# ---------------------------------------------------------------------------


def load_index(root: str | os.PathLike) -> dict:
    path = Path(root) / INDEX_FILE
    if not path.is_file():
        return {}
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def sorted_index(index: Mapping) -> dict:
    """Ids numerically, versions as strings: the order the file is written in."""
    return {str(k): dict(sorted(v.items())) for k, v in sorted(index.items(), key=lambda kv: int(kv[0]))}


def index_bytes(index: Mapping) -> bytes:
    """The canonical bytes of the index (also `dictionary_format.serialize`'s)."""
    return (json.dumps(sorted_index(index), indent=2, ensure_ascii=False) + "\n").encode("utf-8")


def save_index(root: str | os.PathLike, index: Mapping) -> None:
    (Path(root) / INDEX_FILE).write_bytes(index_bytes(index))


def record(index: dict, cs_id: int | str, version: str, sha: str) -> bool:
    """Add (id, version) → sha unless the pair is already recorded. True if added."""
    entry = index.setdefault(str(cs_id), {})
    if version in entry:
        return False
    entry[version] = sha
    return True


# ---------------------------------------------------------------------------
# git
# ---------------------------------------------------------------------------


def _git(
    root, args: list[str], env: Mapping[str, str] | None = None, check: bool = True
) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(
            ["git", *args],
            cwd=str(root),
            capture_output=True,
            env=dict(env) if env is not None else None,
            check=check,
        )
    except FileNotFoundError:
        raise VersioningError(
            "git is not installed, but snapshot.py needs it to record the commit of each\n"
            "concept set version. In CI, use an image that ships git (e.g. python:3.12-alpine\n"
            "plus `apk add --no-cache git`)."
        ) from None


def head_sha(root, env: Mapping[str, str] | None = None) -> str:
    try:
        return _git(root, ["rev-parse", "HEAD"], env).stdout.decode().strip()
    except subprocess.CalledProcessError as e:
        stderr = e.stderr.decode(errors="replace").strip()
        # A fresh fork right after reset.py has no commit yet, so HEAD does not
        # resolve. Say so plainly instead of echoing git's "ambiguous argument".
        if "ambiguous argument 'HEAD'" in stderr or "unknown revision" in stderr:
            raise VersioningError(
                "This repository has no commits yet, so there is no HEAD to snapshot against.\n"
                "Commit your files first, then run build.py again."
            ) from None
        raise VersioningError(f"git rev-parse HEAD failed: {stderr}") from None


def dirty_paths(root, env: Mapping[str, str] | None = None) -> set[str]:
    """Repo-relative paths with uncommitted (staged or unstaged) changes under concept_sets/."""
    out = _git(root, ["status", "--porcelain", "--", CONCEPT_SETS_DIR], env).stdout.decode("utf-8")
    paths = set()
    for line in out.splitlines():
        # Format: "XY path" (or "XY old -> new" for renames).
        entry = line[3:]
        if " -> " in entry:
            entry = entry.split(" -> ", 1)[1]
        paths.add(entry.strip().strip('"'))
    return paths


def all_historical_paths(root, env: Mapping[str, str] | None = None) -> list[str]:
    """Every concept_sets/*.json path git has ever known, deleted ones included."""
    out = _git(
        root,
        ["log", "--pretty=format:", "--name-only", "--diff-filter=AMD", "--", CONCEPT_SETS_DIR],
        env,
    ).stdout.decode("utf-8")
    paths = set()
    for line in out.splitlines():
        line = line.strip().strip('"')
        if line.startswith(f"{CONCEPT_SETS_DIR}/") and line.endswith(".json"):
            paths.add(line)
    return sorted(paths)


def commits_touching(root, path: str, env: Mapping[str, str] | None = None) -> list[str]:
    """Commits that touched `path`, oldest first."""
    return _git(root, ["log", "--format=%H", "--reverse", "--", path], env).stdout.decode().split()


def read_at_commit(root, sha: str, path: str, env: Mapping[str, str] | None = None):
    """`path`'s JSON as of `sha`, or None when absent or unreadable there."""
    result = _git(root, ["show", f"{sha}:{path}"], env, check=False)
    if result.returncode != 0:
        return None
    try:
        return json.loads(result.stdout.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None


def first_commit_per_version(root, path: str, env: Mapping[str, str] | None = None) -> dict[tuple[str, str], str]:
    """{(id, version): first sha where the file carried it} across `path`'s history."""
    found: dict[tuple[str, str], str] = {}
    for sha in commits_touching(root, path, env):
        cs = read_at_commit(root, sha, path, env)
        if not isinstance(cs, dict):
            continue
        cs_id = cs.get("id")
        version = cs.get("version")
        if cs_id is None or not version:
            continue
        key = (str(cs_id), version)
        if key not in found:
            found[key] = sha
    return found


# ---------------------------------------------------------------------------
# The two modes
# ---------------------------------------------------------------------------


def snapshot_head(root, env: Mapping[str, str] | None = None, *, write: bool = True) -> SnapshotResult:
    """Record every on-disk (id, version) missing from the index at HEAD."""
    root = Path(root)
    index = load_index(root)
    result = SnapshotResult(sha=head_sha(root, env))
    dirty = dirty_paths(root, env)
    for path in sorted(glob.glob(os.path.join(root, CONCEPT_SETS_DIR, "*.json"))):
        with open(path, encoding="utf-8") as f:
            cs = json.load(f)
        cs_id = cs.get("id")
        version = cs.get("version")
        if cs_id is None or not version:
            result.warnings.append(f"  {os.path.basename(path)}: missing id or version, skipped")
            continue
        if version in index.get(str(cs_id), {}):
            continue
        if os.path.relpath(path, root).replace(os.sep, "/") in dirty:
            result.warnings.append(
                f"  concept_sets/{cs_id}.json: uncommitted changes — "
                f"commit them before running snapshot.py (skipped v{version})"
            )
            continue
        record(index, cs_id, version, result.sha)
        result.added.append((cs_id, version))
    if result.added and write:
        save_index(root, index)
    return result


def backfill(root, env: Mapping[str, str] | None = None, *, write: bool = True) -> BackfillResult:
    """Add every (id, version) of the history missing from the index, at the
    commit that introduced it. Never repoints a recorded pair."""
    root = Path(root)
    index = load_index(root)
    result = BackfillResult()
    paths = all_historical_paths(root, env)
    result.scanned = len(paths)
    for path in paths:
        for (key, version), sha in sorted(first_commit_per_version(root, path, env).items()):
            recorded = index.get(key, {}).get(version)
            if recorded is None:
                record(index, key, version, sha)
                result.added.append((key, version, sha, path))
            elif recorded != sha:
                result.divergences.append((key, version, recorded, sha))
    if result.added and write:
        save_index(root, index)
    return result
