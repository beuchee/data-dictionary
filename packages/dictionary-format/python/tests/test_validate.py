"""Adversarial and legacy shapes: what the schemas must reject, and accept."""

from __future__ import annotations

import copy
import re

import pytest

from conftest import read_bytes
from dictionary_format import DictionaryFormatError, assert_valid, format_issues, parse, validate, validate_file


def load(rel: str):
    return copy.deepcopy(parse(read_bytes(rel)))


def issue_at(issues, pointer):
    for issue in issues:
        if issue.pointer == pointer:
            return issue
    raise AssertionError(f"no issue at {pointer}:\n{format_issues(issues)}")


# --- rejected ---------------------------------------------------------------


def test_human_label_review_status():
    cs = load("concept_sets/1.json")
    cs["metadata"]["reviewStatus"] = "pending review"
    result = validate("concept-set", cs)
    assert not result.valid
    issue = issue_at(result.errors, "/metadata/reviewStatus")
    assert issue.kind == "concept-set" and issue.keyword == "enum"
    assert '"pending_review"' in issue.message and 'got "pending review"' in issue.message


def test_caption_as_standard_concept():
    cs = load("concept_sets/1.json")
    cs["expression"]["items"][0]["concept"]["standardConcept"] = "Standard"
    issue = issue_at(validate("concept-set", cs).errors, "/expression/items/0/concept/standardConcept")
    assert 'must be one of "S", "C", null, ""' in issue.message


def test_missing_unique_id():
    cs = load("concept_sets/1.json")
    del cs["metadata"]["uniqueId"]
    issue = issue_at(validate("concept-set", cs).errors, "/metadata")
    assert issue.keyword == "required"
    assert issue.message == 'missing required property "uniqueId"'


def test_malformed_unique_id():
    cs = load("concept_sets/1.json")
    cs["metadata"]["uniqueId"] = "not-a-uuid"
    assert "not-a-uuid" in issue_at(validate("concept-set", cs).errors, "/metadata/uniqueId").message


def test_wrong_group_rule():
    project = load("projects/1.json")
    project["groups"][0]["rule"] = "required_all"
    issue = issue_at(validate("project", project).errors, "/groups/0/rule")
    assert issue.message == 'must be one of "all_required", "at_least_one", "optional" (got "required_all")'


def test_bad_version_date_and_language_key():
    cs = load("concept_sets/1.json")
    cs["version"] = "v1.0"
    cs["modifiedDate"] = "2026-13-45"
    cs["metadata"]["translations"]["English"] = {"name": "x"}
    errors = validate("concept-set", cs).errors
    issue_at(errors, "/version")
    issue_at(errors, "/modifiedDate")
    assert any(e.keyword == "propertyNames" and "English" in e.message for e in errors)


def test_project_shapes():
    project = load("projects/1.json")
    project["groups"][0]["conceptSets"][0] = {"id": 1}
    issue_at(validate("project", project).errors, "/groups/0/conceptSets/0")
    del project["groups"]
    assert not validate("project", project).valid


def test_units_and_config():
    conv = load("units/unit_conversions.json")[:2]
    conv[1]["conversionFactor"] = "1.5"
    issue_at(validate("unit-conversions", conv).errors, "/1/conversionFactor")
    config = load("config.json")
    config["branding"]["colors"] = {"primary": "blue"}
    config["access"] = {"anonymousRead": "yes"}
    errors = validate("config", config).errors
    issue_at(errors, "/branding/colors/primary")
    issue_at(errors, "/access/anonymousRead")


def test_malformed_versions_index():
    assert len(validate("concept-sets-versions", {"1": {"1.0": "abc"}}).errors) >= 2


def test_assert_valid_raises():
    cs = load("concept_sets/1.json")
    cs["metadata"]["reviewStatus"] = "Approved"
    with pytest.raises(DictionaryFormatError, match=re.escape("concept_sets/1.json: 1 format error(s)\n  concept-set /metadata/reviewStatus: must be one of")):
        assert_valid("concept-set", cs, "concept_sets/1.json")


# --- legacy shapes accepted ---------------------------------------------------


def test_legacy_concept_set_shapes():
    cs = load("concept_sets/1.json")
    cs["metadata"]["organization"] = {"name": "Old Org", "url": "https://example.org"}
    del cs["metadata"]["sourceRepo"]
    del cs["metadata"]["origin"]
    cs["metadata"]["reviews"] = [
        {"reviewId": 1, "reviewer": {"firstName": "A", "lastName": "B"}, "reviewTimestamp": "2026-01-01T00:00:00.000Z", "comments": "", "version": "1.0.0"}
    ]
    concept = cs["expression"]["items"][0]["concept"]
    concept.update(standardConcept="", validStartDate="19700101", validEndDate="")
    assert format_issues(validate("concept-set", cs).errors) == ""


def test_organization_created_only():
    cs = load("concept_sets/1.json")
    del cs["metadata"]["organization"]["current"]
    assert validate("concept-set", cs).valid


def test_imported_set_with_origin():
    cs = load("concept_sets/1.json")
    cs["metadata"]["origin"] = {
        "uniqueId": cs["metadata"]["uniqueId"],
        "repo": "https://gitlab.com/other/dictionary",
        "version": "1.0.0",
        "commit": "ce8fd47179e877f3b338815a6c9ee226cac43311",
        "organization": {"name": "Other", "url": "https://other.org"},
        "importedDate": "2026-09-01",
    }
    assert validate("concept-set", cs).valid


def test_legacy_project_shapes():
    base = load("projects/1.json")
    rest = {k: v for k, v in base.items() if k != "groups"}
    assert validate("project", {**rest, "conceptSets": [{"id": 1, "version": "1.0.0"}]}).valid
    assert validate("project", {**rest, "conceptSetIds": [1, 2, 3]}).valid
    legacy_group = {"id": "g", "name": {"en": "Default", "fr": "Par défaut"}, "rule": "optional", "conceptSets": []}
    assert validate("project", {**rest, "groups": [legacy_group]}).valid


def test_config_legacy_github_and_v2_keys():
    config = load("config.json")
    config["github"] = config.pop("repository")
    assert validate("config", config).valid
    config["branding"].update(
        appName="My Dictionary",
        colors={"primary": "#1f6feb", "secondary": "#6e40c9", "accent": "#2ea44f"},
        darkColors={"primary": "#58a6ff"},
        font="Inter",
    )
    config["access"] = {"anonymousRead": False}
    assert format_issues(validate("config", config).errors) == ""


def test_resolved_without_vocabulary_version():
    resolved = load("concept_sets_resolved/1.json")
    resolved["vocabularyVersion"] = None
    resolved["resolvedConcepts"][0]["standardConcept"] = None
    assert validate("concept-set-resolved", resolved).valid


def test_unknown_fields_are_valid():
    cs = load("concept_sets/1.json")
    cs["forkField"] = 1
    cs["metadata"]["forkMeta"] = {"a": 1}
    cs["expression"]["items"][0]["concept"]["extra"] = "x"
    cs["metadata"]["translations"]["en"]["forkText"] = "y"
    assert validate("concept-set", cs).valid


def test_validate_file():
    assert validate_file("projects/2.json", read_bytes("projects/2.json")).valid
    with pytest.raises(ValueError, match="Not a dictionary content file"):
        validate_file("README.md", "{}")
