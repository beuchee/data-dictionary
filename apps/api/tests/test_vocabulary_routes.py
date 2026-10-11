"""/api/v1/vocabulary: import (upload or server folder) as a polled job, the
inventory, and the concept queries readers use."""

import asyncio
from pathlib import Path

import pytest

from app.config import settings
from app.main import app
from app.services import vocabulary as lib
from app.services.content_store import ContentStore, get_content_store

from conftest import API, create_user, login
from content_fixtures import build_content_dir
from vocab_fixtures import RESOLVE_CASES, build_library, export_files

V = f"{API}/vocabulary"


@pytest.fixture
def content_client(client, tmp_path):
    app.dependency_overrides[get_content_store] = lambda: ContentStore(
        build_content_dir(tmp_path / "content"), check_interval=0
    )
    return client


@pytest.fixture
def private_client(client, tmp_path):
    app.dependency_overrides[get_content_store] = lambda: ContentStore(
        build_content_dir(tmp_path / "private", anonymous_read=False), check_interval=0
    )
    return client


@pytest.fixture
def loaded(content_client):
    build_library()
    return content_client


async def _admin(client, db) -> dict:
    await create_user(db, "admin", role="admin")
    return await login(client, "admin")


async def _wait(client, headers, job: dict) -> dict:
    for _ in range(400):
        if job["status"] != "running":
            return job
        await asyncio.sleep(0.02)
        job = (await client.get(f"{V}/jobs/{job['id']}", headers=headers)).json()
    raise AssertionError(f"import still running: {job}")


# --- Administration -------------------------------------------------------------------------------


async def test_upload_inspect_import_and_remove(content_client, db):
    headers = await _admin(content_client, db)
    assert (await content_client.get(f"{V}/info")).json()["available"] is False
    assert (await content_client.get(f"{V}/concepts/103")).status_code == 503

    upload = (await content_client.post(f"{V}/uploads", headers=headers)).json()["uploadId"]
    for name, path in export_files():
        r = await content_client.put(
            f"{V}/uploads/{upload}/files/{name}", headers=headers, content=Path(path).read_bytes()
        )
        assert r.status_code == 200, r.text

    preview = (await content_client.post(f"{V}/inspect", headers=headers, json={"uploadId": upload})).json()
    assert preview["release"] == "v5.0 01-SEP-26"
    assert {v["vocabularyId"]: v["inLibrary"] for v in preview["vocabularies"]}["LOINC"] is False

    job = (
        await content_client.post(
            f"{V}/import", headers=headers, json={"source": {"uploadId": upload}, "vocabularies": ["LOINC", "None"]}
        )
    ).json()
    job = await _wait(content_client, headers, job)
    assert job["status"] == "done", job
    assert [w["vocabularyId"] for w in job["vocabularies"]] == ["LOINC", "None"]
    # The upload is gone once imported.
    assert not (lib.uploads_root() / upload).exists()

    status = (await content_client.get(f"{V}/status", headers=headers)).json()
    assert status["available"] is True and status["release"] == "v5.0 01-SEP-26"
    assert [(v["vocabularyId"], v["vocabularyVersion"]) for v in status["vocabularies"]] == [
        ("LOINC", "LOINC 2.81"),
        ("None", "v5.0 01-SEP-26"),
    ]
    assert all(v["sizeBytes"] > 0 for v in status["vocabularies"])
    assert status["rowCounts"]["concept"] == 5

    info = (await content_client.get(f"{V}/info")).json()
    assert info["available"] is True and [v["vocabularyId"] for v in info["vocabularies"]] == ["LOINC", "None"]
    assert "source" not in info["vocabularies"][0]

    assert (await content_client.get(f"{V}/concepts/300")).json()["conceptName"] == "Heart rate"
    assert (await content_client.delete(f"{V}/vocabularies/LOINC", headers=headers)).status_code == 204
    assert (await content_client.get(f"{V}/concepts/300")).status_code == 404
    assert (await content_client.delete(V, headers=headers)).status_code == 204
    assert (await content_client.get(f"{V}/concepts/0")).status_code == 503


async def test_import_from_a_server_folder(content_client, db, tmp_path, monkeypatch):
    headers = await _admin(content_client, db)
    root = tmp_path / "athena"
    root.mkdir()
    for name, path in export_files():
        (root / name).write_bytes(Path(path).read_bytes())
    monkeypatch.setattr(settings, "vocabulary_import_roots", str(root))
    assert (await content_client.get(f"{V}/status", headers=headers)).json()["importRoots"] == [str(root.resolve())]

    job = (await content_client.post(f"{V}/import", headers=headers, json={"source": {"serverPath": str(root)}})).json()
    job = await _wait(content_client, headers, job)
    assert job["status"] == "done", job
    assert len(job["vocabularies"]) == 6
    assert (await content_client.get(f"{V}/concepts/200")).json()["vocabularyId"] == "ICD10"

    r = await content_client.post(f"{V}/inspect", headers=headers, json={"serverPath": str(tmp_path)})
    assert r.status_code == 400


