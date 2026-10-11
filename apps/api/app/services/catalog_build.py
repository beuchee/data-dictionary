"""The static payload: `data.json`, `data_inline.js`, `resolved_concept_ids.json`
and the deferred resolved lists, built from a content root.

The one implementation, used by the API and by `build.py` at the repo root
(which loads this file directly, and runs `snapshot.py` first). So it imports
nothing but the standard library, and takes the content root as an argument.

- Resolved sets of at most `RESOLVED_INLINE_THRESHOLD` concepts are inlined;
  larger ones become a stub (`resolvedDeferred`) and their file is copied to
  `<out>/concept_sets_resolved/{id}.json`, lazy-loaded by the app.
- `conceptSetVersions` embeds the definition of every (id, version) a project
  pins that is not the current one, read from git at the indexed commit, up to
  `SNAPSHOT_INLINE_MAX_ITEMS` expression items. The rest is fetched at runtime
  from the forge, through `conceptSetVersionsIndex`.
- `id_counters.json` is corrected (never lowered) when a counter is not above
  the highest id on disk: the only writer of that file besides the API's own
  id allocation.
"""

from __future__ import annotations

import datetime
import glob
import hashlib
import json
import os
import shutil
import subprocess
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from pathlib import Path

RESOLVED_INLINE_THRESHOLD = 100
SNAPSHOT_INLINE_MAX_ITEMS = 500

Log = Callable[[str], None]


class BuildError(RuntimeError):
    pass


@dataclass
class BuildResult:
    data: dict
    resolved_ids: list[int]
    # Ids of the resolved lists too large to inline (copied next to data.json).
    deferred_ids: list[int] = field(default_factory=list)
    stats: dict = field(default_factory=dict)


def _quiet(_message: str) -> None:
    pass


def git_show(root, sha: str, repo_path: str, env: Mapping[str, str] | None = None) -> str | None:
    """`repo_path` at commit `sha`, or None when absent."""
    try:
        result = subprocess.run(
            ["git", "show", f"{sha}:{repo_path}"],
            cwd=str(root),
            capture_output=True,
            # The files are UTF-8 JSON; without this, stdout is decoded with the
            # locale encoding (cp1252 on Windows) and French text comes out mangled.
            encoding="utf-8",
            env=dict(env) if env is not None else None,
            check=True,
        )
        return result.stdout
    except subprocess.CalledProcessError:
        return None
    except FileNotFoundError:
        raise BuildError(
            "git is not installed, but build.py needs it to read pinned concept set\n"
            "versions. In CI, use an image that ships git (e.g. python:3.12-alpine\n"
            "plus `apk add --no-cache git`)."
        ) from None


def project_cs_entries(project: dict) -> list:
    """The {id, version} entries a project pins: through its groups, else the
    legacy flat `conceptSets` array."""
    if isinstance(project.get("groups"), list):
        out = []
        for g in project["groups"]:
            out.extend(g.get("conceptSets") or [])
        return out
    return project.get("conceptSets") or []


def collect_versioned_snapshots(
    root, projects, concept_sets, versions_index, *, log: Log = _quiet, env: Mapping[str, str] | None = None
) -> dict:
    """{id: {version: definition}} for every pinned (id, version) that is not the
    current version, read at the indexed commit. Definitions only: a past
    version's resolved list is fetched on demand."""
    current_versions = {cs["id"]: cs.get("version") for cs in concept_sets}
    needed = set()
    for p in projects:
        for entry in project_cs_entries(p):
            cs_id = entry.get("id")
            version = entry.get("version")
            if cs_id is None or not version:
                continue
            if version == current_versions.get(cs_id):
                continue
            needed.add((cs_id, version))

    cs_versions: dict = {}
    missing = []
    for cs_id, version in sorted(needed):
        sha = versions_index.get(str(cs_id), {}).get(version)
        if not sha:
            missing.append((cs_id, version, "no SHA in index"))
            continue
        cs_blob = git_show(root, sha, f"concept_sets/{cs_id}.json", env)
        if cs_blob is None:
            missing.append((cs_id, version, f"git show concept_sets/{cs_id}.json @ {sha[:10]} failed"))
            continue
        parsed = json.loads(cs_blob)
        n_items = len((parsed.get("expression") or {}).get("items") or [])
        if n_items > SNAPSHOT_INLINE_MAX_ITEMS:
            log(f"    concept set {cs_id} v{version}: {n_items} expression items — fetched on demand")
            continue
        cs_versions.setdefault(str(cs_id), {})[version] = parsed

    if missing:
        log("  WARNINGS while collecting versioned snapshots:")
        for cs_id, version, why in missing:
            log(f"    concept set {cs_id} v{version}: {why}")
        # The commonest cause in CI is a shallow clone: the SHA is indexed but the
        # commit was never fetched.
        if any("git show" in why for _, _, why in missing):
            log("  If this runs in CI, fetch the full history (GitLab: GIT_DEPTH: 0,")
            log("  GitHub Actions: fetch-depth: 0) — a shallow clone cannot read past commits.")
    return cs_versions


