"""The tiny ATHENA export of tests/fixtures/vocab/athena/, as files to import
and as ready DuckDB connections (see fixtures/vocab/make_fixture.py)."""

import json
from pathlib import Path

import duckdb

from app.services import vocabulary as lib

VOCAB_DIR = Path(__file__).resolve().parent / "fixtures" / "vocab"
ATHENA_DIR = VOCAB_DIR / "athena"
RESOLVE_CASES = json.loads((VOCAB_DIR / "resolve-cases.json").read_text(encoding="utf-8"))
SQL_GOLDEN = json.loads((VOCAB_DIR / "sql-golden.json").read_text(encoding="utf-8"))
ALL_VOCABULARIES = ["ICD10", "LOINC", "None", "RxNorm", "SNOMED", "UCUM"]


def export_files() -> list[tuple[str, str]]:
    return [(p.name, str(p)) for p in sorted(ATHENA_DIR.glob("*.csv"))]


def build_library() -> None:
    """Import every vocabulary of the fixture into the (temp) data dir's library."""
    files = export_files()
    found = lib.inspect_export(files)
    written = lib.write_partitions(files, ALL_VOCABULARIES)
    lib.record_import(found, written, "fixture")
    lib.get_library().invalidate()


def edges_connection() -> duckdb.DuckDBPyConnection:
    """The fixture as the browser holds it: concept_ancestor reduced to its
    direct parent-child rows."""
    con = duckdb.connect()
    for path in sorted(ATHENA_DIR.glob("*.csv")):
        table = path.stem.lower()
        # Typed as an import types them, so dates read the same on both sides.
        con.execute(f"CREATE TABLE {table} AS {lib._typed_select(con, table, [(path.name, str(path))])}")
    con.execute("DELETE FROM concept_ancestor WHERE min_levels_of_separation <> 1")
    return con
