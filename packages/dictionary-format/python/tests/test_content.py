"""The contract against reality: every content file of this repository."""

from __future__ import annotations

from collections import Counter

import pytest

from conftest import NON_CANONICAL, read_bytes
from dictionary_format import format_issues, parse, serialize_bytes, validate


def test_covers_every_kind(files):
    counts = Counter(kind for _, kind in files)
    assert counts["concept-set"] > 300
    assert counts["concept-set-resolved"] == counts["concept-set"]
    assert counts["project"] > 0
    assert len(counts) == 9


def test_all_validate(files):
    failures = []
    for path, kind in files:
        result = validate(kind, parse(read_bytes(path)))
        if not result.valid:
            failures.append(f"{path}\n{format_issues(result.errors)}")
    assert failures == []


def test_round_trip_byte_for_byte(files):
    mismatches = [
        path
        for path, kind in files
        if path not in NON_CANONICAL and serialize_bytes(parse(read_bytes(path)), kind) != read_bytes(path)
    ]
    assert mismatches == []


@pytest.mark.parametrize("path", sorted(NON_CANONICAL))
def test_non_canonical_files_are_listed_and_stable(files, path):
    kind = dict(files)[path]
    raw = read_bytes(path)
    once = serialize_bytes(parse(raw), kind)
    assert once != raw, f"{path} is canonical now: drop it from fixtures/non-canonical.json"
    assert parse(once) == parse(raw)
    assert serialize_bytes(parse(once), kind) == once


def test_example_concept_set_validates():
    example = parse(read_bytes("concept_set.example.json"))
    # Its placeholder id 0 is the one thing a real file may not have.
    assert [e.pointer for e in validate("concept-set", example).errors] == ["/id"]
    assert format_issues(validate("concept-set", {**example, "id": 1}).errors) == ""
