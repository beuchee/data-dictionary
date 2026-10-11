"""Drafts, proposals and direct commits end to end, against a temporary bare
remote. The forge API is an httpx.MockTransport."""

import json

import httpx
import pytest
from dictionary_format import parse

from app.main import app
from app.services import forge
from app.services.content_store import ContentStore, get_content_store
from app.services.git_service import ContentRepo, get_content_repo

from conftest import API, create_user, login
from git_fixtures import commit_all, git, make_remote, read, write
from vocab_fixtures import build_library


@pytest.fixture
def remote(tmp_path, monkeypatch):
    return make_remote(tmp_path, monkeypatch)


@pytest.fixture
def forge_calls(monkeypatch):
    calls: list[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        calls.append(request)
        if request.url.path.endswith("/pulls"):
            return httpx.Response(201, json={"html_url": "https://github.com/indicate-eu/data-dictionary/pull/7"})
        return httpx.Response(404, json={"message": "Not Found"})

    monkeypatch.setattr(forge, "transport", httpx.MockTransport(handler))
    return calls


@pytest.fixture
def api(client, remote, forge_calls):
    app.dependency_overrides[get_content_repo] = lambda: remote.repo()
    store = ContentStore(remote.work, check_interval=0)
    app.dependency_overrides[get_content_store] = lambda: store
    return client


async def _user(db, client, name: str, role: str, **profile) -> dict:
    user = await create_user(db, name, role)
    for key, value in profile.items():
        setattr(user, key, value)
    await db.commit()
    return await login(client, name)


def _cs(remote, cs_id: int) -> dict:
    return read(remote.work / f"concept_sets/{cs_id}.json")


async def _draft(api, headers, kind, target_id, content, base_commit=None) -> str:
    body = {"kind": kind, "targetId": target_id, "content": content}
    if base_commit:
        body["baseCommit"] = base_commit
    r = await api.post(f"{API}/drafts", json=body, headers=headers)
    assert r.status_code == 201, r.text
    return r.json()["id"]


async def _submit(api, headers, draft_id, mode, message=None):
    return await api.post(f"{API}/drafts/{draft_id}/submit", json={"mode": mode, "message": message}, headers=headers)


# --- CRUD ---------------------------------------------------------------------


async def test_draft_crud_is_private_to_its_owner(api, db, remote):
    alice = await _user(db, api, "alice", "editor")
    bob = await _user(db, api, "bob", "editor")
    draft_id = await _draft(api, alice, "concept-set", 1, _cs(remote, 1))

    r = await api.get(f"{API}/drafts", headers=alice)
    assert [d["id"] for d in r.json()] == [draft_id]
    assert r.json()[0]["kind"] == "concept-set" and r.json()[0]["targetId"] == 1
    assert (await api.get(f"{API}/drafts", headers=bob)).json() == []
    assert (await api.get(f"{API}/drafts/{draft_id}", headers=bob)).status_code == 404

    r = await api.put(f"{API}/drafts/{draft_id}", json={"content": {"id": 1}}, headers=alice)
    assert r.status_code == 200 and r.json()["content"] == {"id": 1}
    assert (await api.delete(f"{API}/drafts/{draft_id}", headers=bob)).status_code == 404
    assert (await api.delete(f"{API}/drafts/{draft_id}", headers=alice)).status_code == 204
    assert (await api.get(f"{API}/drafts/{draft_id}", headers=alice)).status_code == 404


async def test_draft_creation_checks_role_and_shape(api, db):
    viewer = await _user(db, api, "vic", "viewer")
    editor = await _user(db, api, "eve", "editor")
    reviewer = await _user(db, api, "rey", "reviewer")
    body = {"kind": "concept-set", "targetId": 1, "content": {}}
    assert (await api.post(f"{API}/drafts", json=body, headers=viewer)).status_code == 403
    assert (await api.post(f"{API}/drafts", json=body, headers=reviewer)).status_code == 201
    units = {"kind": "recommended-units", "targetId": None, "content": []}
    assert (await api.post(f"{API}/drafts", json=units, headers=editor)).status_code == 403
    bad = {"kind": "config", "targetId": 3, "content": {}}
    assert (await api.post(f"{API}/drafts", json=bad, headers=editor)).status_code == 422
    assert (await api.post(f"{API}/drafts", json={**body, "content": "x"}, headers=editor)).status_code == 422
    assert (await api.post(f"{API}/drafts", json={**body, "baseCommit": "--x"}, headers=editor)).status_code == 422


async def test_draft_content_size_is_capped(api, db, monkeypatch):
    """A draft is stored whole in the database: its size is bounded."""
    from app.schemas import draft as draft_schema

    monkeypatch.setattr(draft_schema, "MAX_CONTENT_BYTES", 10_000)
    editor = await _user(db, api, "eve", "editor")
    big = {"kind": "concept-set", "targetId": 1, "content": {"tags": ["x" * 20_000]}}
    assert (await api.post(f"{API}/drafts", json=big, headers=editor)).status_code == 422
    small = {"kind": "concept-set", "targetId": 1, "content": {"tags": ["x"]}}
    r = await api.post(f"{API}/drafts", json=small, headers=editor)
    assert r.status_code == 201
    r = await api.put(f"{API}/drafts/{r.json()['id']}", json={"content": big["content"]}, headers=editor)
    assert r.status_code == 422


# --- direct commits -------------------------------------------------------------


async def test_maintainer_commit_stamps_writes_and_indexes(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer", first_name="Mia", last_name="Lopez", email="mia@example.org")
    base_head = remote.remote_rev("main")
    cs = _cs(remote, 1)
    cs["metadata"]["translations"]["en"]["name"] = "Renamed set"
    cs["metadata"]["translations"]["en"]["shortDescription"] = "New summary"
    cs["version"] = "5.0.0"
    cs["createdBy"] = "Someone else"  # frozen: put back from the repository
    draft_id = await _draft(api, headers, "concept-set", 1, cs, base_commit=base_head)

    r = await _submit(api, headers, draft_id, "commit", "Rename set 1")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["mode"] == "commit" and out["conceptSetId"] == 1 and out["targetId"] == 1
    assert "branch" not in out and "proposalUrl" not in out

    # Pushed: remote main = index commit, whose parent is the content commit.
    assert remote.remote_rev("main") == out["headSha"] == out["indexCommitSha"]
    assert git(remote.bare, "rev-parse", f"{out['headSha']}^") == out["commitSha"]
    assert (
        git(remote.bare, "log", "-1", "--format=%s|%an <%ae>", out["commitSha"])
        == "Rename set 1|Mia Lopez <mia@example.org>"
    )
    raw = remote.remote_file("main", "concept_sets/1.json")
    written = parse(raw)
    assert raw.decode().endswith("}\n")
    assert written["name"] == "Renamed set" and written["description"] == "New summary"
    assert written["modifiedBy"] == "Mia Lopez"
    assert written["createdBy"] == _cs_at(remote, base_head, 1)["createdBy"]
    assert written["metadata"]["sourceRepo"] == "https://github.com/indicate-eu/data-dictionary"
    assert written["metadata"]["organization"]["current"] == {
        "name": "INDICATE Consortium",
        "url": "https://indicate-eu.org",
    }
    assert list(written) == list(_cs_at(remote, base_head, 1))  # key order kept
    index = json.loads(remote.remote_file("main", "concept_sets_versions.json"))
    assert index["1"]["5.0.0"] == out["commitSha"]

    # The working copy followed, and the draft is gone.
    assert git(remote.work, "rev-parse", "HEAD") == out["headSha"]
    assert (await api.get(f"{API}/drafts/{draft_id}", headers=headers)).status_code == 404
    r = await api.get(f"{API}/concept-sets/1")
    assert r.json()["name"] == "Renamed set"


def _cs_at(remote, ref: str, cs_id: int) -> dict:
    return parse(remote.remote_file(ref, f"concept_sets/{cs_id}.json"))


async def test_commit_without_version_change_adds_no_index_commit(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    cs = _cs(remote, 2)
    cs["metadata"]["translations"]["en"]["longDescription"] = "More text."
    out = (await _submit(api, headers, await _draft(api, headers, "concept-set", 2, cs), "commit")).json()
    assert "indexCommitSha" not in out
    assert out["headSha"] == out["commitSha"] == remote.remote_rev("main")
    assert git(remote.bare, "log", "-1", "--format=%s", "main").startswith("Update concept set 2")


async def test_editor_cannot_commit(api, db, remote):
    headers = await _user(db, api, "eve", "editor")
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 1, _cs(remote, 1)), "commit")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "forbidden"


async def test_commit_refused_when_the_remote_moved_then_pull_fixes_it(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    other = remote.other_clone()
    _bump(other, 3, "3.3.3")
    merged = commit_all(other, "Merged elsewhere")
    git(other, "push", "-q", "origin", "main")

    cs = _cs(remote, 1)
    cs["tags"] = ["edited"]
    draft_id = await _draft(api, headers, "concept-set", 1, cs)
    r = await _submit(api, headers, draft_id, "commit")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "pull_required"

    status = (await api.get(f"{API}/git/status", headers=headers)).json()
    assert status["behind"] == 1 and status["ahead"] == 0 and status["dirty"] is False

    r = await api.post(f"{API}/git/pull", headers=headers)
    assert r.status_code == 200, r.text
    pulled = r.json()
    assert pulled["updated"] is True
    # The merged bump is indexed by the backfill, in a commit pushed back.
    assert {"id": "3", "version": "3.3.3", "commit": merged} in pulled["indexed"]
    assert remote.remote_rev("main") == pulled["indexCommitSha"] == pulled["head"]
    assert json.loads(remote.remote_file("main", "concept_sets_versions.json"))["3"]["3.3.3"] == merged

    r = await _submit(api, headers, draft_id, "commit")
    assert r.status_code == 200, r.text


def _bump(root, cs_id, version):
    path = root / f"concept_sets/{cs_id}.json"
    write(path, {**read(path), "version": version}, "concept-set")


async def test_pull_is_maintainer_only_and_refuses_divergence(api, db, remote):
    editor = await _user(db, api, "eve", "editor")
    maintainer = await _user(db, api, "mia", "maintainer")
    assert (await api.post(f"{API}/git/pull", headers=editor)).status_code == 403
    assert (await api.get(f"{API}/git/status")).status_code == 401

    other = remote.other_clone()
    (other / "x.txt").write_text("x")
    commit_all(other, "Remote")
    git(other, "push", "-q", "origin", "main")
    (remote.work / "y.txt").write_text("y")
    commit_all(remote.work, "Local")
    r = await api.post(f"{API}/git/pull", headers=maintainer)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "diverged"


async def test_reusing_a_published_version_is_refused(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    cs = _cs(remote, 1)
    cs["version"] = "8.0.0"
    assert (await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "commit")).status_code == 200
    cs = _cs(remote, 1)
    cs["version"] = "8.0.1"
    assert (await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "commit")).status_code == 200
    cs = _cs(remote, 1)
    cs["version"] = "8.0.0"
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "commit")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "version_published"


