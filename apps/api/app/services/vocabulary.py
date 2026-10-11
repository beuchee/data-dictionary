# Adapted from linkr@1310cf4a4 apps/api/app/services/vocabulary_library.py
"""The instance's OHDSI vocabulary library (server mode).

One library per instance, under ``{DD_DATA_DIR}/vocabulary/``:

- ``library/<table>/vocab-<key>.parquet``: one partition per vocabulary and
  table (``concept``, ``concept_relationship``, ``concept_ancestor``…), and
  ``library/<table>/shared.parquet`` for the tables every vocabulary shares
  (``domain``, ``concept_class``, ``relationship``);
- ``inventory.json``: what each vocabulary is (name, version, release, row
  counts, where it came from, when);
- ``uploads/<id>/``: ATHENA files uploaded from the browser, awaiting import;
- ``.staging/``: partitions being written by an import.

An import reads an ATHENA export (tab-separated CSV or Parquet, from a server
folder under ``DD_VOCABULARY_IMPORT_ROOTS`` or uploaded) and writes the
partitions of the vocabularies picked, replacing those already there. A row
belongs to the vocabulary of the concept that owns it: ``concept`` and
``vocabulary`` by their own ``vocabulary_id``, ``concept_relationship`` by
``concept_id_1``, ``concept_ancestor`` by the ancestor, ``concept_synonym`` by its
concept, ``drug_strength`` by the drug. Shared tables are the union of every
import, the latest one winning. Each partition is sorted on its owning column,
so Parquet row-group statistics skip most of a file on a lookup by id.

Queries go through ``Library.cursor()``: an in-memory DuckDB whose views
(``concept``, ``concept_ancestor``…) read the partitions; a table no import
provided is an empty view of the right shape.
"""

from __future__ import annotations

import asyncio
import json
import os
import re
import shutil
import tempfile
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import UTC, datetime
from pathlib import Path

import duckdb
import structlog

from app.config import settings

logger = structlog.get_logger()

# Column types of the OMOP CDM v5.4 vocabulary tables. Every import is cast to
# them, so partitions written from a CSV (all text) and from a Parquet (typed)
# union cleanly.
TABLE_COLUMNS: dict[str, list[tuple[str, str]]] = {
    "concept": [
        ("concept_id", "BIGINT"), ("concept_name", "VARCHAR"), ("domain_id", "VARCHAR"),
        ("vocabulary_id", "VARCHAR"), ("concept_class_id", "VARCHAR"),
        ("standard_concept", "VARCHAR"), ("concept_code", "VARCHAR"),
        ("valid_start_date", "DATE"), ("valid_end_date", "DATE"), ("invalid_reason", "VARCHAR"),
    ],
    "concept_relationship": [
        ("concept_id_1", "BIGINT"), ("concept_id_2", "BIGINT"), ("relationship_id", "VARCHAR"),
        ("valid_start_date", "DATE"), ("valid_end_date", "DATE"), ("invalid_reason", "VARCHAR"),
    ],
    "concept_ancestor": [
        ("ancestor_concept_id", "BIGINT"), ("descendant_concept_id", "BIGINT"),
        ("min_levels_of_separation", "INTEGER"), ("max_levels_of_separation", "INTEGER"),
    ],
    "concept_synonym": [
        ("concept_id", "BIGINT"), ("concept_synonym_name", "VARCHAR"), ("language_concept_id", "BIGINT"),
    ],
    "drug_strength": [
        ("drug_concept_id", "BIGINT"), ("ingredient_concept_id", "BIGINT"),
        ("amount_value", "DOUBLE"), ("amount_unit_concept_id", "BIGINT"),
        ("numerator_value", "DOUBLE"), ("numerator_unit_concept_id", "BIGINT"),
        ("denominator_value", "DOUBLE"), ("denominator_unit_concept_id", "BIGINT"),
        ("box_size", "INTEGER"), ("valid_start_date", "DATE"), ("valid_end_date", "DATE"),
        ("invalid_reason", "VARCHAR"),
    ],
    "vocabulary": [
        ("vocabulary_id", "VARCHAR"), ("vocabulary_name", "VARCHAR"),
        ("vocabulary_reference", "VARCHAR"), ("vocabulary_version", "VARCHAR"),
        ("vocabulary_concept_id", "BIGINT"),
    ],
    "domain": [("domain_id", "VARCHAR"), ("domain_name", "VARCHAR"), ("domain_concept_id", "BIGINT")],
    "concept_class": [
        ("concept_class_id", "VARCHAR"), ("concept_class_name", "VARCHAR"),
        ("concept_class_concept_id", "BIGINT"),
    ],
    "relationship": [
        ("relationship_id", "VARCHAR"), ("relationship_name", "VARCHAR"),
        ("is_hierarchical", "VARCHAR"), ("defines_ancestry", "VARCHAR"),
        ("reverse_relationship_id", "VARCHAR"), ("relationship_concept_id", "BIGINT"),
    ],
}
LIBRARY_TABLES = tuple(TABLE_COLUMNS)
REQUIRED_TABLES = ("concept", "concept_ancestor", "concept_relationship")

