import pytest

from app.services.content_store import (
    ContentError,
    ContentStore,
    concept_set_summary,
    filter_resolved,
    find_content_root,
    git_blob,
    normalize_organization,
    version_history,
)

from content_fixtures import (
    build_content_dir,
    commit_all,
    git,
    make_resolved,
    read_json,
    touch_later,
    write_json,
)


@pytest.fixture
def content(tmp_path):
    return build_content_dir(tmp_path / "content")


@pytest.fixture
def store(content):
    return ContentStore(content, check_interval=0)


# --- loading ----------------------------------------------------------------


def test_loads_the_catalogue(store):
    catalogue = store.catalogue()
    assert sorted(catalogue.concept_sets) == [1, 2, 3]
    assert list(catalogue.projects) == [1]
    assert catalogue.config["title"]
    assert len(catalogue.recommended_units) == 3
    assert len(catalogue.unit_conversions) == 3
    assert "en" in catalogue.mapping_recommendations["translations"]
    assert set(catalogue.versions_index) <= {"1", "2", "3"}
    assert catalogue.id_counters["nextConceptSetId"] > 3
    assert catalogue.issues == []
    assert catalogue.anonymous_read is True


def test_summaries_count_items_and_resolved_concepts(store, content):
    summaries = {s["id"]: s for s in store.catalogue().summaries}
    cs1 = read_json(content / "concept_sets/1.json")
    resolved1 = read_json(content / "concept_sets_resolved/1.json")
    assert summaries[1]["itemCount"] == len(cs1["expression"]["items"])
    assert summaries[1]["resolvedCount"] == len(resolved1["resolvedConcepts"])
    assert summaries[3]["resolvedCount"] == 25
    assert summaries[1]["translations"]["en"]["name"] == cs1["metadata"]["translations"]["en"]["name"]
    assert set(summaries[1]["translations"]["en"]) == {"name", "category", "subcategory", "shortDescription"}
    assert summaries[1]["organization"]["current"]["name"]


def test_summary_of_a_set_without_resolved_file_has_no_count():
    cs = {"id": 9, "version": "1.0.0", "expression": {"items": []}, "metadata": {"translations": {"fr": {"name": "X"}}}}
    summary = concept_set_summary(cs, None)
    assert summary["resolvedCount"] is None
    assert summary["itemCount"] == 0
    # No cross-language fallback: only the languages the file has.
    assert list(summary["translations"]) == ["fr"]


def test_normalize_organization_reads_the_legacy_flat_shape():
    flat = {"name": "A", "url": None}
    assert normalize_organization(flat) == {"created": flat, "current": flat}
    created = {"name": "A"}
    assert normalize_organization({"created": created}) == {"created": created, "current": created}
    assert normalize_organization(None) is None


def test_reports_invalid_files_and_skips_unparsable_ones(content):
    (content / "concept_sets/4.json").write_text("{not json")
    cs2 = read_json(content / "concept_sets/2.json")
    cs2["metadata"]["reviewStatus"] = "pending review"
    write_json(content / "concept_sets/2.json", cs2)
    catalogue = ContentStore(content, check_interval=0).catalogue()
    assert 4 not in catalogue.concept_sets
    assert 2 in catalogue.concept_sets
    assert any(i.startswith("concept_sets/4.json") for i in catalogue.issues)
    assert any(i.startswith("concept_sets/2.json") and "reviewStatus" in i for i in catalogue.issues)


def test_ignores_files_that_are_not_id_named(content):
    write_json(content / "concept_sets/notes.json", {"x": 1})
    assert sorted(ContentStore(content, check_interval=0).catalogue().concept_sets) == [1, 2, 3]


def test_missing_content_dir_raises(tmp_path):
    with pytest.raises(ContentError):
        ContentStore(tmp_path / "nope").catalogue()


def test_missing_config_raises(content):
    (content / "config.json").unlink()
    with pytest.raises(ContentError):
        ContentStore(content).catalogue()


