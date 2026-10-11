"""POST /vocabulary/sql: read-only SQL for Dev tools, and the ways around it
that must stay shut."""

import pytest

from app.main import app
from app.services import vocabulary_sql as vsql
from app.services.content_store import ContentStore, get_content_store

from conftest import API, create_user, login
from content_fixtures import build_content_dir
from vocab_fixtures import build_library

URL = f"{API}/vocabulary/sql"


@pytest.fixture
def content_client(client, tmp_path):
    app.dependency_overrides[get_content_store] = lambda: ContentStore(
        build_content_dir(tmp_path / "content"), check_interval=0
    )
    return client


async def _admin(client, db) -> dict:
    await create_user(db, "admin", role="admin")
    return await login(client, "admin")


async def test_select_with_describe_and_show(content_client, db):
    build_library()
    h = await _admin(content_client, db)
    r = await content_client.post(
        URL,
        headers=h,
        json={"sql": "SELECT concept_id, concept_name FROM concept WHERE concept_id IN (103, 104) ORDER BY 1"},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["columns"] == ["concept_id", "concept_name"]
    assert body["rows"] == [[103, "Myocardial infarction"], [104, "Acute myocardial infarction"]]
    assert body["truncated"] is False
    for sql in (
        "WITH x AS (SELECT 1 AS a) SELECT * FROM x",
        "DESCRIBE concept",
        "SHOW TABLES",
        "FROM vocabulary LIMIT 1",
        "EXPLAIN SELECT * FROM concept",
        "SELECT valid_start_date FROM concept LIMIT 1",
    ):
        r = await content_client.post(URL, headers=h, json={"sql": sql})
        assert r.status_code == 200, (sql, r.text)


async def test_rows_are_capped(content_client, db):
    build_library()
    h = await _admin(content_client, db)
    r = await content_client.post(URL, headers=h, json={"sql": "SELECT * FROM range(50)", "limit": 10})
    body = r.json()
    assert body["rowCount"] == 10 and body["truncated"] is True
    r = await content_client.post(URL, headers=h, json={"sql": "SELECT 1", "limit": vsql.MAX_ROWS + 1})
    assert r.status_code == 422


@pytest.mark.parametrize(
    "sql",
    [
        "CREATE TABLE t AS SELECT 1",
        "DROP VIEW concept",
        "INSERT INTO concept SELECT * FROM concept",
        "COPY concept TO 'out.csv'",
        "ATTACH 'x.db' AS x",
        "INSTALL httpfs",
        "LOAD httpfs",
        "SET enable_external_access = true",
        "PRAGMA enable_profiling",
        "CALL pragma_version()",
        "SELECT 1; DROP VIEW concept",
        "SELECT 1; SELECT 2",
        "EXPORT DATABASE 'dir'",
        "",
        "SELEC 1",
    ],
)
async def test_writes_and_tricks_are_refused(content_client, db, sql):
    build_library()
    h = await _admin(content_client, db)
    r = await content_client.post(URL, headers=h, json={"sql": sql})
    assert r.status_code in (400, 422), (sql, r.status_code, r.text)


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM read_csv('/etc/passwd')",
        "SELECT * FROM read_text('/etc/hosts')",
        "SELECT * FROM glob('/*')",
        "SELECT * FROM read_parquet('https://example.org/x.parquet')",
        "SELECT * FROM query('COPY (SELECT 1) TO ''/tmp/dd-pwned.csv''')",
    ],
)
async def test_files_outside_the_library_stay_out_of_reach(content_client, db, sql):
    build_library()
    h = await _admin(content_client, db)
    r = await content_client.post(URL, headers=h, json={"sql": sql})
    assert r.status_code == 400, (sql, r.text)


async def test_the_library_survives_a_query(content_client, db):
    build_library()
    h = await _admin(content_client, db)
    await content_client.post(URL, headers=h, json={"sql": "DROP VIEW concept"})
    r = await content_client.post(URL, headers=h, json={"sql": "SELECT COUNT(*) FROM concept"})
    assert r.status_code == 200 and r.json()["rows"][0][0] > 0


async def test_a_slow_query_is_interrupted(content_client, db, monkeypatch):
    build_library()
    real = vsql.run_query
    monkeypatch.setattr(vsql, "run_query", lambda sql, limit: real(sql, limit, timeout=0.2))
    h = await _admin(content_client, db)
    r = await content_client.post(
        URL, headers=h, json={"sql": "SELECT COUNT(*) FROM range(100000000000) a, range(1000) b"}
    )
    assert r.status_code == 408


async def test_without_vocabulary_is_503(content_client, db):
    h = await _admin(content_client, db)
    r = await content_client.post(URL, headers=h, json={"sql": "SELECT 1"})
    assert r.status_code == 503


async def test_needs_settings_manage(content_client, db):
    build_library()
    assert (await content_client.post(URL, json={"sql": "SELECT 1"})).status_code == 401
    await create_user(db, "maintainer", role="maintainer")
    h = await login(content_client, "maintainer")
    assert (await content_client.post(URL, headers=h, json={"sql": "SELECT 1"})).status_code == 403