# Per-vocabulary tables → the column naming the owning concept (None: the table
# carries `vocabulary_id` itself).
OWNED_BY: dict[str, str | None] = {
    "concept": None,
    "vocabulary": None,
    "concept_relationship": "concept_id_1",
    "concept_ancestor": "ancestor_concept_id",
    "concept_synonym": "concept_id",
    "drug_strength": "drug_concept_id",
}
# Sort key of each partition, for row-group pruning on lookups by id.
SORT_BY: dict[str, str] = {
    "concept": "concept_id",
    "vocabulary": "vocabulary_id",
    "concept_relationship": "concept_id_1",
    "concept_ancestor": "ancestor_concept_id",
    "concept_synonym": "concept_id",
    "drug_strength": "drug_concept_id",
}
# Shared tables → their key, for "latest import wins".
SHARED_KEYS = {"domain": "domain_id", "concept_class": "concept_class_id", "relationship": "relationship_id"}

SHARED_FILE = "shared.parquet"
# The row ATHENA writes for the export itself: its version is the release.
RELEASE_VOCABULARY_ID = "None"

_DATA_SUFFIXES = (".csv", ".tsv", ".txt", ".parquet", ".pq")
_GLOB_CHARS = re.compile(r"[*?\[]")
# An uploaded file's name: a bare file name, no path, no glob character.
UPLOAD_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,99}$")
UPLOAD_ID = re.compile(r"^[0-9a-f]{32}$")
_UPLOAD_TTL = 24 * 3600.0
_SERVER_SCAN_DEPTH = 3


def vocabulary_root() -> Path:
    return settings.data_path / "vocabulary"


def library_dir() -> Path:
    return vocabulary_root() / "library"


def _staging_root() -> Path:
    # Beside the library, not in the system temp dir: the swap-in is a rename,
    # which cannot cross filesystems (EXDEV), and in a container /tmp is the
    # overlay layer while the data dir is a volume. Outside library_dir, so a
    # read mid-import never sees half-written partitions.
    return vocabulary_root() / ".staging"


def uploads_root() -> Path:
    return vocabulary_root() / "uploads"


def _inventory_path() -> Path:
    return vocabulary_root() / "inventory.json"


def file_key(vocabulary_id: str) -> str:
    """File-name-safe key of a vocabulary (`Nebraska Lexicon` → `Nebraska_Lexicon`).
    Prefixed so a vocabulary named like a table (`Domain`, `Relationship`, which
    OMOP ships) is never read as one."""
    return "vocab-" + re.sub(r"[^A-Za-z0-9_-]", "_", vocabulary_id)


def partition_path(table: str, vocabulary_id: str) -> Path:
    return library_dir() / table / f"{file_key(vocabulary_id)}.parquet"


def library_files() -> list[tuple[str, str]]:
    """(relative name, absolute path) of every partition, grouped by table
    through its directory."""
    root = library_dir()
    if not root.is_dir():
        return []
    found = sorted(root.rglob("*.parquet"), key=lambda p: str(p).lower())
    return [(p.relative_to(root).as_posix(), str(p)) for p in found]


def present_tables() -> list[str]:
    return sorted({name.split("/", 1)[0] for name, _ in library_files() if "/" in name})