def test_anonymous_read_follows_config(tmp_path):
    off = ContentStore(build_content_dir(tmp_path / "off", anonymous_read=False)).catalogue()
    assert off.anonymous_read is False


def test_find_content_root_walks_up(content):
    nested = content / "a" / "b"
    nested.mkdir(parents=True)
    assert find_content_root(nested) == content
    assert find_content_root(content.parent) is None


# --- invalidation -----------------------------------------------------------


def test_reloads_after_a_file_changes(store, content):
    first = store.catalogue()
    assert store.catalogue() is first  # unchanged: cached
    cs = read_json(content / "concept_sets/1.json")
    cs["name"] = "Renamed"
    write_json(content / "concept_sets/1.json", cs)
    touch_later(content / "concept_sets/1.json")
    second = store.catalogue()
    assert second is not first
    assert second.concept_sets[1]["name"] == "Renamed"


def test_reloads_after_a_file_is_added_or_removed(store, content):
    store.catalogue()
    (content / "concept_sets/3.json").unlink()
    assert sorted(store.catalogue().concept_sets) == [1, 2]


def test_check_interval_throttles_the_scan(content):
    store = ContentStore(content, check_interval=3600)
    first = store.catalogue()
    (content / "concept_sets/3.json").unlink()
    assert store.catalogue() is first
    store.invalidate()
    assert 3 not in store.catalogue().concept_sets


def test_resolved_is_read_on_demand_and_refreshed(store, content):
    assert len(store.resolved(3)["resolvedConcepts"]) == 25
    assert store.resolved(3) is store.resolved(3)
    write_json(content / "concept_sets_resolved/3.json", make_resolved(3, 4), "concept-set-resolved")
    touch_later(content / "concept_sets_resolved/3.json")
    assert len(store.resolved(3)["resolvedConcepts"]) == 4
    assert store.resolved(99) is None


# --- helpers ----------------------------------------------------------------


def test_filter_resolved_matches_id_name_code_and_vocabulary():
    concepts = make_resolved(1, 6)["resolvedConcepts"]
    assert len(filter_resolved(concepts, None)) == 6
    assert len(filter_resolved(concepts, "  ")) == 6
    assert [c["conceptId"] for c in filter_resolved(concepts, "GLUCOSE")] == [1001, 1003, 1005]
    assert [c["conceptId"] for c in filter_resolved(concepts, "1004")] == [1004]
    assert [c["conceptId"] for c in filter_resolved(concepts, "2-0")] == [1002]
    assert len(filter_resolved(concepts, "loinc")) == 6
    assert filter_resolved(concepts, "nothing") == []


def test_version_history_merges_index_metadata_and_current():
    cs = {
        "version": "1.10.0",
        "metadata": {
            "versions": [
                {"version": "1.0.0", "date": "2026-01-01", "author": "A", "message": "Initial"},
                {"version": "1.10.0", "date": "2026-03-01", "author": "B", "message": "Bump"},
            ]
        },
    }
    history = version_history(cs, {"1.0.0": "a" * 40, "1.2.0": "b" * 40})
    assert [h["version"] for h in history] == ["1.10.0", "1.2.0", "1.0.0"]
    assert history[0] == {
        "version": "1.10.0",
        "commit": None,
        "isCurrent": True,
        "date": "2026-03-01",
        "author": "B",
        "message": "Bump",
    }
    assert history[1]["commit"] == "b" * 40 and history[1]["message"] is None
    assert history[2]["message"] == "Initial"


def test_version_history_sorts_prereleases_before_their_release():
    history = version_history({"version": "2.0.0"}, {"2.0.0-rc.1": "c" * 40, "1.9.9": "d" * 40})
    assert [h["version"] for h in history] == ["2.0.0", "2.0.0-rc.1", "1.9.9"]


# --- past versions from git -------------------------------------------------