def load_json_dir(directory, sort_key: str = "id") -> list:
    items = []
    for path in glob.glob(os.path.join(directory, "*.json")):
        with open(path, encoding="utf-8") as f:
            items.append(json.load(f))
    items.sort(key=lambda x: x.get(sort_key, 0))
    return items


def load_json_file(path):
    if not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _fingerprint(value) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:16]


def build_payload(
    root,
    *,
    data_version: str | None = None,
    fix_id_counters: bool = True,
    log: Log = _quiet,
    env: Mapping[str, str] | None = None,
) -> BuildResult:
    """Read the content root and assemble the payload (no file is written,
    except `id_counters.json` when `fix_id_counters` and a counter is too low
    or the file is not in canonical form, exactly as build.py always did)."""
    root = Path(root)
    config_path = root / "config.json"
    if not config_path.is_file():
        raise BuildError(f"Missing config.json at {config_path}. See config.json in the repo root.")
    with open(config_path, encoding="utf-8") as f:
        config = json.load(f)

    concept_sets = load_json_dir(root / "concept_sets")
    projects = load_json_dir(root / "projects")
    versions_index = load_json_file(root / "concept_sets_versions.json") or {}

    resolved_dir = root / "concept_sets_resolved"
    resolved = load_json_dir(resolved_dir, sort_key="conceptSetId") if resolved_dir.is_dir() else []

    unit_conversions = load_json_file(root / "units" / "unit_conversions.json")
    recommended_units = load_json_file(root / "units" / "recommended_units.json")
    mapping_recommendations = load_json_file(root / "mapping_recommendations" / "mapping_recommendations.json")

    counters_path = root / "id_counters.json"
    counters = load_json_file(counters_path) if counters_path.is_file() else {}
    next_cs_id = counters.get("nextConceptSetId", 1)
    next_proj_id = counters.get("nextProjectId", 1)
    max_cs_id = max((cs["id"] for cs in concept_sets), default=0)
    max_proj_id = max((p["id"] for p in projects), default=0)
    if next_cs_id <= max_cs_id:
        next_cs_id = max_cs_id + 1
        log(f"  WARNING: nextConceptSetId was too low, bumped to {next_cs_id}")
    if next_proj_id <= max_proj_id:
        next_proj_id = max_proj_id + 1
        log(f"  WARNING: nextProjectId was too low, bumped to {next_proj_id}")
    if fix_id_counters:
        counters_text = json.dumps({"nextConceptSetId": next_cs_id, "nextProjectId": next_proj_id}, indent=2) + "\n"
        if not counters_path.is_file() or counters_path.read_text(encoding="utf-8") != counters_text:
            counters_path.write_text(counters_text, encoding="utf-8")

    # A hash of the content itself, not of (id, modifiedDate, version): a
    # hand-edit that forgets modifiedDate still changes it.
    full_fingerprint = "\n".join(
        [
            _fingerprint(concept_sets),
            _fingerprint(projects),
            _fingerprint(unit_conversions),
            _fingerprint(recommended_units),
            _fingerprint(mapping_recommendations) if mapping_recommendations else "",
        ]
    )
    data_hash = hashlib.sha256(full_fingerprint.encode()).hexdigest()[:16]

    resolved_inline = []
    deferred_ids = []
    for r in resolved:
        concepts = r.get("resolvedConcepts", [])
        if len(concepts) <= RESOLVED_INLINE_THRESHOLD:
            resolved_inline.append(r)
        else:
            resolved_inline.append(
                {
                    "conceptSetId": r["conceptSetId"],
                    "vocabularyVersion": r.get("vocabularyVersion"),
                    "resolvedConcepts": [],
                    "resolvedDeferred": True,
                    "resolvedCount": len(concepts),
                }
            )
            deferred_ids.append(r["conceptSetId"])

    cs_versions = collect_versioned_snapshots(root, projects, concept_sets, versions_index, log=log, env=env)

    data = {
        "dataVersion": data_version or datetime.datetime.now(datetime.UTC).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "dataHash": data_hash,
        "config": config,
        "conceptSets": concept_sets,
        "projects": projects,
        "resolvedConceptSets": resolved_inline,
        "conceptSetVersions": cs_versions,
        # Deliberately empty: a past version's resolved list is fetched on demand.
        # The key stays so older cached payloads keep parsing.
        "resolvedConceptSetVersions": {},
        # {id: {version: sha}} for every published version: lets the app fetch a
        # version that is not embedded from the forge's raw endpoint.
        "conceptSetVersionsIndex": versions_index,
        "unitConversions": unit_conversions,
        "recommendedUnits": recommended_units,
        "mappingRecommendations": mapping_recommendations,
        "nextConceptSetId": next_cs_id,
        "nextProjectId": next_proj_id,
    }

    # Concept ids used anywhere, for DuckDB filtering.
    resolved_ids = set()
    for rcs in resolved:
        for c in rcs.get("resolvedConcepts", []):
            resolved_ids.add(c["conceptId"])
    for cs in concept_sets:
        for item in cs.get("expression", {}).get("items", []):
            cid = item.get("concept", {}).get("conceptId")
            if cid:
                resolved_ids.add(cid)

    mr_langs = len(mapping_recommendations.get("translations", {})) if mapping_recommendations else 0
    stats = {
        "conceptSets": len(concept_sets),
        "projects": len(projects),
        "resolved": len(resolved),
        "deferred": len(deferred_ids),
        "unitConversions": len(unit_conversions),
        "recommendedUnits": len(recommended_units),
        "mappingRecommendationLanguages": mr_langs,
        "versionSnapshots": sum(len(v) for v in cs_versions.values()),
    }
    return BuildResult(data=data, resolved_ids=sorted(resolved_ids), deferred_ids=deferred_ids, stats=stats)