def table_of(file_name: str) -> str | None:
    """Which vocabulary table a file of an ATHENA export holds (`CONCEPT.csv`,
    `concept/part-0.parquet`), or None."""
    parts = [p for p in file_name.replace("\\", "/").split("/") if p]
    if not parts or not parts[-1].lower().endswith(_DATA_SUFFIXES):
        return None
    for seg in reversed(parts):
        stem = re.sub(r"\.[^.]+$", "", seg).lower()
        if stem in TABLE_COLUMNS:
            return stem
    return None


# (file name, path): the name tells CSV from Parquet.
ExportFiles = list[tuple[str, str]]


def skip_glob_path(path: str) -> bool:
    """Whether read_parquet / read_csv would expand `path` as a pattern (`a?.csv`
    also reads `ab.csv`); such a file is left out, with a warning."""
    if _GLOB_CHARS.search(str(path)) is None:
        return False
    logger.warning("vocabulary_file_skipped_glob", path=str(path))
    return True


def group_export_files(files: ExportFiles) -> dict[str, ExportFiles]:
    groups: dict[str, ExportFiles] = {}
    for name, path in files:
        if skip_glob_path(path):
            continue
        table = table_of(name)
        if table:
            groups.setdefault(table, []).append((name, path))
    return groups


def _lit(value: str) -> str:
    return "'" + value.replace("\0", "").replace("'", "''") + "'"


def _reader(files: ExportFiles) -> str:
    """A reader over one table's files. ATHENA CSVs are tab-separated and never
    quoted (a concept name may hold a lone `"`), so a tab header switches quoting
    off; everything is read as text and cast by `_typed_select`."""
    paths = [p for _, p in files]
    if all(n.lower().endswith((".parquet", ".pq")) for n, _ in files):
        return f"read_parquet([{', '.join(_lit(p) for p in paths)}], union_by_name=true)"
    with open(paths[0], encoding="utf-8", errors="replace") as fh:
        header = fh.readline()
    opts = "delim='\\t', quote='', escape=''" if "\t" in header else "auto_detect=true"
    return (
        f"read_csv([{', '.join(_lit(p) for p in paths)}], header=true, all_varchar=true, "
        f"union_by_name=true, {opts})"
    )


def _typed_column(name: str, sql_type: str, present: set[str]) -> str:
    if name not in present:
        return f"CAST(NULL AS {sql_type}) AS {name}"
    if sql_type == "DATE":
        # ATHENA writes 19700101; a typed Parquet already has a DATE.
        return (
            f"COALESCE(TRY_CAST({name} AS DATE), "
            f"TRY_STRPTIME(CAST({name} AS VARCHAR), '%Y%m%d')::DATE) AS {name}"
        )
    return f"TRY_CAST({name} AS {sql_type}) AS {name}"


def _typed_select(con: duckdb.DuckDBPyConnection, table: str, files: ExportFiles) -> str:
    reader = _reader(files)
    present = {d[0].lower() for d in con.execute(f"SELECT * FROM {reader} LIMIT 0").description}
    cols = ", ".join(_typed_column(n, t, present) for n, t in TABLE_COLUMNS[table])
    return f"SELECT {cols} FROM {reader}"


def _connect(work_dir: str | None = None) -> duckdb.DuckDBPyConnection:
    # A file-backed database under a temp dir, so a full ATHENA (40 M relationship
    # rows) spills to disk rather than to memory.
    if not work_dir:
        return duckdb.connect()
    con = duckdb.connect(str(Path(work_dir) / "import.duckdb"))
    con.execute(f"SET temp_directory = {_lit(str(Path(work_dir) / 'spill'))}")
    return con


# --- Export sources ------------------------------------------------------------


class SourceError(ValueError):
    """A source no import can read: outside the allowed roots, not a folder,
    an unknown upload."""


