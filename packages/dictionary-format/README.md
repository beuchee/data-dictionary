# @data-dictionary/format

The contract for the content files of a data dictionary repository (`concept_sets/`, `concept_sets_resolved/`, `projects/`, `units/`, `mapping_recommendations/`, `config.json`, `id_counters.json`, `concept_sets_versions.json`), shared by v1 (`legacy/`), v2 (`apps/`) and Linkr. One implementation per language, tested against each other and against every real file of the repo:

- `schemas/*.schema.json`: JSON Schema 2020-12, one per file kind. Objects are open: unknown fields are valid and must survive a rewrite. Legacy shapes still read by v1 and Linkr validate too (flat `organization`, flat project `conceptSets`, config `github`).
- TypeScript (`src/`, consumed as source, no build): `parse`, `serialize`, `validate`, `kindForPath`, types for every kind.
- Python (`python/`, package `dictionary_format`): `parse`, `serialize`, `serialize_bytes`, `validate`, `kind_for_path`.

## Round-trip rule

`serialize(parse(text), kind)` must return `text` byte for byte. The canonical form is `json.dumps(v, indent=2, ensure_ascii=False)`, which is also `JSON.stringify(v, null, 2)`, plus a final newline. The one exception is resolved concept sets, which `resolve.py` writes without the final newline. `parse` keeps number lexemes that one language can't print back: JS would print `1.0` as `1`, so the TS `parse` returns a `RawNumber` for it; for `0.10` and `1E+2`, Python returns a `RawFloat`. Files that aren't canonical today are listed with the reason in `fixtures/non-canonical.json` (both test suites read it). Today only `config.json` is listed: its `languages` array is written inline.

Writers (v2 API, scripts) should write through `serialize` and never call `json.dump` or `JSON.stringify` directly.

## Tests

```bash
# TypeScript (from packages/dictionary-format, after `npm install` at the repo root)
npx vitest run && npx tsc --noEmit

# Python (from the repo root). Includes the TS-vs-Python byte check, which runs Node >= 22.6.
uv run --with pytest --with jsonschema --with-editable packages/dictionary-format/python \
  pytest packages/dictionary-format/python/tests -q
```
