"""Provenance stamping: v1's rules (legacy/app.js stampModified,
normalizeConceptSetMeta, setSourceRepoOrdered, updateConceptSet; concept-sets.js
submitCreateCS and the root name/description mirroring)."""

import copy

from dictionary_format import RawFloat, parse, serialize

from app.services import forge
from app.services.provenance import (
    Instance,
    Submitter,
    is_reimport,
    mirror_root_from_english,
    normalize_concept_set_meta,
    only_reviews_appended,
    preserve_numbers,
    set_ordered,
    set_source_repo_ordered,
    stamp_concept_set,
    stamp_project,
    tool_tag,
)

from content_fixtures import REPO_ROOT, read_json

ORG = {"name": "My Org", "url": "https://my.org"}
INSTANCE = Instance(repo_url="https://gitlab.com/me/dict", organization=ORG, tool_tag=tool_tag("2.0.0"))
ALICE = Submitter(username="alice", first_name="Alice", last_name="Martin", orcid="0000-0001-2345-6789")


def test_normalize_flat_organization_and_default_source_repo():
    cs = {"metadata": {"uniqueId": "u", "organization": {"name": "Old", "url": "https://old"}, "reviewStatus": "draft"}}
    normalize_concept_set_meta(cs, "https://repo")
    org = {"name": "Old", "url": "https://old"}
    assert cs["metadata"]["organization"] == {"created": org, "current": org}
    assert list(cs["metadata"]) == ["uniqueId", "organization", "sourceRepo", "reviewStatus"]
    assert cs["metadata"]["sourceRepo"] == "https://repo"


def test_normalize_created_only_and_existing_source_repo():
    cs = {"metadata": {"organization": {"created": ORG}, "sourceRepo": "https://elsewhere"}}
    normalize_concept_set_meta(cs, "https://repo")
    assert cs["metadata"]["organization"] == {"created": ORG, "current": ORG}
    assert cs["metadata"]["sourceRepo"] == "https://elsewhere"


def test_source_repo_moves_after_organization_or_is_appended():
    m = {"sourceRepo": "x", "uniqueId": "u", "organization": {}, "reviewStatus": "draft"}
    set_source_repo_ordered(m, "y")
    assert list(m) == ["uniqueId", "organization", "sourceRepo", "reviewStatus"] and m["sourceRepo"] == "y"
    m = {"uniqueId": "u"}
    set_source_repo_ordered(m, "y")
    assert list(m) == ["uniqueId", "sourceRepo"]


def test_set_ordered_inserts_at_the_canonical_position():
    d = {"id": 1, "version": "1.0.0", "metadata": {}}
    set_ordered(d, "name", "N", ["id", "name", "description", "version", "metadata"])
    assert list(d) == ["id", "name", "version", "metadata"]
    set_ordered(d, "id", 2, ["id", "name"])
    assert list(d) == ["id", "name", "version", "metadata"] and d["id"] == 2
    d = {"b": 1}
    set_ordered(d, "a", 0, ["a", "b"])
    assert list(d) == ["a", "b"]


def test_mirror_root_from_english():
    cs = {"id": 1, "name": "old", "description": "old", "metadata": {"translations": {"en": {"name": "New"}}}}
    mirror_root_from_english(cs)
    assert cs["name"] == "New" and cs["description"] is None
    cs["metadata"]["translations"]["en"]["shortDescription"] = "Short"
    mirror_root_from_english(cs)
    assert cs["description"] == "Short"
    # No English: nothing to mirror (no cross-language fallback).
    fr_only = {"name": "x", "metadata": {"translations": {"fr": {"name": "Nouveau"}}}}
    mirror_root_from_english(fr_only)
    assert fr_only["name"] == "x"