def server_folder_files(server_path: str) -> ExportFiles:
    """The data files of a server folder, which must sit under one of
    DD_VOCABULARY_IMPORT_ROOTS (symlinks resolved, so a link cannot leave it)."""
    roots = settings.vocabulary_import_root_list
    if not roots:
        raise SourceError("Server folder imports are disabled (DD_VOCABULARY_IMPORT_ROOTS is not set)")
    if not server_path or "\0" in server_path:
        raise SourceError("Invalid path")
    folder = Path(server_path).expanduser()
    if not folder.is_absolute():
        raise SourceError("The path must be absolute")
    folder = folder.resolve()
    root = next((r for r in roots if folder == r or folder.is_relative_to(r)), None)
    if root is None:
        raise SourceError("The path is outside the allowed import folders")
    if not folder.is_dir():
        raise SourceError("Not a folder")
    out: ExportFiles = []
    for dirpath, dirnames, filenames in os.walk(folder):
        depth = len(Path(dirpath).relative_to(folder).parts)
        if depth >= _SERVER_SCAN_DEPTH:
            dirnames[:] = []
        for name in sorted(filenames):
            path = Path(dirpath) / name
            real = path.resolve()
            if not real.is_file() or not (real == root or real.is_relative_to(root)):
                continue
            rel = path.relative_to(folder).as_posix()
            if table_of(rel):
                out.append((rel, str(real)))
    return out


def new_upload() -> str:
    _prune_uploads(time.time())
    upload_id = uuid.uuid4().hex
    (uploads_root() / upload_id).mkdir(parents=True, exist_ok=True)
    return upload_id


def upload_file_path(upload_id: str, file_name: str) -> Path:
    if not UPLOAD_ID.match(upload_id):
        raise SourceError("Unknown upload")
    if not UPLOAD_NAME.match(file_name) or _GLOB_CHARS.search(file_name) or table_of(file_name) is None:
        raise SourceError(f"Not an ATHENA vocabulary file: {file_name}")
    folder = uploads_root() / upload_id
    if not folder.is_dir():
        raise SourceError("Unknown upload")
    return folder / file_name


def upload_files(upload_id: str) -> ExportFiles:
    if not UPLOAD_ID.match(upload_id):
        raise SourceError("Unknown upload")
    folder = uploads_root() / upload_id
    if not folder.is_dir():
        raise SourceError("Unknown upload")
    return [(p.name, str(p)) for p in sorted(folder.iterdir()) if p.is_file() and table_of(p.name)]


def discard_upload(upload_id: str) -> None:
    if UPLOAD_ID.match(upload_id):
        shutil.rmtree(uploads_root() / upload_id, ignore_errors=True)


def _prune_uploads(now: float) -> None:
    root = uploads_root()
    if not root.is_dir():
        return
    for folder in root.iterdir():
        try:
            if folder.is_dir() and now - folder.stat().st_mtime > _UPLOAD_TTL:
                shutil.rmtree(folder, ignore_errors=True)
        except OSError:
            continue


# --- Inspect --------------------------------------------------------------------


def inspect_export(files: ExportFiles) -> dict:
    """What an ATHENA export holds: its release and, per vocabulary present in
    CONCEPT, its name, version and concept count."""
    groups = group_export_files(files)
    if "concept" not in groups:
        raise ValueError("The export has no CONCEPT table.")
    con = _connect()
    try:
        con.execute(f"CREATE TEMP TABLE c AS {_typed_select(con, 'concept', groups['concept'])}")
        counts = dict(
            con.execute(
                "SELECT vocabulary_id, COUNT(*) FROM c WHERE vocabulary_id IS NOT NULL GROUP BY 1"
            ).fetchall()
        )
        meta: dict[str, tuple[str | None, str | None]] = {}
        release = None
        if "vocabulary" in groups:
            for vid, name, version in con.execute(
                f"SELECT vocabulary_id, vocabulary_name, vocabulary_version FROM "
                f"({_typed_select(con, 'vocabulary', groups['vocabulary'])})"
            ).fetchall():
                if vid == RELEASE_VOCABULARY_ID:
                    release = version
                meta[vid] = (name, version)
    finally:
        con.close()
    return {
        "release": release,
        "tables": sorted(groups),
        "vocabularies": [
            {
                "vocabularyId": vid,
                "vocabularyName": meta.get(vid, (None, None))[0],
                "vocabularyVersion": meta.get(vid, (None, None))[1],
                "conceptCount": int(n),
            }
            for vid, n in sorted(counts.items())
        ],
    }


# --- Import ----------------------------------------------------------------------


