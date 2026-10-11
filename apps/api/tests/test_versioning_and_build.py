"""versioning.py and catalog_build.py: unit behaviour, and parity with the
reference scripts (tests/fixtures/reference_scripts: build.py and snapshot.py
as they were before the shared implementation) on temporary repositories.
Also runs the root build.py / snapshot.py wrappers, which load these modules."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

from app.services import catalog_build, versioning

from content_fixtures import REPO_ROOT, build_content_dir, make_resolved
from git_fixtures import commit_all, git, read, write

REFERENCE = Path(__file__).parent / "fixtures" / "reference_scripts"
SERVICES = Path(__file__).resolve().parents[1] / "app" / "services"


def _set_version(root: Path, cs_id: int, version: str) -> None:
    path = root / f"concept_sets/{cs_id}.json"
    write(path, {**read(path), "version": version}, "concept-set")


@pytest.fixture
def history(tmp_path) -> Path:
    """A repo where set 1 went 1.0.0 → 1.1.0 → 2.0.0 (only 1.0.0 indexed, at
    HEAD of its time), set 2 was deleted after 1.0.0, a project pins set 1 at
    1.1.0, and set 3's resolved list is large enough to be deferred."""
    root = build_content_dir(tmp_path / "repo")
    write(root / "concept_sets_versions.json", {}, "concept-sets-versions")
    write(root / "concept_sets_resolved/3.json", make_resolved(3, 150), "concept-set-resolved")
    for cs_id in (1, 2, 3):
        _set_version(root, cs_id, "1.0.0")
    project = read(root / "projects/1.json")
    project["groups"] = [{"id": 1, "conceptSets": [{"id": 1, "version": "1.1.0"}, {"id": 3, "version": "1.0.0"}]}]
    write(root / "projects/1.json", project, "project")
    git(root, "init", "-q", "-b", "main")
    first = commit_all(root, "Initial")
    write(root / "concept_sets_versions.json", {"1": {"1.0.0": first}}, "concept-sets-versions")
    commit_all(root, "Index 1.0.0")
    _set_version(root, 1, "1.1.0")
    commit_all(root, "Set 1 v1.1.0")
    (root / "concept_sets/2.json").unlink()
    commit_all(root, "Delete set 2")
    _set_version(root, 1, "2.0.0")
    commit_all(root, "Set 1 v2.0.0")
    return root


def _clone(src: Path, dst: Path) -> Path:
    git(src.parent, "clone", "-q", str(src), str(dst))
    return dst


def _run(script_dir: Path, *args: str) -> str:
    result = subprocess.run([sys.executable, *args], cwd=script_dir, capture_output=True, text=True, check=True)
    return result.stdout


def _install_reference(root: Path) -> None:
    for name in ("build.py", "snapshot.py"):
        shutil.copyfile(REFERENCE / name, root / name)
    (root / "legacy").mkdir(exist_ok=True)


def _install_wrappers(root: Path) -> None:
    for name in ("build.py", "snapshot.py"):
        shutil.copyfile(REPO_ROOT / name, root / name)
    services = root / "apps/api/app/services"
    services.mkdir(parents=True, exist_ok=True)
    for name in ("versioning.py", "catalog_build.py"):
        shutil.copyfile(SERVICES / name, services / name)


def _without_data_version(text: str) -> dict:
    data = json.loads(text)
    data.pop("dataVersion")
    return data


# --- versioning ---------------------------------------------------------------


def test_snapshot_head_stamps_new_pairs_and_skips_dirty_files(history):
    result = versioning.snapshot_head(history, write=False)
    head = git(history, "rev-parse", "HEAD")
    assert result.sha == head
    assert set(result.added) == {(1, "2.0.0"), (3, "1.0.0")}

    _set_version(history, 3, "1.0.1")
    result = versioning.snapshot_head(history)
    assert (3, "1.0.1") not in result.added
    assert any("concept_sets/3.json" in w for w in result.warnings)
    index = versioning.load_index(history)
    assert index["1"] == {"1.0.0": git(history, "rev-list", "--max-parents=0", "HEAD"), "2.0.0": head}


def test_backfill_finds_introducing_commits_and_never_repoints(history):
    log = git(history, "log", "--format=%H %s").splitlines()
    sha_of = {line.split(" ", 1)[1]: line.split(" ", 1)[0] for line in log}
    # Pretend 1.0.0 was indexed at a later commit: a divergence, left alone.
    write(history / "concept_sets_versions.json", {"1": {"1.0.0": sha_of["Index 1.0.0"]}}, "concept-sets-versions")

    result = versioning.backfill(history)
    added = {(k, v): sha for k, v, sha, _ in result.added}
    assert added == {
        ("1", "1.1.0"): sha_of["Set 1 v1.1.0"],
        ("1", "2.0.0"): sha_of["Set 1 v2.0.0"],
        ("2", "1.0.0"): sha_of["Initial"],  # a deleted set is still indexed
        ("3", "1.0.0"): sha_of["Initial"],
    }
    assert result.divergences == [("1", "1.0.0", sha_of["Index 1.0.0"], sha_of["Initial"])]
    assert versioning.load_index(history)["1"]["1.0.0"] == sha_of["Index 1.0.0"]
    # Idempotent.
    assert versioning.backfill(history).added == []


