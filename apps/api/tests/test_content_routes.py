import pytest

from app.main import app
from app.models.role import Role
from app.services.content_store import ContentStore, get_content_store

from conftest import API, create_user, login
from content_fixtures import build_content_dir, read_json


def _use_store(store: ContentStore) -> None:
    app.dependency_overrides[get_content_store] = lambda: store


@pytest.fixture
def content(tmp_path):
    return build_content_dir(tmp_path / "content")


@pytest.fixture
def content_client(client, content):
    _use_store(ContentStore(content, check_interval=0))
    return client


@pytest.fixture
def private_client(client, tmp_path):
    _use_store(ContentStore(build_content_dir(tmp_path / "private", anonymous_read=False), check_interval=0))
    return client


# --- anonymous reading ------------------------------------------------------


async def test_instance_config_is_public(private_client, content):
    r = await private_client.get(f"{API}/instance/config")
    assert r.status_code == 200
    body = r.json()
    assert body["config"]["title"] == read_json(content / "config.json")["title"]
    assert body["server"]["anonymousRead"] is False
    assert body["server"]["authProviders"] == ["local"]
    assert isinstance(body["server"]["passwordMinLength"], int)


@pytest.mark.parametrize(
    "path",
    [
        "/concept-sets",
        "/concept-sets/1",
        "/concept-sets/1/resolved",
        "/concept-sets/1/versions",
        "/projects",
        "/projects/1",
        "/units/recommended",
        "/units/conversions",
        "/mapping-recommendations",
    ],
)
async def test_read_routes_are_open_when_anonymous_read(content_client, path):
    r = await content_client.get(f"{API}{path}")
    assert r.status_code == 200, r.text


@pytest.mark.parametrize("path", ["/concept-sets", "/concept-sets/1", "/projects", "/units/conversions"])
async def test_read_routes_need_login_when_anonymous_read_is_off(private_client, db, path):
    assert (await private_client.get(f"{API}{path}")).status_code == 401
    await create_user(db, "viewer1", role="viewer")
    headers = await login(private_client, "viewer1")
    assert (await private_client.get(f"{API}{path}", headers=headers)).status_code == 200


async def test_an_invalid_token_is_refused_when_anonymous_read_is_off(private_client):
    r = await private_client.get(f"{API}/concept-sets", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 401


async def test_a_role_without_read_permission_is_forbidden(private_client, db):
    db.add(Role(name="nobody", label={"en": "Nobody"}, permissions=[]))
    await db.commit()
    await create_user(db, "nobody1", role="nobody")
    headers = await login(private_client, "nobody1")
    assert (await private_client.get(f"{API}/concept-sets", headers=headers)).status_code == 403
    assert (await private_client.get(f"{API}/instance/config", headers=headers)).status_code == 200


async def test_a_token_is_ignored_when_anonymous_read_is_on(content_client):
    r = await content_client.get(f"{API}/concept-sets", headers={"Authorization": "Bearer nope"})
    assert r.status_code == 200


# --- concept sets -----------------------------------------------------------


async def test_list_returns_summaries(content_client):
    body = (await content_client.get(f"{API}/concept-sets")).json()
    assert [s["id"] for s in body] == [1, 2, 3]
    assert {"version", "translations", "reviewStatus", "itemCount", "resolvedCount", "modifiedDate"} <= set(body[0])
    assert "expression" not in body[0]


async def test_get_returns_the_full_file(content_client, content):
    body = (await content_client.get(f"{API}/concept-sets/2")).json()
    assert body == read_json(content / "concept_sets/2.json")


async def test_get_current_version_by_number(content_client, content):
    version = read_json(content / "concept_sets/2.json")["version"]
    r = await content_client.get(f"{API}/concept-sets/2", params={"version": version})
    assert r.status_code == 200 and r.json()["version"] == version


@pytest.mark.parametrize(
    "path,params,code",
    [
        ("/concept-sets/99", None, 404),
        ("/concept-sets/0", None, 422),
        ("/concept-sets/abc", None, 422),
        ("/concept-sets/1", {"version": "9.9.9"}, 404),
        ("/concept-sets/1", {"version": "../x"}, 422),
        ("/concept-sets/1", {"version": "-x"}, 422),
        ("/concept-sets/99/resolved", None, 404),
        ("/concept-sets/99/versions", None, 404),
        ("/projects/99", None, 404),
        ("/concept-sets/3/resolved", {"limit": 0}, 422),
        ("/concept-sets/3/resolved", {"offset": -1}, 422),
    ],
)
async def test_errors(content_client, path, params, code):
    assert (await content_client.get(f"{API}{path}", params=params)).status_code == code


async def test_resolved_whole_list(content_client):
    body = (await content_client.get(f"{API}/concept-sets/3/resolved")).json()
    assert body["conceptSetId"] == 3
    assert body["total"] == 25
    assert len(body["resolvedConcepts"]) == 25
    assert body["offset"] == 0 and body["limit"] is None
    assert body["vocabularyVersion"] == {"release": "test"}


async def test_resolved_pagination_and_search(content_client):
    page = (await content_client.get(f"{API}/concept-sets/3/resolved", params={"offset": 20, "limit": 10})).json()
    assert page["total"] == 25
    assert [c["conceptId"] for c in page["resolvedConcepts"]] == [1020, 1021, 1022, 1023, 1024]

    found = (
        await content_client.get(f"{API}/concept-sets/3/resolved", params={"search": "glucose", "limit": 3})
    ).json()
    assert found["total"] == 12
    assert [c["conceptId"] for c in found["resolvedConcepts"]] == [1001, 1003, 1005]


async def test_versions(content_client, content):
    body = (await content_client.get(f"{API}/concept-sets/1/versions")).json()
    current = read_json(content / "concept_sets/1.json")["version"]
    assert body["currentVersion"] == current
    assert [v["version"] for v in body["versions"] if v["isCurrent"]] == [current]


async def test_unit_conversions_keep_their_values(content_client, content):
    body = (await content_client.get(f"{API}/units/conversions")).json()
    expected = read_json(content / "units/unit_conversions.json")
    assert [r["conversionFactor"] for r in body] == [float(r["conversionFactor"]) for r in expected]


async def test_projects(content_client, content):
    listed = (await content_client.get(f"{API}/projects")).json()
    assert [p["id"] for p in listed] == [1]
    assert (await content_client.get(f"{API}/projects/1")).json() == read_json(content / "projects/1.json")


async def test_content_unavailable_is_503(client, tmp_path):
    _use_store(ContentStore(tmp_path / "missing"))
    assert (await client.get(f"{API}/concept-sets")).status_code == 503
    assert (await client.get(f"{API}/instance/config")).status_code == 503
