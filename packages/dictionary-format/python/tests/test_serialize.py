from __future__ import annotations

import copy
import json
import pickle

import pytest

from conftest import read_bytes
from dictionary_format import RawFloat, kind_for_path, parse, serialize, to_plain


def round_trip(text: str, kind=None) -> str:
    return serialize(parse(text), kind)


def test_matches_json_dumps_on_plain_values():
    v = {"a": 1, "b": [1, "x", None, True, {"c": []}, {}], "d": {"e": "é – 😀 中文"}, "f": -2.5e-7, "g": 1.5}
    assert serialize(v) == json.dumps(v, indent=2, ensure_ascii=False) + "\n"


def test_escapes_like_javascript():
    s = 'a"b\\c\n\r\t\b\f\u0001\u001f\u007f  😀 é'
    assert serialize(s, trailing_newline=False) == json.dumps(s, ensure_ascii=False)
    assert "\\u0001\\u001f" in serialize(s)
    lone = parse('"x\\ud800y\\udc00"')
    assert serialize(lone, trailing_newline=False) == '"x\\ud800y\\udc00"'


def test_refuses_non_finite_and_bad_keys():
    with pytest.raises(ValueError, match="non-finite"):
        serialize({"x": float("nan")})
    with pytest.raises(TypeError):
        serialize({1: "x"})


def test_per_kind_trailing_newline():
    assert serialize({}, "concept-set") == "{}\n"
    assert serialize({}, "concept-set-resolved") == "{}"
    assert serialize({}, "concept-set-resolved", trailing_newline=True) == "{}\n"


@pytest.mark.parametrize(
    "lexeme",
    ["1.0", "1000.0", "0.10", "1e-05", "1E+2", "1.5e300", "-0", "-0.0", "12345678901234567890", "0.1000000000000000055511151231257827"],
)
def test_number_lexemes_survive(lexeme):
    text = f'{{\n  "x": {lexeme},\n  "y": [\n    {lexeme}\n  ]\n}}\n'
    assert round_trip(text) == text


def test_numbers_stay_plain_unless_needed():
    v = parse('{"a": 1.5, "b": 1.0, "c": 3004410, "d": 0.10}')
    assert type(v["a"]) is float and type(v["b"]) is float and type(v["c"]) is int
    assert isinstance(v["d"], RawFloat) and v["d"].raw == "0.10" and v["d"] == 0.1
    assert v["d"] * 10 == 1.0
    assert type(to_plain(v)["d"]) is float


def test_raw_float_survives_copies():
    v = parse('{"d": 0.10}')
    for clone in (copy.copy(v), copy.deepcopy(v), pickle.loads(pickle.dumps(v))):
        assert serialize(clone) == '{\n  "d": 0.10\n}\n'


def test_unit_conversions_keep_their_lexemes():
    raw = read_bytes("units/unit_conversions.json").decode()
    assert '"conversionFactor": 1.0,' in raw and '"conversionFactor": 100,' in raw
    assert round_trip(raw, "unit-conversions") == raw


def test_parse_rejects_duplicates_and_nan():
    with pytest.raises(ValueError, match="Duplicate key"):
        parse('{"a": 1, "a": 2}')
    with pytest.raises(ValueError):
        parse('{"a": NaN}')


def test_unknown_fields_survive():
    cs = parse(read_bytes("concept_sets/1.json"))
    cs["forkField"] = {"nested": [1.0, "x"]}
    cs["expression"]["extraExpr"] = True
    cs["metadata"] = {"forkMeta": "kept", **cs["metadata"]}
    cs["expression"]["items"][0]["weight"] = RawFloat("2.50")
    text = serialize(cs, "concept-set")
    assert serialize(parse(text), "concept-set") == text
    assert '"weight": 2.50' in text
    assert text.index('"forkMeta"') < text.index('"uniqueId"')
    assert text.rstrip().endswith('"forkField": {\n    "nested": [\n      1.0,\n      "x"\n    ]\n  }\n}')


def test_kind_for_path():
    assert kind_for_path("concept_sets/12.json") == "concept-set"
    assert kind_for_path("concept_sets_resolved/12.json") == "concept-set-resolved"
    assert kind_for_path("projects\\3.json") == "project"
    assert kind_for_path("./config.json") == "config"
    assert kind_for_path("units/unit_conversions.json") == "unit-conversions"
    assert kind_for_path("concept_set.example.json") is None
    assert kind_for_path("concept_sets/abc.json") is None