async def test_invalid_content_is_a_readable_422(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    cs = _cs(remote, 1)
    cs["metadata"]["reviewStatus"] = "pending review"
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "commit")
    assert r.status_code == 422
    detail = r.json()["detail"]
    assert detail["code"] == "invalid_content"
    assert any(e["pointer"] == "/metadata/reviewStatus" for e in detail["errors"])
    assert remote.remote_rev("main") == git(remote.work, "rev-parse", "HEAD")  # nothing pushed


async def test_draft_started_before_the_file_changed_is_refused(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    start = remote.remote_rev("main")
    cs = _cs(remote, 2)
    cs["tags"] = ["a"]
    first = await _draft(api, headers, "concept-set", 2, cs, base_commit=start)
    cs2 = _cs(remote, 2)
    cs2["tags"] = ["b"]
    second = await _draft(api, headers, "concept-set", 2, cs2, base_commit=start)
    assert (await _submit(api, headers, first, "commit")).status_code == 200
    r = await _submit(api, headers, second, "commit")
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "base_changed"


async def test_numbers_the_browser_rounded_are_written_back(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    path = remote.work / "units/unit_conversions.json"
    before = path.read_bytes()
    conversions = json.loads(before)  # floats like 1.0 come back as 1 from JS
    for row in conversions:
        for key, value in row.items():
            if isinstance(value, float) and value.is_integer():
                row[key] = int(value)
    conversions.append(dict(conversions[0]))
    r = await _submit(api, headers, await _draft(api, headers, "unit-conversions", None, conversions), "commit")
    assert r.status_code == 200, r.text
    after = remote.remote_file("main", "units/unit_conversions.json")
    # The existing rows are byte-identical; only the appended one is new.
    assert after.startswith(before[: before.rindex(b"}")])


# --- proposals ------------------------------------------------------------------


async def test_new_concept_set_proposal_allocates_an_id_and_opens_a_pr(api, db, remote, forge_calls):
    headers = await _user(db, api, "eve", "editor", first_name="Eve", last_name="Durand", email="eve@example.org")
    counters = read(remote.work / "id_counters.json")
    new_id = counters["nextConceptSetId"]
    cs = _cs(remote, 3)
    for key in ("id", "createdBy", "createdDate", "modifiedBy", "modifiedDate"):
        cs.pop(key)
    cs["metadata"].pop("uniqueId")
    cs["metadata"]["translations"]["en"]["name"] = "Brand new"
    before = remote.remote_rev("main")

    r = await _submit(api, headers, await _draft(api, headers, "concept-set", None, cs), "proposal", "Add a set")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["conceptSetId"] == new_id
    assert out["branch"].startswith("proposal/eve-concept-set-new-")
    assert out["proposalUrl"] == "https://github.com/indicate-eu/data-dictionary/pull/7"
    # main untouched, the branch holds one commit with the set and the counters.
    assert remote.remote_rev("main") == before
    assert out["branch"] in remote.remote_branches()
    names = git(remote.bare, "show", "--name-only", "--format=", out["commitSha"]).splitlines()
    assert sorted(names) == [f"concept_sets/{new_id}.json", "id_counters.json"]
    created = parse(remote.remote_file(out["branch"], f"concept_sets/{new_id}.json"))
    assert list(created)[:9] == [
        "id", "name", "description", "version", "createdBy", "createdDate",
        "modifiedBy", "modifiedDate", "createdByTool",
    ]  # fmt: skip
    assert created["createdBy"] == "Eve Durand" and created["name"] == "Brand new"
    assert created["metadata"]["createdByDetails"]["firstName"] == "Eve"
    assert len(created["metadata"]["uniqueId"]) == 36
    assert json.loads(remote.remote_file(out["branch"], "id_counters.json"))["nextConceptSetId"] == new_id + 1
    # Pushed with the service token: the user is credited in a trailer.
    message = git(remote.bare, "log", "-1", "--format=%B", out["commitSha"])
    assert "Co-authored-by: Eve Durand <eve@example.org>" in message

    (request,) = forge_calls
    assert request.url == httpx.URL("https://api.github.com/repos/indicate-eu/data-dictionary/pulls")
    assert request.headers["Authorization"] == "Bearer svc-token"
    payload = json.loads(request.content)
    assert payload["head"] == out["branch"] and payload["base"] == "main" and payload["title"] == "Add a set"


async def test_proposal_survives_a_forge_failure_with_a_manual_link(api, db, remote, monkeypatch):
    headers = await _user(db, api, "eve", "editor")
    monkeypatch.setattr(forge, "transport", httpx.MockTransport(lambda req: httpx.Response(422, json={"message": "x"})))
    cs = _cs(remote, 1)
    cs["tags"] = ["x"]
    out = (await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "proposal")).json()
    assert out["branch"] in remote.remote_branches()
    assert "compare/main..." in out["proposalUrl"]
    assert "422" in out["proposalError"]


async def test_gitlab_merge_request(api, db, remote, monkeypatch):
    headers = await _user(db, api, "eve", "editor")
    config = read(remote.work / "config.json")
    config["repository"] = {"url": "https://gitlab.example.org/team/sub/dictionary", "branch": "main"}
    write(remote.work / "config.json", config)
    commit_all(remote.work, "GitLab fork")
    git(remote.work, "push", "-q", "origin", "main")
    seen = []

    def handler(request):
        seen.append(request)
        return httpx.Response(
            201, json={"web_url": "https://gitlab.example.org/team/sub/dictionary/-/merge_requests/1"}
        )

    monkeypatch.setattr(forge, "transport", httpx.MockTransport(handler))
    cs = _cs(remote, 1)
    cs["tags"] = ["x"]
    out = (await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "proposal")).json()
    assert out["proposalUrl"].endswith("/merge_requests/1")
    assert str(seen[0].url) == "https://gitlab.example.org/api/v4/projects/team%2Fsub%2Fdictionary/merge_requests"
    assert json.loads(seen[0].content)["source_branch"] == out["branch"]