@dataclass
class ImportState:
    id: str
    status: str = "running"  # running | done | error
    step: str = ""
    done: int = 0
    total: int = 0
    error: str | None = None
    vocabularies: list[dict] = field(default_factory=list)
    started_at: float = field(default_factory=time.time)
    finished_at: float | None = None

    def as_dict(self) -> dict:
        return {
            "id": self.id, "status": self.status, "step": self.step, "done": self.done,
            "total": self.total, "error": self.error, "vocabularies": self.vocabularies,
        }


_imports: dict[str, ImportState] = {}
_import_tasks: set[asyncio.Task] = set()
_FINISHED_IMPORT_TTL = 3600.0
# One lock per event loop: an asyncio.Lock is bound to the loop it first waits
# on (the app has one; the test suite starts one per test).
_lock_state: tuple[asyncio.AbstractEventLoop, asyncio.Lock] | None = None


def write_lock() -> asyncio.Lock:
    """Held while the library is written: an import, a removal."""
    global _lock_state
    loop = asyncio.get_running_loop()
    if _lock_state is None or _lock_state[0] is not loop:
        _lock_state = (loop, asyncio.Lock())
    return _lock_state[1]


def is_busy() -> bool:
    """Whether the library is being written or has an import waiting to."""
    locked = _lock_state is not None and _lock_state[1].locked()
    return locked or any(s.finished_at is None for s in _imports.values())


def _prune_imports(now: float) -> None:
    for import_id, state in list(_imports.items()):
        if state.finished_at is not None and now - state.finished_at > _FINISHED_IMPORT_TTL:
            del _imports[import_id]


def import_state(import_id: str) -> ImportState | None:
    return _imports.get(import_id)


def import_states() -> list[ImportState]:
    return sorted(_imports.values(), key=lambda s: s.started_at)


def write_partitions(files: ExportFiles, vocabularies: list[str], progress: ImportState | None = None) -> list[dict]:
    """Write the partitions of `vocabularies` from the export, replacing those
    already in the library, and merge the shared tables. Returns, per vocabulary
    written, its row counts by table. Built in a staging dir, then swapped in file
    by file: a failure while staging leaves the library as it was, but one
    during the swap (a crash, a full disk) can leave some tables at the new
    release and others at the old one; importing again repairs it."""
    groups = group_export_files(files)
    if "concept" not in groups:
        raise ValueError("The export has no CONCEPT table.")
    chosen = sorted(set(vocabularies))
    if not chosen:
        return []
    root = library_dir()
    _staging_root().mkdir(parents=True, exist_ok=True)
    work = tempfile.mkdtemp(prefix="vocab-import-", dir=_staging_root())
    staged = Path(work) / "out"
    con = _connect(work)
    try:
        in_list = ", ".join(_lit(v) for v in chosen)
        per_vocab_tables = [t for t in OWNED_BY if t in groups]
        shared_tables = [t for t in SHARED_KEYS if t in groups]
        if progress:
            progress.total = len(per_vocab_tables) + len(shared_tables)
        counts: dict[str, dict[str, int]] = {v: {} for v in chosen}

        con.execute(
            f"CREATE TABLE c AS SELECT * FROM ({_typed_select(con, 'concept', groups['concept'])}) "
            f"WHERE vocabulary_id IN ({in_list})"
        )
        con.execute("CREATE TABLE owner AS SELECT concept_id, vocabulary_id AS _v FROM c")

        for table in per_vocab_tables:
            if progress:
                progress.step = table
            col = OWNED_BY[table]
            if table == "concept":
                src = "SELECT *, vocabulary_id AS _v FROM c"
            elif col is None:
                src = (
                    f"SELECT *, vocabulary_id AS _v FROM ({_typed_select(con, table, groups[table])}) "
                    f"WHERE vocabulary_id IN ({in_list})"
                )
            else:
                src = (
                    f"SELECT t.*, o._v FROM ({_typed_select(con, table, groups[table])}) t "
                    f"JOIN owner o ON o.concept_id = t.{col}"
                )
            con.execute(f"CREATE OR REPLACE TABLE part AS {src}")
            for vocab, n in con.execute("SELECT _v, COUNT(*) FROM part GROUP BY 1").fetchall():
                counts[vocab][table] = int(n)
            for vocab in chosen:
                out = staged / table / f"{file_key(vocab)}.parquet"
                out.parent.mkdir(parents=True, exist_ok=True)
                con.execute(
                    f"COPY (SELECT * EXCLUDE (_v) FROM part WHERE _v = {_lit(vocab)} ORDER BY {SORT_BY[table]}) "
                    f"TO {_lit(str(out))} (FORMAT PARQUET)"
                )
            con.execute("DROP TABLE part")
            if progress:
                progress.done += 1

        for table in shared_tables:
            if progress:
                progress.step = table
            key = SHARED_KEYS[table]
            incoming = _typed_select(con, table, groups[table])
            current = root / table / SHARED_FILE
            union = f"SELECT *, 1 AS _rank FROM ({incoming})"
            if current.is_file():
                union += f" UNION ALL BY NAME SELECT *, 2 AS _rank FROM read_parquet({_lit(str(current))})"
            out = staged / table / SHARED_FILE
            out.parent.mkdir(parents=True, exist_ok=True)
            con.execute(
                f"COPY (SELECT * EXCLUDE (_rank) FROM ({union}) "
                f"QUALIFY row_number() OVER (PARTITION BY {key} ORDER BY _rank) = 1) "
                f"TO {_lit(str(out))} (FORMAT PARQUET)"
            )
            if progress:
                progress.done += 1
        con.close()

        # Swap in: every staged file replaces its counterpart; a table this export
        # lacks drops the vocabulary's older partition, which would describe
        # another release of the same vocabulary.
        for vocab in chosen:
            for table in OWNED_BY:
                target = partition_path(table, vocab)
                staged_file = staged / table / f"{file_key(vocab)}.parquet"
                if staged_file.is_file():
                    target.parent.mkdir(parents=True, exist_ok=True)
                    staged_file.replace(target)
                else:
                    target.unlink(missing_ok=True)
        for table in shared_tables:
            target = root / table / SHARED_FILE
            target.parent.mkdir(parents=True, exist_ok=True)
            (staged / table / SHARED_FILE).replace(target)
        return [{"vocabularyId": v, "rowCounts": counts[v]} for v in chosen]
    finally:
        try:
            con.close()
        except Exception:  # noqa: BLE001 — already closed
            pass
        shutil.rmtree(work, ignore_errors=True)