def test_index_bytes_are_canonical_and_sorted():
    raw = versioning.index_bytes({"10": {"1.1.0": "b", "1.0.0": "a"}, "9": {"1.0.0": "c"}})
    assert raw.decode() == (
        '{\n  "9": {\n    "1.0.0": "c"\n  },\n  "10": {\n    "1.0.0": "a",\n    "1.1.0": "b"\n  }\n}\n'
    )
    from dictionary_format import serialize

    assert raw.decode() == serialize(json.loads(raw), "concept-sets-versions")


@pytest.mark.parametrize("mode", [[], ["--backfill"]])
def test_snapshot_cli_parity_with_reference(history, tmp_path, mode):
    ref = _clone(history, tmp_path / "ref")
    new = _clone(history, tmp_path / "new")
    _install_reference(ref)
    _install_wrappers(new)
    out_ref = _run(ref, "snapshot.py", *mode)
    out_new = _run(new, "snapshot.py", *mode)
    assert out_new == out_ref
    assert (new / "concept_sets_versions.json").read_bytes() == (ref / "concept_sets_versions.json").read_bytes()


def test_snapshot_cli_dry_run_writes_nothing(history, tmp_path):
    new = _clone(history, tmp_path / "new")
    _install_wrappers(new)
    before = (new / "concept_sets_versions.json").read_bytes()
    out = _run(new, "snapshot.py", "--backfill", "--dry-run", "--show-divergences")
    assert "Would add 4 missing" in out
    assert "[deleted file]" in out
    assert (new / "concept_sets_versions.json").read_bytes() == before


# --- catalog build ------------------------------------------------------------


def test_build_parity_with_reference(history, tmp_path):
    ref = _clone(history, tmp_path / "ref")
    new = _clone(history, tmp_path / "new")
    _install_reference(ref)
    _install_wrappers(new)
    # Index 1.1.0 so the pinned version is embedded (both sides read the same index).
    for root in (ref, new):
        versioning.backfill(root)
        commit_all(root, "Backfill")
    # A counter too low: both bump it.
    for root in (ref, new):
        write(root / "id_counters.json", {"nextConceptSetId": 2, "nextProjectId": 1}, "id-counters")
        commit_all(root, "Low counters")

    out_ref = _run(ref, "build.py")
    out_new = _run(new, "build.py")
    assert out_new == out_ref

    data_ref = _without_data_version((ref / "legacy/data.json").read_text(encoding="utf-8"))
    data_new = _without_data_version((new / "legacy/data.json").read_text(encoding="utf-8"))
    assert data_new == data_ref
    assert data_new["conceptSetVersions"]["1"]["1.1.0"]["version"] == "1.1.0"
    assert any(r.get("resolvedDeferred") for r in data_new["resolvedConceptSets"])

    inline_ref = (ref / "legacy/data_inline.js").read_text(encoding="utf-8")
    inline_new = (new / "legacy/data_inline.js").read_text(encoding="utf-8")
    assert _without_data_version(inline_new[len("const DATA=") : -1]) == _without_data_version(
        inline_ref[len("const DATA=") : -1]
    )
    for rel in ("legacy/resolved_concept_ids.json", "id_counters.json", "concept_sets_versions.json"):
        assert (new / rel).read_bytes() == (ref / rel).read_bytes(), rel
    assert sorted(p.name for p in (new / "legacy/concept_sets_resolved").iterdir()) == sorted(
        p.name for p in (ref / "legacy/concept_sets_resolved").iterdir()
    )


def test_build_payload_matches_data_json(history, tmp_path):
    """The API service gives the same payload as the files build.py writes."""
    ref = _clone(history, tmp_path / "ref")
    _install_reference(ref)
    _run(ref, "build.py")
    result = catalog_build.build_payload(ref, data_version="X")
    expected = _without_data_version((ref / "legacy/data.json").read_text(encoding="utf-8"))
    payload = json.loads(catalog_build.compact_json(result.data))
    payload.pop("dataVersion")
    assert payload == expected


def test_build_payload_without_config_fails(tmp_path):
    with pytest.raises(catalog_build.BuildError):
        catalog_build.build_payload(tmp_path)