def test_stamp_existing_set_freezes_lineage_and_authorship():
    base = read_json(REPO_ROOT / "concept_sets/1.json")
    draft = copy.deepcopy(base)
    draft["id"] = 99
    draft["createdBy"] = "Mallory"
    draft["metadata"]["uniqueId"] = "forged"
    draft["metadata"]["origin"] = {"repo": "forged"}
    draft["metadata"]["organization"] = {"created": {"name": "Forged", "url": ""}, "current": {}}
    draft["metadata"]["translations"]["en"]["name"] = "Renamed"
    stamp_concept_set(draft, cs_id=1, base=base, submitter=ALICE, instance=INSTANCE, today="2026-10-11")

    assert draft["id"] == 1
    assert draft["createdBy"] == base["createdBy"]
    assert draft["metadata"]["uniqueId"] == base["metadata"]["uniqueId"]
    assert draft["metadata"]["origin"] == base["metadata"]["origin"]
    created = normalize_concept_set_meta(copy.deepcopy(base), "")["metadata"]["organization"]["created"]
    assert draft["metadata"]["organization"] == {"created": created, "current": ORG}
    assert draft["metadata"]["sourceRepo"] == INSTANCE.repo_url
    assert (draft["modifiedBy"], draft["modifiedDate"], draft["name"]) == ("Alice Martin", "2026-10-11", "Renamed")
    assert list(draft) == list(base)
    assert list(draft["metadata"]) == list(base["metadata"])


def test_stamp_new_set_fills_the_skeleton_in_canonical_order():
    cs = {
        "expression": {"items": []},
        "metadata": {"translations": {"en": {"name": "Fresh", "shortDescription": "One line"}}},
    }
    stamp_concept_set(
        cs, cs_id=400, base=None, submitter=ALICE, instance=INSTANCE, today="2026-10-11", new_uuid=lambda: "uuid-1"
    )
    assert list(cs) == [
        "id", "name", "description", "version", "createdBy", "createdDate", "modifiedBy", "modifiedDate",
        "createdByTool", "expression", "metadata",
    ]  # fmt: skip
    assert cs["createdBy"] == cs["modifiedBy"] == "Alice Martin"
    assert cs["version"] == "1.0.0"
    assert cs["createdByTool"].startswith("INDICATE Data Dictionary v2.0.0")
    m = cs["metadata"]
    assert list(m) == [
        "uniqueId", "organization", "sourceRepo", "reviewStatus", "origin", "translations", "createdByDetails"
    ]  # fmt: skip
    assert m["uniqueId"] == "uuid-1" and m["origin"] is None and m["reviewStatus"] == "draft"
    assert m["organization"] == {"created": ORG, "current": ORG}
    assert m["createdByDetails"]["orcid"] == "0000-0001-2345-6789"


def test_stamp_imported_new_set_keeps_its_creator_org():
    source = {"name": "Source", "url": "https://source.org"}
    cs = {
        "metadata": {
            "uniqueId": "lineage",
            "organization": {"created": source, "current": source},
            "origin": {"repo": "https://source"},
            "translations": {"en": {"name": "Imported"}},
        }
    }
    stamp_concept_set(cs, cs_id=401, base=None, submitter=ALICE, instance=INSTANCE, today="2026-10-11")
    assert cs["metadata"]["uniqueId"] == "lineage"
    assert cs["metadata"]["organization"] == {"created": source, "current": ORG}
    assert cs["metadata"]["origin"] == {"repo": "https://source"}


def test_stamp_without_profile_name_uses_the_username():
    cs = {"metadata": {"translations": {}}}
    stamp_concept_set(cs, cs_id=1, base=None, submitter=Submitter("bob"), instance=INSTANCE, today="2026-01-01")
    assert cs["createdBy"] == cs["modifiedBy"] == "bob"


def test_stamp_project():
    base = read_json(REPO_ROOT / "projects/1.json")
    draft = copy.deepcopy(base)
    draft["createdBy"] = "Mallory"
    stamp_project(draft, project_id=1, base=base, submitter=ALICE, today="2026-10-11")
    assert draft["createdBy"] == base["createdBy"] and draft["modifiedDate"] == "2026-10-11"
    new = {"translations": {}, "groups": []}
    stamp_project(new, project_id=7, base=None, submitter=ALICE, today="2026-10-11")
    assert list(new) == ["id", "translations", "createdBy", "createdDate", "modifiedDate", "groups"]