def remove_partitions(vocabulary_id: str) -> None:
    for table in OWNED_BY:
        partition_path(table, vocabulary_id).unlink(missing_ok=True)


def remove_library() -> None:
    shutil.rmtree(library_dir(), ignore_errors=True)
    _inventory_path().unlink(missing_ok=True)


def library_size(vocabulary_id: str) -> int:
    return sum(
        p.stat().st_size for p in (partition_path(t, vocabulary_id) for t in OWNED_BY) if p.is_file()
    )


def start_import(run) -> ImportState:
    """Run `run(state)` (a coroutine function) in the background, one write at a
    time; the client polls `import_state`."""
    _prune_imports(time.time())
    state = ImportState(id=str(uuid.uuid4()))
    _imports[state.id] = state

    lock = write_lock()

    async def _job() -> None:
        async with lock:
            try:
                await run(state)
                state.status = "done"
            except Exception as e:  # noqa: BLE001 — reported through the polled state
                logger.warning("vocabulary_import_failed", error=str(e))
                state.status = "error"
                state.error = str(e)
            finally:
                state.finished_at = time.time()

    # Held: asyncio keeps only a weak reference to a task.
    task = asyncio.create_task(_job())
    _import_tasks.add(task)
    task.add_done_callback(_import_tasks.discard)
    return state


# --- Inventory ------------------------------------------------------------------------


