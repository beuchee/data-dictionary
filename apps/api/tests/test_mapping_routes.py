"""/api/v1/mappings: upload + server-side parse, list, get with rows, delete,
and who may do what."""

import json
from pathlib import Path

import pytest

from app.main import app
from app.services.content_store import ContentStore, get_content_store

from conftest import API, create_user, login
from content_fixtures import build_content_dir

M = f"{API}/mappings"
ROOT = Path(__file__).resolve().parent / "fixtures" / "mappings"


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


async def _as(client, db, role: str) -> dict:
    await create_user(db, role, role=role)
    return await login(client, role)


def _file(path: str, name: str | None = None):
    return ("files", (name or path.rsplit("/", 1)[-1], (ROOT / "inputs" / path).read_bytes()))


async def test_create_list_get_delete(content_client, db):
    headers = await _as(content_client, db, "editor")
    r = await content_client.post(
        M,
        headers=headers,
        files=[_file("usagi/usagi.csv")],
        data={"options": json.dumps({"format": "usagi"}), "name": "  Rennes Usagi  ", "description": "Lab"},
    )
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["name"] == "Rennes Usagi"
    assert created["format"] == "usagi"
    assert created["defaultStatuses"] == ["approved"]
    assert created["sourceFileName"] == "usagi.csv"
    assert created["createdBy"] == "editor"
    expected = json.loads((ROOT / "expected" / "usagi.json").read_text())["result"]
    assert created["stats"] == expected["stats"]

    listed = (await content_client.get(M)).json()
    assert [m["id"] for m in listed] == [created["id"]]
    assert "rows" not in listed[0]

    full = (await content_client.get(f"{M}/{created['id']}")).json()
    assert full["rows"] == expected["rows"]

    assert (await content_client.delete(f"{M}/{created['id']}", headers=headers)).status_code == 204
    assert (await content_client.get(f"{M}/{created['id']}")).status_code == 404
    assert (await content_client.get(M)).json() == []


async def test_auto_detection_and_several_files(content_client, db):
    headers = await _as(content_client, db, "editor")
    r = await content_client.post(
        M,
        headers=headers,
        files=[_file("ccr/concept.csv"), _file("ccr/concept_relationship.csv")],
        data={"options": json.dumps({"format": "auto"})},
    )
    assert r.status_code == 201, r.text
    body = r.json()
    assert body["format"] == "ccr"
    assert body["options"]["format"] == "ccr"
    assert body["name"] == "concept.csv"
    assert body["sourceFileName"] == "concept.csv, concept_relationship.csv"


async def test_linkr_project_name_is_the_default_name(content_client, db):
    headers = await _as(content_client, db, "editor")
    r = await content_client.post(
        M, headers=headers, files=[_file("linkr/project.zip")], data={"options": '{"format": "linkr"}'}
    )
    assert r.json()["name"] == "Adult ICU"


async def test_an_unreadable_file_is_a_422_with_its_code(content_client, db):
    headers = await _as(content_client, db, "editor")
    r = await content_client.post(
        M, headers=headers, files=[_file("stcm/stcm_missing_target.csv")], data={"options": '{"format": "stcm"}'}
    )
    assert r.status_code == 422
    assert r.json()["detail"]["code"] == "missing_columns"


@pytest.mark.parametrize(
    "options",
    [
        "not json",
        '{"format": "atlas"}',
        '{"evil": 1}',
        '{"format": "generic", "columns": {"targetConceptId": 5}}',
        '{"format": "generic", "columns": {"nope": "a"}}',
        '{"skipRows": -1}',
        '{"skipRows": true}',
        '{"delimiter": "x"}',
        '{"hasHeader": "yes"}',
    ],
)
async def test_bad_options_are_refused(content_client, db, options):
    headers = await _as(content_client, db, "editor")
    r = await content_client.post(M, headers=headers, files=[_file("list/ids.txt")], data={"options": options})
    assert r.status_code == 400, r.text


async def test_upload_size_is_capped(content_client, db, monkeypatch):
    import app.api.v1.routes.mappings as routes

    monkeypatch.setattr(routes, "MAX_UPLOAD_BYTES", 10)
    headers = await _as(content_client, db, "editor")
    r = await content_client.post(M, headers=headers, files=[_file("list/ids.txt")], data={"options": "{}"})
    assert r.status_code == 413


async def test_writing_needs_mappings_write(content_client, db):
    assert (await content_client.post(M, files=[_file("list/ids.txt")])).status_code == 401
    viewer = await _as(content_client, db, "viewer")
    r = await content_client.post(M, headers=viewer, files=[_file("list/ids.txt")], data={"options": "{}"})
    assert r.status_code == 403
    editor = await _as(content_client, db, "editor")
    r = await content_client.post(M, headers=editor, files=[_file("list/ids.txt")], data={"options": "{}"})
    assert r.status_code == 201
    created = r.json()["id"]
    assert (await content_client.delete(f"{M}/{created}", headers=viewer)).status_code == 403
    assert (await content_client.delete(f"{M}/missing", headers=editor)).status_code == 404


async def test_reads_follow_anonymous_read(private_client, db):
    assert (await private_client.get(M)).status_code == 401
    headers = await _as(private_client, db, "viewer")
    assert (await private_client.get(M, headers=headers)).status_code == 200