async def test_reviewer_may_only_append_reviews(api, db, remote):
    headers = await _user(db, api, "rey", "reviewer")
    cs = _cs(remote, 1)
    cs["metadata"].setdefault("reviews", []).append(
        {"reviewer": {"firstName": "Rey"}, "version": cs["version"], "status": "approved", "comments": "Fine."}
    )
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "proposal")
    assert r.status_code == 200, r.text

    cs = _cs(remote, 1)
    cs["metadata"].setdefault("reviews", []).append({"reviewer": {"firstName": "Rey"}, "version": cs["version"]})
    cs["tags"] = ["sneaky"]
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "proposal")
    assert r.status_code == 403
    assert r.json()["detail"]["code"] == "reviews_only"
    assert (
        await _submit(api, headers, await _draft(api, headers, "concept-set", 1, _cs(remote, 1)), "commit")
    ).status_code == 403


async def test_unknown_target_is_404(api, db, remote):
    headers = await _user(db, api, "eve", "editor")
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 999, _cs(remote, 1)), "proposal")
    assert r.status_code == 404
    assert r.json()["detail"]["code"] == "target_not_found"


async def test_new_project_commit_allocates_the_project_id(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    project = read(remote.work / "projects/1.json")
    project.pop("id")
    next_id = read(remote.work / "id_counters.json")["nextProjectId"]
    out = (await _submit(api, headers, await _draft(api, headers, "project", None, project), "commit")).json()
    assert out["targetId"] == next_id
    written = parse(remote.remote_file("main", f"projects/{next_id}.json"))
    assert written["id"] == next_id and list(written)[0] == "id"
    assert read(remote.work / "id_counters.json")["nextProjectId"] == next_id + 1


# --- resolved list --------------------------------------------------------------


def _expression(*ids: int, descendants: bool = False) -> dict:
    return {
        "items": [
            {
                "concept": {
                    "conceptId": i,
                    "conceptName": f"c{i}",
                    "domainId": "Condition",
                    "vocabularyId": "SNOMED",
                    "conceptClassId": "Disorder",
                    "standardConcept": "S",
                    "conceptCode": str(i),
                },
                "isExcluded": False,
                "includeDescendants": descendants,
                "includeMapped": False,
            }
            for i in ids
        ]
    }


async def test_a_changed_expression_carries_its_resolved_list(api, db, remote):
    build_library()
    headers = await _user(db, api, "mia", "maintainer")
    cs = _cs(remote, 2)
    cs["expression"] = _expression(103, descendants=True)
    out = (await _submit(api, headers, await _draft(api, headers, "concept-set", 2, cs), "commit")).json()
    assert out.get("resolved") == "updated", out
    raw = remote.remote_file(out["commitSha"], "concept_sets_resolved/2.json")
    assert not raw.endswith(b"\n")  # resolve.py's format: no trailing newline
    resolved = json.loads(raw)
    assert list(resolved) == ["conceptSetId", "vocabularyVersion", "resolvedConcepts"]
    assert resolved["conceptSetId"] == 2
    assert [c["conceptId"] for c in resolved["resolvedConcepts"]] == [103, 104, 105, 106]

    # Same expression again: nothing resolved, the list stays.
    cs2 = _cs(remote, 2)
    cs2["metadata"]["translations"]["en"]["longDescription"] = "x"
    out2 = (await _submit(api, headers, await _draft(api, headers, "concept-set", 2, cs2), "commit")).json()
    assert "resolved" not in out2


async def test_without_a_vocabulary_the_resolved_list_is_reported_stale(api, db, remote):
    headers = await _user(db, api, "mia", "maintainer")
    cs = _cs(remote, 2)
    before = remote.remote_file("main", "concept_sets_resolved/2.json")
    cs["expression"] = _expression(103)
    out = (await _submit(api, headers, await _draft(api, headers, "concept-set", 2, cs), "commit")).json()
    assert out["resolved"] == "stale"
    assert remote.remote_file("main", "concept_sets_resolved/2.json") == before


async def test_a_token_never_goes_to_a_forge_other_than_the_remote_host(api, db, remote, forge_calls, monkeypatch):
    """With an ssh remote, the PR is opened on config.json `repository.url`,
    which a config commit can change: the token must not follow it to another host."""
    config = read(remote.work / "config.json")
    config["repository"] = {"url": "https://attacker.example/indicate-eu/data-dictionary", "branch": "main"}
    write(remote.work / "config.json", config)
    commit_all(remote.work, "Point the repository elsewhere")
    git(remote.work, "push", "-q", "origin", "main")

    real_push = ContentRepo.push
    monkeypatch.setattr(ContentRepo, "remote_url", lambda self: "git@github.com:indicate-eu/data-dictionary.git")
    # The push itself still goes to the local bare remote.
    monkeypatch.setattr(ContentRepo, "_network_url", lambda self, token: str(remote.bare))
    monkeypatch.setattr(ContentRepo, "push", real_push)

    headers = await _user(db, api, "eve", "editor")
    cs = _cs(remote, 1)
    cs["tags"] = ["x"]
    r = await _submit(api, headers, await _draft(api, headers, "concept-set", 1, cs), "proposal")
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["branch"] in remote.remote_branches()
    assert forge_calls == []
    assert out["proposalError"]
