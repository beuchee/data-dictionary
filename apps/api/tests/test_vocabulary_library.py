# Adapted from linkr@1310cf4a4 apps/api/tests/test_vocabulary_library.py
"""The vocabulary library: an ATHENA export split by vocabulary, one version of
each held at a time, read back through views."""

import errno
import os
from pathlib import Path

import duckdb
import pytest

from app.config import settings
from app.services import vocabulary as lib

from vocab_fixtures import ALL_VOCABULARIES, ATHENA_DIR, export_files


def _union(table: str) -> str:
    files = [p for n, p in lib.library_files() if n.startswith(f"{table}/")]
    return f"read_parquet([{', '.join(repr(p) for p in files)}], union_by_name=true)"


def _copy_export(tmp_path: Path, **overrides: str) -> list[tuple[str, str]]:
    d = tmp_path / "export"
    d.mkdir(exist_ok=True)
    out = []
    for name, path in export_files():
        text = Path(path).read_text(encoding="utf-8")
        for old, new in overrides.items():
            text = text.replace(old, new)
        (d / name).write_text(text, encoding="utf-8")
        out.append((name, str(d / name)))
    return out


def test_inspect_reads_versions_and_counts():
    found = lib.inspect_export(export_files())
    assert found["release"] == "v5.0 01-SEP-26"
    assert "concept_synonym" in found["tables"]
    by_id = {v["vocabularyId"]: (v["vocabularyVersion"], v["conceptCount"]) for v in found["vocabularies"]}
    assert by_id["LOINC"] == ("LOINC 2.81", 4)
    assert by_id["ICD10"] == ("2021 Release", 3)
    assert sorted(by_id) == ALL_VOCABULARIES


def test_inspect_needs_a_concept_table():
    files = [(n, p) for n, p in export_files() if n != "CONCEPT.csv"]
    with pytest.raises(ValueError):
        lib.inspect_export(files)


def test_partitions_follow_the_owning_concept():
    written = lib.write_partitions(export_files(), ["LOINC", "SNOMED"])
    counts = {w["vocabularyId"]: w["rowCounts"] for w in written}
    assert counts["LOINC"]["concept"] == 4
    # 310 → itself and 3 tests, 300-302 → themselves.
    assert counts["LOINC"]["concept_ancestor"] == 7
    names = {n for n, _ in lib.library_files()}
    assert "concept/vocab-LOINC.parquet" in names and "relationship/shared.parquet" in names
    rows = duckdb.sql(
        f"SELECT concept_id, concept_name, valid_start_date FROM {_union('concept')} ORDER BY 1"
    ).fetchall()
    assert (112, "Ménière's disease") in [(r[0], r[1]) for r in rows]
    assert str(rows[0][2]) == "1970-01-01"
    # ICD10 was not imported: its concepts and the rows they own are not there.
    assert not [r for r in rows if r[0] in (200, 201, 202)]
    rel = duckdb.sql(f"SELECT DISTINCT concept_id_1 FROM {_union('concept_relationship')}").fetchall()
    assert (200,) not in rel


def test_reimport_replaces_only_the_chosen_vocabulary(tmp_path):
    lib.write_partitions(export_files(), ["LOINC", "SNOMED"])
    newer = _copy_export(tmp_path, **{"Heart rate --resting": "Resting heart rate", "Heart attack": "MI"})
    lib.write_partitions(newer, ["SNOMED"])
    names = dict(duckdb.sql(f"SELECT concept_id, concept_name FROM {_union('concept')}").fetchall())
    # LOINC kept its old rows; SNOMED's synonyms are the new ones.
    assert names[301] == "Heart rate --resting"
    synonyms = {r[0] for r in duckdb.sql(f"SELECT concept_synonym_name FROM {_union('concept_synonym')}").fetchall()}
    assert "MI" in synonyms and "Heart attack" not in synonyms
    lib.remove_partitions("SNOMED")
    assert sorted(n for n, _ in lib.library_files() if n.startswith("concept/")) == ["concept/vocab-LOINC.parquet"]


def test_a_vocabulary_named_like_a_table_stays_a_partition(tmp_path):
    files = _copy_export(tmp_path, **{"\tUCUM\t": "\tDomain\t"})
    lib.write_partitions(files, ["Domain"])
    names = {n for n, _ in lib.library_files()}
    assert "concept/vocab-Domain.parquet" in names and "domain/shared.parquet" in names


