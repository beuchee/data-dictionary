"""The mapping-import parsers against the fixtures shared with the TS twin
(tests/fixtures/mappings: cases.json → expected/<name>.json, written from the TS
implementation), plus unit cases for the pieces a fixture cannot isolate."""

import io
import json
import zipfile
from pathlib import Path

import pytest

from app.services.mapping_import import (
    InputFile,
    MappingImportError,
    detect_format,
    expand_files,
    guess_roles,
    parse_mapping,
)
from app.services.mapping_import.text import decode, detect_delimiter, parse_delimited
from app.services.mapping_import.values import MAX_CONCEPT_ID, parse_frequency, parse_id, parse_targets

ROOT = Path(__file__).resolve().parent / "fixtures" / "mappings"
CASES = json.loads((ROOT / "cases.json").read_text(encoding="utf-8"))


def _load(case: dict) -> list[InputFile]:
    return [InputFile(Path(f).name, (ROOT / "inputs" / f).read_bytes()) for f in case["files"]]


@pytest.mark.parametrize("case", CASES, ids=[c["name"] for c in CASES])
def test_fixture_matches_ts(case: dict) -> None:
    files = _load(case)
    actual: dict = {}
    if case.get("detect"):
        actual["detect"] = detect_format(expand_files(files))
        assert actual["detect"]["format"] == case["detect"]
    try:
        actual["result"] = parse_mapping(files, case["options"])
    except MappingImportError as e:
        actual["error"] = e.code
    assert actual.get("error") == case.get("error")
    expected = json.loads((ROOT / "expected" / f"{case['name']}.json").read_text(encoding="utf-8"))
    assert json.loads(json.dumps(actual)) == expected


def test_delimiter_detection() -> None:
    assert detect_delimiter("a;b;c\n1;2;3") == ";"
    assert detect_delimiter("a\tb,c\tx") == "\t"
    assert detect_delimiter('"a,b";c;d') == ";"
    assert detect_delimiter("\t\t\n\na,b") == ","
    assert detect_delimiter("single") == ","


def test_quotes_only_open_at_field_start() -> None:
    assert parse_delimited('a,5" tube,"x,""y"""\n', ",") == [["a", '5" tube', 'x,"y"']]
    assert parse_delimited('"multi\nline",b\r\n\r\n,\n', ",") == [["multi\nline", "b"]]


def test_decoding() -> None:
    assert decode(b"\xef\xbb\xbfabc") == "abc"
    assert decode("é".encode("cp1252")) == "é"
    assert decode(b"\x81") == "\x81"  # undefined in cp1252: the browser's C1 control
    assert decode(b"\xff\xfea\x00") == "a"


def test_ids_and_targets() -> None:
    assert parse_id("3027018.0") == 3027018
    assert parse_id("1e3") is None
    assert parse_id("-5") is None
    assert parse_id(str(MAX_CONCEPT_ID + 1)) is None
    assert parse_id(True) is None
    assert parse_targets("1; 2,2 | 3").ids == [1, 2, 3]
    assert parse_targets("0").unmapped and not parse_targets("0").invalid
    t = parse_targets("4, x")
    assert t.ids == [4] and t.invalid
    assert parse_frequency("12.0") == 12 and isinstance(parse_frequency("12.0"), int)
    assert parse_frequency("<5") is None


def test_guess_roles_uses_each_header_once() -> None:
    assert guess_roles(["concept_id", "code", "name"]) == {
        "targetConceptId": "concept_id",
        "sourceCode": "code",
        "sourceName": "name",
    }


def test_zip_bomb_guard(monkeypatch) -> None:
    import app.services.mapping_import as mi

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("big.csv", "0" * 10_000)
    monkeypatch.setattr(mi, "MAX_UNZIPPED_BYTES", 1000)
    with pytest.raises(MappingImportError) as e:
        expand_files([InputFile("a.zip", buf.getvalue())])
    assert e.value.code == "bad_zip"