def compact_json(data: dict) -> str:
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def write_outputs(root, out_dir, result: BuildResult, *, log: Log = _quiet) -> None:
    """Write data.json, data_inline.js, resolved_concept_ids.json and the
    deferred resolved files into `out_dir` (its previous deferred dir replaced)."""
    root = Path(root)
    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    deferred_dir = out_dir / "concept_sets_resolved"
    if deferred_dir.is_dir():
        shutil.rmtree(deferred_dir)
    if result.deferred_ids:
        deferred_dir.mkdir(parents=True, exist_ok=True)
        for cs_id in result.deferred_ids:
            src = root / "concept_sets_resolved" / f"{cs_id}.json"
            if src.is_file():
                shutil.copy2(src, deferred_dir / f"{cs_id}.json")

    with open(out_dir / "resolved_concept_ids.json", "w", encoding="utf-8") as f:
        json.dump(result.resolved_ids, f, separators=(",", ":"))
    log(f"  -> {out_dir.name}/resolved_concept_ids.json ({len(result.resolved_ids)} unique concept IDs)")

    compact = compact_json(result.data)
    with open(out_dir / "data.json", "w", encoding="utf-8") as f:
        f.write(compact)
    with open(out_dir / "data_inline.js", "w", encoding="utf-8") as f:
        f.write("const DATA=" + compact + ";")

    s = result.stats
    log(
        f"Built {s['conceptSets']} concept sets, {s['projects']} projects, {s['resolved']} resolved "
        f"({s['resolved'] - s['deferred']} inline, {s['deferred']} deferred), "
        f"{s['unitConversions']} unit conversions, {s['recommendedUnits']} recommended units, "
        f"mapping recommendations ({s['mappingRecommendationLanguages']} languages), "
        f"versioned snapshots ({s['versionSnapshots']} concept set definitions)"
    )
    log(f"  -> {out_dir.name}/data.json ({os.path.getsize(out_dir / 'data.json'):,} bytes)")
    log(f"  -> {out_dir.name}/data_inline.js ({os.path.getsize(out_dir / 'data_inline.js'):,} bytes)")


def build(root, out_dir, *, log: Log = _quiet, **kwargs) -> BuildResult:
    result = build_payload(root, log=log, **kwargs)
    write_outputs(root, out_dir, result, log=log)
    return result