async def test_an_upload_is_refused_outside_its_rules(content_client, db):
    headers = await _admin(content_client, db)
    upload = (await content_client.post(f"{V}/uploads", headers=headers)).json()["uploadId"]
    for name in ("notes.txt", ".CONCEPT.csv", "CONCEPT%5B1%5D.csv"):
        r = await content_client.put(f"{V}/uploads/{upload}/files/{name}", headers=headers, content=b"x")
        assert r.status_code == 400, name
    r = await content_client.put(f"{V}/uploads/{'0' * 32}/files/CONCEPT.csv", headers=headers, content=b"x")
    assert r.status_code == 400
    r = await content_client.post(f"{V}/import", headers=headers, json={"source": {"uploadId": upload}})
    assert r.status_code == 400
    r = await content_client.post(f"{V}/import", headers=headers, json={"source": {}})
    assert r.status_code == 400


async def test_an_export_without_the_required_tables_is_refused(content_client, db):
    headers = await _admin(content_client, db)
    upload = (await content_client.post(f"{V}/uploads", headers=headers)).json()["uploadId"]
    concept = dict(export_files())["CONCEPT.csv"]
    await content_client.put(
        f"{V}/uploads/{upload}/files/CONCEPT.csv", headers=headers, content=Path(concept).read_bytes()
    )
    r = await content_client.post(f"{V}/import", headers=headers, json={"source": {"uploadId": upload}})
    assert r.status_code == 400 and "concept_ancestor" in r.json()["detail"]


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/status"),
        ("post", "/uploads"),
        ("post", "/inspect"),
        ("post", "/import"),
        ("get", "/jobs"),
        ("delete", "/vocabularies/LOINC"),
        ("delete", ""),
    ],
)
async def test_administration_needs_settings_manage(content_client, db, method, path):
    assert (await getattr(content_client, method)(f"{V}{path}")).status_code in (401, 403)
    await create_user(db, "editor", role="editor")
    headers = await login(content_client, "editor")
    assert (await getattr(content_client, method)(f"{V}{path}", headers=headers)).status_code == 403


async def test_removal_waits_for_a_running_import(content_client, db):
    headers = await _admin(content_client, db)
    release = asyncio.Event()

    async def slow(state):
        await release.wait()

    lib.start_import(slow)
    await asyncio.sleep(0)
    assert (await content_client.delete(f"{V}/vocabularies/LOINC", headers=headers)).status_code == 409
    release.set()
    for _ in range(50):
        await asyncio.sleep(0)
    assert (await content_client.delete(f"{V}/vocabularies/LOINC", headers=headers)).status_code == 204


# --- Reads ----------------------------------------------------------------------------------------


async def test_reads_follow_anonymous_read(private_client, db):
    build_library()
    assert (await private_client.get(f"{V}/concepts/103")).status_code == 401
    assert (await private_client.post(f"{V}/resolve", json={"expression": {"items": []}})).status_code == 401
    await create_user(db, "viewer", role="viewer")
    headers = await login(private_client, "viewer")
    assert (await private_client.get(f"{V}/concepts/103", headers=headers)).status_code == 200


async def test_concept_and_its_neighbours(loaded):
    c = (await loaded.get(f"{V}/concepts/120")).json()
    assert c == {
        "conceptId": 120,
        "conceptName": "Myocardial infarction, old concept",
        "domainId": "Condition",
        "vocabularyId": "SNOMED",
        "conceptClassId": "Disorder",
        "standardConcept": None,
        "conceptCode": "1000120",
        "validStartDate": "1970-01-01",
        "validEndDate": "2020-01-01",
        "invalidReason": "U",
    }
    related = (await loaded.get(f"{V}/concepts/103/related")).json()
    assert [(r["relationshipId"], r["conceptId"]) for r in related] == [
        ("Concept replaces", 120),
        ("Has finding site", 600),
        ("Is a", 102),
        ("Mapped from", 120),
        ("Subsumes", 104),
        ("Subsumes", 105),
    ]
    assert related[1]["relationshipName"] == "Has finding site (SNOMED)"
    # The deprecated 102 → 600 row is left out.
    assert not [r for r in (await loaded.get(f"{V}/concepts/102/related")).json() if r["conceptId"] == 600]

    synonyms = (await loaded.get(f"{V}/concepts/103/synonyms")).json()
    assert synonyms == [
        {"synonymName": "Heart attack", "languageConceptId": 4180186, "languageName": "English language"},
        {"synonymName": "Infarctus du myocarde", "languageConceptId": 4180190, "languageName": "French language"},
    ]
    assert (await loaded.get(f"{V}/concepts/999999")).status_code == 404
    assert (await loaded.get(f"{V}/concepts/-1")).status_code == 422
    assert (await loaded.get(f"{V}/concepts/1;DROP")).status_code == 422