def test_import_never_renames_across_filesystems(monkeypatch):
    # Deployed, the data dir is a volume and /tmp another filesystem: a rename
    # between them fails with EXDEV. Draw that boundary at the data dir.
    real_replace = os.replace
    data = settings.data_path.resolve()

    def replace(src, dst, **kw):
        if Path(src).resolve().is_relative_to(data) != Path(dst).resolve().is_relative_to(data):
            raise OSError(errno.EXDEV, "Invalid cross-device link", str(src))
        return real_replace(src, dst, **kw)

    monkeypatch.setattr(os, "replace", replace)
    lib.write_partitions(export_files(), ["LOINC", "SNOMED"])
    assert "concept_ancestor" in lib.present_tables()


def test_a_parquet_export_reads_like_a_csv_one(tmp_path):
    files = []
    for name, path in export_files():
        out = tmp_path / f"{Path(name).stem.lower()}.parquet"
        duckdb.sql(
            f"COPY (SELECT * FROM read_csv('{path}', delim='\\t', quote='', header=true)) TO '{out}' (FORMAT PARQUET)"
        )
        files.append((out.name, str(out)))
    lib.write_partitions(files, ["SNOMED"])
    assert duckdb.sql(f"SELECT COUNT(*) FROM {_union('concept')}").fetchone()[0] == 17


def test_a_failed_import_leaves_the_library_as_it_was(tmp_path):
    lib.write_partitions(export_files(), ["LOINC"])
    before = {n for n, _ in lib.library_files()}
    broken = [(n, p) for n, p in export_files() if n != "CONCEPT_ANCESTOR.csv"]
    broken.append(("CONCEPT_ANCESTOR.csv", str(tmp_path / "missing.csv")))
    with pytest.raises(OSError):
        lib.write_partitions(broken, ["LOINC"])
    assert {n for n, _ in lib.library_files()} == before
    assert not any((lib.vocabulary_root() / ".staging").iterdir())


def test_glob_characters_are_never_read_as_patterns(tmp_path):
    odd = tmp_path / "CONCEPT[1].csv"
    odd.write_text((ATHENA_DIR / "CONCEPT.csv").read_text(encoding="utf-8"), encoding="utf-8")
    assert lib.group_export_files([("CONCEPT[1].csv", str(odd))]) == {}


# --- Sources ----------------------------------------------------------------------------------


@pytest.fixture
def import_root(tmp_path, monkeypatch):
    root = tmp_path / "athena-root"
    (root / "release").mkdir(parents=True)
    for name, path in export_files():
        (root / "release" / name).write_bytes(Path(path).read_bytes())
    monkeypatch.setattr(settings, "vocabulary_import_roots", str(root))
    return root


def test_server_folder_lists_the_export(import_root):
    files = lib.server_folder_files(str(import_root / "release"))
    assert sorted(n for n, _ in files) == sorted(n for n, _ in export_files())


@pytest.mark.parametrize(
    "path",
    ["relative/release", "/etc", "{root}/../", "{root}/release/../../", "{root}/release/CONCEPT.csv", "{root}/\0x"],
)
def test_server_folder_refuses_paths_outside_the_roots(import_root, path):
    with pytest.raises(lib.SourceError):
        lib.server_folder_files(path.format(root=import_root))


def test_server_folder_ignores_links_leaving_the_root(import_root, tmp_path):
    outside = tmp_path / "secret"
    outside.mkdir()
    (outside / "CONCEPT_SYNONYM.csv").write_text("concept_id\tconcept_synonym_name\tlanguage_concept_id\n")
    (import_root / "release" / "extra").mkdir()
    os.symlink(outside / "CONCEPT_SYNONYM.csv", import_root / "release" / "extra" / "CONCEPT_SYNONYM.csv")
    os.symlink(outside, import_root / "escape")
    files = lib.server_folder_files(str(import_root / "release"))
    assert all(str(outside) not in p for _, p in files)
    with pytest.raises(lib.SourceError):
        lib.server_folder_files(str(import_root / "escape"))


def test_server_folders_are_off_without_roots(monkeypatch):
    monkeypatch.setattr(settings, "vocabulary_import_roots", "")
    with pytest.raises(lib.SourceError):
        lib.server_folder_files("/")


@pytest.mark.parametrize(
    "name", ["../CONCEPT.csv", "a/CONCEPT.csv", "CONCEPT*.csv", ".CONCEPT.csv", "notes.txt", "CONCEPT.exe", ""]
)
def test_upload_names_are_bare_athena_files(name):
    upload = lib.new_upload()
    with pytest.raises(lib.SourceError):
        lib.upload_file_path(upload, name)


@pytest.mark.parametrize("upload_id", ["../../etc", "x" * 32, "", "0" * 31])
def test_upload_ids_are_checked(upload_id):
    with pytest.raises(lib.SourceError):
        lib.upload_file_path(upload_id, "CONCEPT.csv")
