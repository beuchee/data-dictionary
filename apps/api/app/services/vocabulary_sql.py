"""Read-only SQL over the vocabulary library, for Dev tools (admins only).

Two locks, either enough on its own:
- the statement allow-list: exactly one statement, which DuckDB's own parser
  types as SELECT (also WITH, FROM, VALUES, DESCRIBE, SHOW, SUMMARIZE) or EXPLAIN;
- a throwaway in-memory connection holding only the library's views, with file
  access confined to the library folder and the configuration locked, so even a
  statement the parser let through cannot write a file, read one elsewhere,
  attach a database or load an extension.

Rows are capped (`limit`, then `truncated`) and a query running past
`timeout` seconds is interrupted.
"""

import datetime as dt
import decimal
import math
import threading
import time
import uuid

import duckdb

from app.services import vocabulary as lib

MAX_ROWS = 10_000
DEFAULT_TIMEOUT = 30.0
MAX_SQL_LENGTH = 100_000
_ALLOWED = {duckdb.StatementType.SELECT, duckdb.StatementType.EXPLAIN}


class SqlRefused(ValueError):
    """A statement outside the allow-list, or several statements."""


class SqlTimeout(RuntimeError):
    pass


def check_statement(sql: str) -> None:
    if len(sql) > MAX_SQL_LENGTH:
        raise SqlRefused("Query too long")
    try:
        statements = duckdb.extract_statements(sql)
    except duckdb.Error as e:
        raise SqlRefused(str(e).splitlines()[0]) from None
    if len(statements) != 1:
        raise SqlRefused("Send exactly one statement")
    if statements[0].type not in _ALLOWED:
        raise SqlRefused("Only read-only queries (SELECT, WITH, DESCRIBE, SHOW, EXPLAIN) are allowed")


def _sandbox() -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    try:
        for statement in lib.view_statements():
            con.execute(statement)
        root = str(lib.library_dir()).replace("'", "''")
        con.execute(f"SET allowed_directories=['{root}']")
        con.execute("SET enable_external_access=false")
        con.execute("SET autoinstall_known_extensions=false")
        con.execute("SET autoload_known_extensions=false")
        con.execute("SET threads=2")
        con.execute("SET memory_limit='1GB'")
        con.execute("SET lock_configuration=true")
    except BaseException:
        con.close()
        raise
    return con


def _json_value(value: object) -> object:
    if value is None or isinstance(value, (bool, int, str)):
        return value
    if isinstance(value, float):
        return value if math.isfinite(value) else str(value)
    if isinstance(value, (dt.date, dt.datetime, dt.time)):
        return value.isoformat()
    if isinstance(value, decimal.Decimal):
        return float(value)
    if isinstance(value, uuid.UUID):
        return str(value)
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value).hex()
    if isinstance(value, (list, tuple)):
        return [_json_value(v) for v in value]
    if isinstance(value, dict):
        return {str(k): _json_value(v) for k, v in value.items()}
    return str(value)


def run_query(sql: str, limit: int = 1000, timeout: float = DEFAULT_TIMEOUT) -> dict:
    """`{columns, rows (arrays), rowCount, truncated, elapsedMs}`. Raises
    SqlRefused, SqlTimeout, lib.VocabularyUnavailable or duckdb.Error."""
    check_statement(sql)
    limit = max(1, min(limit, MAX_ROWS))
    con = _sandbox()
    timed_out = threading.Event()

    def interrupt() -> None:
        timed_out.set()
        con.interrupt()

    timer = threading.Timer(timeout, interrupt)
    start = time.monotonic()
    timer.start()
    try:
        cur = con.execute(sql)
        columns = [d[0] for d in cur.description or []]
        rows = cur.fetchmany(limit + 1) if columns else []
    except duckdb.Error:
        if timed_out.is_set():
            raise SqlTimeout(f"Query interrupted after {timeout:g} s") from None
        raise
    finally:
        timer.cancel()
        con.close()
    truncated = len(rows) > limit
    rows = rows[:limit]
    return {
        "columns": columns,
        "rows": [[_json_value(v) for v in r] for r in rows],
        "rowCount": len(rows),
        "truncated": truncated,
        "elapsedMs": round((time.monotonic() - start) * 1000),
    }