@pytest.fixture
def history_repo(content):
    """A git repo where concept set 3 went 1.0.0 (25 resolved) → 2.0.0 (4 resolved)."""
    git(content, "init", "-q")
    cs = read_json(content / "concept_sets/3.json")
    cs["version"] = "1.0.0"
    cs["name"] = "Old name"
    write_json(content / "concept_sets/3.json", cs)
    sha1 = commit_all(content, "v1")
    cs["version"] = "2.0.0"
    cs["name"] = "New name"
    write_json(content / "concept_sets/3.json", cs)
    write_json(content / "concept_sets_resolved/3.json", make_resolved(3, 4), "concept-set-resolved")
    sha2 = commit_all(content, "v2")
    index = read_json(content / "concept_sets_versions.json")
    index["3"] = {"1.0.0": sha1, "2.0.0": sha2, "1.5.0": "not-a-sha"}
    write_json(content / "concept_sets_versions.json", index)
    return content, sha1, sha2


def test_reads_a_past_version_from_git(history_repo):
    content, sha1, _ = history_repo
    store = ContentStore(content, check_interval=0)
    assert store.history_available()
    old = store.concept_set(3, "1.0.0")
    assert old["name"] == "Old name" and old["version"] == "1.0.0"
    assert len(store.resolved_at(3, "1.0.0")["resolvedConcepts"]) == 25
    # The current version is served from disk, not git.
    assert store.concept_set(3, "2.0.0") is store.catalogue().concept_sets[3]
    assert len(store.resolved_at(3)["resolvedConcepts"]) == 4
    assert store.version_commit(3, "1.0.0") == sha1


def test_past_versions_are_cached(history_repo, monkeypatch):
    content, *_ = history_repo
    store = ContentStore(content, check_interval=0)
    first = store.concept_set(3, "1.0.0")
    monkeypatch.setattr("app.services.content_store.git_blob", lambda *a: pytest.fail("not cached"))
    assert store.concept_set(3, "1.0.0") is first


def test_unknown_or_unindexed_versions_are_none(history_repo):
    content, *_ = history_repo
    store = ContentStore(content, check_interval=0)
    assert store.concept_set(3, "9.9.9") is None
    assert store.concept_set(3, "1.5.0") is None  # indexed with an invalid sha
    assert store.concept_set(42, "1.0.0") is None
    assert store.concept_set(42) is None


def test_a_version_whose_resolved_file_did_not_exist_yet_is_none(history_repo):
    content, *_ = history_repo
    git(content, "rm", "-q", "concept_sets_resolved/1.json")
    sha = commit_all(content, "drop resolved 1")
    index = read_json(content / "concept_sets_versions.json")
    index["1"] = {"0.9.0": sha}
    write_json(content / "concept_sets_versions.json", index)
    store = ContentStore(content, check_interval=0)
    assert store.concept_set(1, "0.9.0") is not None
    assert store.resolved_at(1, "0.9.0") is None


def test_history_is_unavailable_outside_git(content):
    store = ContentStore(content, check_interval=0)
    index = read_json(content / "concept_sets_versions.json")
    index["3"] = {"0.1.0": "a" * 40}
    write_json(content / "concept_sets_versions.json", index)
    assert store.concept_set(3, "0.1.0") is None


@pytest.mark.parametrize(
    "sha,path",
    [
        ("HEAD", "concept_sets/1.json"),
        ("--output=x", "concept_sets/1.json"),
        ("a" * 40 + ";rm", "concept_sets/1.json"),
        ("a" * 40, "../secret.json"),
        ("a" * 40, "concept_sets/0.json"),
        ("a" * 40, "concept_sets/1.json:x"),
        ("a" * 40, "/etc/passwd"),
    ],
)
def test_git_blob_refuses_unvalidated_arguments(content, sha, path):
    with pytest.raises(ValueError):
        git_blob(content, sha, path)