def read_inventory() -> list[dict]:
    try:
        data = json.loads(_inventory_path().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    return [v for v in data.get("vocabularies", []) if isinstance(v, dict) and v.get("vocabularyId")]


def write_inventory(vocabularies: list[dict]) -> None:
    path = _inventory_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.tmp")
    tmp.write_text(
        json.dumps({"vocabularies": sorted(vocabularies, key=lambda v: v["vocabularyId"])}, indent=2),
        encoding="utf-8",
    )
    tmp.replace(path)


def record_import(inspection: dict, written: list[dict], source_label: str) -> None:
    by_id = {v["vocabularyId"]: v for v in inspection["vocabularies"]}
    inventory = {v["vocabularyId"]: v for v in read_inventory()}
    now = datetime.now(UTC).isoformat(timespec="seconds")
    for w in written:
        meta = by_id.get(w["vocabularyId"], {})
        inventory[w["vocabularyId"]] = {
            "vocabularyId": w["vocabularyId"],
            "vocabularyName": meta.get("vocabularyName"),
            "vocabularyVersion": meta.get("vocabularyVersion"),
            "release": inspection.get("release"),
            "conceptCount": w["rowCounts"].get("concept", 0),
            "rowCounts": w["rowCounts"],
            "source": source_label,
            "importedAt": now,
        }
    write_inventory(list(inventory.values()))


def forget_vocabulary(vocabulary_id: str) -> bool:
    inventory = read_inventory()
    kept = [v for v in inventory if v["vocabularyId"] != vocabulary_id]
    if len(kept) == len(inventory):
        return False
    write_inventory(kept)
    return True


# --- Query connection --------------------------------------------------------------


class VocabularyUnavailable(RuntimeError):
    """No vocabulary has been imported (or its CONCEPT partitions are gone)."""


def _empty_view(table: str) -> str:
    cols = ", ".join(f"CAST(NULL AS {t}) AS {n}" for n, t in TABLE_COLUMNS[table])
    return f"SELECT {cols} WHERE false"


class Library:
    """A DuckDB connection whose views read the library's partitions. Rebuilt
    on `invalidate()` (after an import or a removal); `cursor()` hands each
    caller its own cursor, which DuckDB allows across threads."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._con: duckdb.DuckDBPyConnection | None = None
        self._cache: dict[str, object] = {}
        # The folder the connection reads: a changed data dir (tests) rebuilds it.
        self._root: Path | None = None

    def invalidate(self) -> None:
        with self._lock:
            self._con = None
            self._cache = {}

    def _check_root(self) -> None:
        root = library_dir()
        if root != self._root:
            self._con = None
            self._cache = {}
            self._root = root

    def available(self) -> bool:
        return any(name.startswith("concept/") for name, _ in library_files())

    def _build(self) -> duckdb.DuckDBPyConnection:
        files = library_files()
        if not any(name.startswith("concept/") for name, _ in files):
            raise VocabularyUnavailable("No vocabulary has been imported")
        by_table: dict[str, list[str]] = {}
        for name, path in files:
            table = name.split("/", 1)[0]
            if table in TABLE_COLUMNS and not skip_glob_path(path):
                by_table.setdefault(table, []).append(path)
        con = duckdb.connect()
        for table in LIBRARY_TABLES:
            paths = by_table.get(table)
            if paths:
                select = f"SELECT * FROM read_parquet([{', '.join(_lit(p) for p in paths)}], union_by_name=true)"
            else:
                select = _empty_view(table)
            con.execute(f"CREATE VIEW {table} AS {select}")
        return con

    def cursor(self) -> duckdb.DuckDBPyConnection:
        with self._lock:
            self._check_root()
            if self._con is None:
                self._con = self._build()
            return self._con.cursor()

    def cached(self, key: str, compute):
        """A value computed once per library state (filter options, the version)."""
        with self._lock:
            self._check_root()
            if key in self._cache:
                return self._cache[key]
        value = compute()
        with self._lock:
            self._cache[key] = value
        return value


_library = Library()


def get_library() -> Library:
    return _library


def row_counts() -> dict[str, int]:
    """Rows per table across the library (Parquet footers, no scan)."""
    by_table: dict[str, list[str]] = {}
    for name, path in library_files():
        by_table.setdefault(name.split("/", 1)[0], []).append(path)
    if not by_table:
        return {}
    con = duckdb.connect()
    try:
        out = {}
        for table, paths in sorted(by_table.items()):
            listed = ", ".join(_lit(p) for p in paths)
            sql = f"SELECT COUNT(*) FROM read_parquet([{listed}], union_by_name=true)"
            out[table] = int(con.execute(sql).fetchone()[0])
        return out
    finally:
        con.close()
