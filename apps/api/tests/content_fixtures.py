"""A small content directory built from real files of this repo, for the
content store and read-route tests."""

import os
import shutil
import subprocess
from pathlib import Path

from dictionary_format import parse, serialize_bytes

from app.services.content_store import find_content_root

REPO_ROOT = find_content_root(Path(__file__).resolve().parent)
assert REPO_ROOT is not None, "tests must run inside the data dictionary repo"

FIXTURE_IDS = (1, 2, 3)


def write_json(path: Path, value, kind: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(serialize_bytes(value, kind))


def read_json(path: Path):
    return parse(path.read_bytes())


def make_resolved(cs_id: int, n: int) -> dict:
    return {
        "conceptSetId": cs_id,
        "vocabularyVersion": {"release": "test"},
        "resolvedConcepts": [
            {
                "conceptId": 1000 + i,
                "conceptName": f"Concept {i} {'glucose' if i % 2 else 'sodium'}",
                "vocabularyId": "LOINC",
                "domainId": "Measurement",
                "conceptClassId": "Lab Test",
                "conceptCode": f"{i}-0",
                "standardConcept": "S",
            }
            for i in range(n)
        ],
    }


def build_content_dir(root: Path, *, anonymous_read: bool | None = None) -> Path:
    """Copy config, three concept sets with their resolved files, one project,
    and slices of the units files into `root`."""
    root.mkdir(parents=True, exist_ok=True)
    config = read_json(REPO_ROOT / "config.json")
    if anonymous_read is not None:
        config["access"] = {"anonymousRead": anonymous_read}
    write_json(root / "config.json", config)
    (root / "concept_sets").mkdir(exist_ok=True)
    for cs_id in FIXTURE_IDS:
        shutil.copyfile(REPO_ROOT / f"concept_sets/{cs_id}.json", root / f"concept_sets/{cs_id}.json")
    (root / "concept_sets_resolved").mkdir(exist_ok=True)
    for cs_id in FIXTURE_IDS[:2]:
        shutil.copyfile(REPO_ROOT / f"concept_sets_resolved/{cs_id}.json", root / f"concept_sets_resolved/{cs_id}.json")
    # Set 3 gets a synthetic list long enough to page through.
    write_json(root / "concept_sets_resolved/3.json", make_resolved(3, 25), "concept-set-resolved")
    (root / "projects").mkdir(exist_ok=True)
    shutil.copyfile(REPO_ROOT / "projects/1.json", root / "projects/1.json")
    for rel, kind in (
        ("units/recommended_units.json", "recommended-units"),
        ("units/unit_conversions.json", "unit-conversions"),
    ):
        write_json(root / rel, read_json(REPO_ROOT / rel)[:3], kind)
    (root / "mapping_recommendations").mkdir(exist_ok=True)
    shutil.copyfile(
        REPO_ROOT / "mapping_recommendations/mapping_recommendations.json",
        root / "mapping_recommendations/mapping_recommendations.json",
    )
    index = read_json(REPO_ROOT / "concept_sets_versions.json")
    write_json(root / "concept_sets_versions.json", {str(i): index[str(i)] for i in FIXTURE_IDS if str(i) in index})
    shutil.copyfile(REPO_ROOT / "id_counters.json", root / "id_counters.json")
    return root


def touch_later(path: Path) -> None:
    """Move a file's mtime forward, so a rewrite within the same clock tick is seen."""
    st = path.stat()
    os.utime(path, ns=(st.st_atime_ns, st.st_mtime_ns + 5_000_000_000))


def git(root: Path, *args: str) -> str:
    env = {
        **os.environ,
        "GIT_AUTHOR_NAME": "Test",
        "GIT_AUTHOR_EMAIL": "test@example.org",
        "GIT_COMMITTER_NAME": "Test",
        "GIT_COMMITTER_EMAIL": "test@example.org",
    }
    result = subprocess.run(["git", "-C", str(root), *args], capture_output=True, text=True, env=env, check=True)
    return result.stdout.strip()


def commit_all(root: Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-q", "--no-gpg-sign", "-m", message)
    return git(root, "rev-parse", "HEAD")