async def test_hierarchy(loaded):
    h = (await loaded.get(f"{V}/concepts/109/hierarchy")).json()
    levels = {n["conceptId"]: n["hierarchyLevel"] for n in h["nodes"]}
    assert levels == {109: 0, 102: -1, 110: -1, 101: -2, 100: -3}
    assert {(e["fromId"], e["toId"]) for e in h["edges"]} == {
        (101, 102),
        (101, 110),
        (102, 109),
        (110, 109),
        (100, 101),
    }
    assert h["truncated"] is False

    h = (await loaded.get(f"{V}/concepts/102/hierarchy", params={"maxDepth": 1, "limit": 3})).json()
    assert [n["conceptId"] for n in h["nodes"]] == [102, 101, 103]
    assert h["truncated"] is True
    assert (await loaded.get(f"{V}/concepts/424242/hierarchy")).status_code == 404


async def test_search_ranks_and_filters(loaded):
    async def ids(**params):
        body = (await loaded.get(f"{V}/concepts/search", params=params)).json()
        return [c["conceptId"] for c in body["concepts"]], body["total"]

    found, total = await ids(q="heart failure")
    # Exact names first (SNOMED 107 and ICD10 201), then the prefix match, then the rest.
    assert found[:3] == [107, 201, 108] and total == len(found)
    assert (await ids(q="menieres"))[0][0] == 112
    assert (await ids(q="8867-4"))[0][0] == 300
    assert (await ids(q="103"))[0][0] == 103
    found, _ = await ids(q="heart failure", vocabulary="ICD10")
    assert found == [201]
    found, _ = await ids(q="infarction", standard=["N"])
    assert set(found) == {120, 200}
    found, _ = await ids(q="infarction", validOnly="true", standard=["N"])
    assert found == [200]
    found, total = await ids(domain="Drug", limit=1, offset=1)
    assert found == [401] and total == 3

    options = (await loaded.get(f"{V}/filter-options")).json()
    assert "Condition" in options["domains"] and "LOINC" in options["vocabularies"]


@pytest.mark.parametrize(
    "term", ["x' OR 1=1; --", "'); DROP TABLE concept; --", "%", "_", "\\", "' UNION SELECT * FROM vocabulary --"]
)
async def test_search_treats_any_text_as_text(loaded, term):
    r = await loaded.get(f"{V}/concepts/search", params={"q": term, "domain": term})
    assert r.status_code == 200
    assert r.json()["concepts"] == []
    assert (await loaded.get(f"{V}/concepts/103")).status_code == 200


async def test_search_refuses_unknown_standard_filters(loaded):
    assert (await loaded.get(f"{V}/concepts/search", params={"standard": "X"})).status_code == 422


@pytest.mark.parametrize("case", RESOLVE_CASES, ids=[c["name"] for c in RESOLVE_CASES])
async def test_resolve_route_matches_resolve_py(loaded, case):
    r = await loaded.post(f"{V}/resolve", json={"conceptSetId": 7, "expression": {"items": case["items"]}})
    assert r.status_code == 200, r.text
    assert r.json() == {
        "conceptSetId": 7,
        "vocabularyVersion": case["vocabularyVersion"],
        "resolvedConcepts": case["resolvedConcepts"],
    }


@pytest.mark.parametrize("concept_id", ["103", 1.5, -1, True, None, "1) OR (1=1"])
async def test_resolve_refuses_non_integer_ids(loaded, concept_id):
    body = {"expression": {"items": [{"concept": {"conceptId": concept_id}, "includeDescendants": True}]}}
    assert (await loaded.post(f"{V}/resolve", json=body)).status_code == 422


# --- Expression editing ---------------------------------------------------------------------------


async def test_expression_editing_lookups(loaded):
    r = await loaded.post(f"{V}/concepts/batch", json={"ids": [300, 103, 999999]})
    assert r.status_code == 200
    assert [c["conceptId"] for c in r.json()] == [103, 300]
    assert r.json()[0]["validStartDate"]

    r = await loaded.post(f"{V}/descendant-pairs", json={"ancestorIds": [103], "withinIds": [104, 106, 300]})
    assert r.json() == [{"ancestorId": 103, "descendantId": 104}, {"ancestorId": 103, "descendantId": 106}]
    r = await loaded.post(f"{V}/descendant-pairs", json={"ancestorIds": [107]})
    assert r.json() == [{"ancestorId": 107, "descendantId": 108}]

    assert (await loaded.post(f"{V}/mapped-ids", json={"ids": [200]})).json() == [104]

    r = await loaded.post(f"{V}/ancestor-candidates", json={"ids": [300, 301, 302]})
    assert [(c["conceptId"], c["coveredCount"], c["minDepth"]) for c in r.json()] == [(310, 3, 1)]

    for path, body in (
        ("/concepts/batch", {"ids": []}),
        ("/descendant-pairs", {"ancestorIds": [103], "withinIds": []}),
        ("/mapped-ids", {"ids": []}),
        ("/ancestor-candidates", {"ids": []}),
    ):
        assert (await loaded.post(f"{V}{path}", json=body)).json() == []


@pytest.mark.parametrize("bad", ["1", 1.5, -1, True])
async def test_expression_editing_lookups_refuse_non_integer_ids(loaded, bad):
    assert (await loaded.post(f"{V}/concepts/batch", json={"ids": [bad]})).status_code == 422
    assert (await loaded.post(f"{V}/ancestor-candidates", json={"ids": [1, bad]})).status_code == 422