def test_only_reviews_appended():
    base = read_json(REPO_ROOT / "concept_sets/1.json")
    draft = copy.deepcopy(base)
    assert not only_reviews_appended(base, draft)  # nothing appended
    draft["metadata"].setdefault("reviews", []).append({"reviewer": {}, "version": "1.0.0"})
    draft["modifiedDate"] = "2030-01-01"  # stamped anyway
    assert only_reviews_appended(base, draft)
    draft["metadata"]["reviewStatus"] = "approved"
    assert not only_reviews_appended(base, draft)
    edited = copy.deepcopy(base)
    edited["metadata"]["reviews"] = [{"reviewer": {}, "version": "1.0.0"}]  # rewrites history
    if base["metadata"].get("reviews"):
        assert not only_reviews_appended(base, edited)


def test_preserve_numbers_keeps_lexemes():
    base = parse('{"a": 1.0, "b": 0.10, "c": [2.5, 3], "d": 1}')
    new = {"a": 1, "b": 0.1, "c": [2.5, 3.0, 4], "d": 2, "e": 1.0}
    out = preserve_numbers(new, base)
    assert isinstance(out["b"], RawFloat)
    assert (
        serialize(out)
        == '{\n  "a": 1.0,\n  "b": 0.10,\n  "c": [\n    2.5,\n    3,\n    4\n  ],\n  "d": 2,\n  "e": 1.0\n}\n'
    )
    assert preserve_numbers(True, 1) is True


def test_forge_detection_and_repo_url():
    assert forge.forge_kind({"repository": {"url": "https://github.com/o/r"}}) == "github"
    assert forge.forge_kind({"repository": {"url": "https://framagit.org/o/r"}}) == "gitlab"
    assert forge.forge_kind({"repository": {"url": "https://code.example.org/o/r", "forge": "GitHub"}}) == "github"
    assert forge.forge_kind({"github": {"url": "https://gitlab.com/o/r"}}) == "gitlab"  # legacy key
    # v1 strips ".git" then trailing slashes, in that order.
    assert forge.config_repo_url({"repository": {"url": "https://github.com/o/r/"}}) == "https://github.com/o/r"
    assert forge.config_repo_url({"repository": {"url": "https://github.com/o/r.git"}}) == "https://github.com/o/r"
    assert forge.config_repo_url({"repository": {"repo": "o/r"}}) == "https://github.com/o/r"
    assert forge.config_repo_url({"repository": {"upstream": "https://x.org/o/r.git"}}) == "https://x.org/o/r"
    assert forge.api_base("github", "https://github.com/o/r") == "https://api.github.com"
    assert forge.api_base("github", "https://ghe.corp.org/o/r") == "https://ghe.corp.org/api/v3"
    assert forge.api_base("gitlab", "https://gitlab.example.org/g/s/p.git") == "https://gitlab.example.org/api/v4"
    assert forge.project_path("https://oauth2:x@gitlab.example.org/g/s/p.git") == "g/s/p"


def test_a_reimport_may_replace_the_frozen_origin():
    base = read_json(REPO_ROOT / "concept_sets/1.json")
    uid = base["metadata"]["uniqueId"]
    origin = {
        "uniqueId": uid,
        "repo": "https://gitlab.com/src/dict",
        "version": "9.0.0",
        "commit": "abc1234",
        "organization": None,
        "importedDate": "2026-10-11",
    }
    draft = copy.deepcopy(base)
    draft["version"] = "9.0.0"
    draft["metadata"]["origin"] = origin
    assert is_reimport(draft["metadata"], base["metadata"], "9.0.0")
    stamp_concept_set(draft, cs_id=1, base=base, submitter=ALICE, instance=INSTANCE, today="2026-10-11")
    assert draft["metadata"]["origin"] == origin
    assert draft["metadata"]["uniqueId"] == uid

    # Another lineage, or a version the draft does not carry: an edit, frozen.
    assert not is_reimport({"origin": {**origin, "uniqueId": "other"}}, base["metadata"], "9.0.0")
    assert not is_reimport({"origin": origin}, base["metadata"], "8.0.0")
    assert not is_reimport({"origin": base["metadata"].get("origin")}, base["metadata"], base["version"])
    edited = copy.deepcopy(base)
    edited["metadata"]["origin"] = {**origin, "version": "1.2.3"}
    stamp_concept_set(edited, cs_id=1, base=base, submitter=ALICE, instance=INSTANCE, today="2026-10-11")
    assert edited["metadata"].get("origin") == base["metadata"].get("origin")
