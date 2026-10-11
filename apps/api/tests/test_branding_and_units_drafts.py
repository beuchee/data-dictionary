"""Config drafts carrying branding images, the route serving them, build.py's
copy of `branding/`, and unit-conversion drafts keeping number lexemes."""

import base64
import json

import httpx
import pytest
from dictionary_format import parse

from app.main import app
from app.services import branding_assets, catalog_build, forge
from app.services.content_store import ContentStore, get_content_store
from app.services.git_service import get_content_repo

from conftest import API, create_user, login
from git_fixtures import commit_all, git, make_remote, read

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 32
ICO = b"\x00\x00\x01\x00" + b"\x01" * 16
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"><rect width="1" height="1"/></svg>'


def _b64(data: bytes) -> dict:
    return {"filename": "x", "base64": base64.b64encode(data).decode()}


# --- pure ---------------------------------------------------------------------


@pytest.mark.parametrize(
    ("data", "ext"),
    [
        (PNG, "png"),
        (b"\xff\xd8\xff\xe0" + b"0" * 8, "jpg"),
        (b"GIF89a" + b"0" * 8, "gif"),
        (b"RIFF\x00\x00\x00\x00WEBPVP8 ", "webp"),
        (ICO, "ico"),
        (SVG, "svg"),
        (b'<?xml version="1.0"?>\n' + SVG, "svg"),
        (b"%PDF-1.7", None),
        (b"<html><body>hi</body></html>", None),
    ],
)
def test_sniff_type(data, ext):
    assert branding_assets.sniff_type(data) == ext


def test_decode_refuses_bad_input():
    with pytest.raises(branding_assets.AssetError) as e:
        branding_assets.decode_asset("logo", {"base64": "not base64!!"})
    assert e.value.code == "invalid_asset"
    with pytest.raises(branding_assets.AssetError) as e:
        branding_assets.decode_asset("logo", _b64(b"%PDF-1.7 nope"))
    assert e.value.code == "unsupported_asset_type"
    with pytest.raises(branding_assets.AssetError) as e:
        branding_assets.decode_asset("favicon", _b64(PNG + b"\x00" * branding_assets.MAX_BYTES["favicon"]))
    assert e.value.code == "asset_too_large"
    with pytest.raises(branding_assets.AssetError) as e:
        branding_assets.decode_asset("banner", _b64(PNG))
    assert e.value.code == "unknown_asset"
    for evil in (
        b"<script>alert(1)</script>",
        b'<rect onload="x()"/>',
        b'<a href="javascript:x">',
        b"<foreignObject/>",
        # Namespace prefixes: an SVG document is XML, `svg:script` runs.
        b'<svg:script xmlns:svg="http://www.w3.org/2000/svg">alert(1)</svg:script>',
        b'<x:foreignObject xmlns:x="http://www.w3.org/2000/svg"/>',
        # Character references and whitespace inside the scheme.
        b'<a href="&#106;avascript:alert(1)">',
        b'<a href="&#x6A;&#x61;vascript&#58;alert(1)">',
        b'<a href="java\tscript:alert(1)">',
        b'<a href="java&#10;script:alert(1)">',
        b'<set attributeName="on&#108;oad" to="x()"/>',
        # An XSLT stylesheet turns the document into script-running HTML.
        b'<?xml-stylesheet type="text/xsl" href="https://evil.example/x.xsl"?>',
    ):
        with pytest.raises(branding_assets.AssetError) as e:
            branding_assets.decode_asset("logo", _b64(SVG.replace(b"<rect", evil + b"<rect")))
        assert e.value.code == "unsafe_svg"


def test_decode_accepts_a_data_url():
    url = "data:image/png;base64," + base64.b64encode(PNG).decode()
    assert branding_assets.decode_asset("logo", {"filename": "a.png", "base64": url}) == ("png", PNG)


def test_apply_assets_points_config_at_branding_dir_and_drops_replaced_files():
    existing = {"branding/logo.svg": SVG}
    content = {"title": "X", "branding": {"logo": "branding/logo.svg"}, "$assets": {"logo": _b64(PNG)}}
    base = {"title": "X", "branding": {"logo": "branding/logo.svg"}}
    files = branding_assets.apply_assets(content, base, existing.get)
    assert "$assets" not in content
    assert content["branding"]["logo"] == "branding/logo.png"
    assert files == {"branding/logo.png": PNG, "branding/logo.svg": None}


def test_apply_assets_skips_identical_images_and_keeps_v1_paths():
    content = {"title": "X", "branding": {"logo": "logo.png"}, "$assets": {"favicon": _b64(ICO)}}
    files = branding_assets.apply_assets(content, {"branding": {"logo": "logo.png"}}, {"branding/favicon.ico": ICO}.get)
    assert files == {}
    assert content["branding"] == {"logo": "logo.png", "favicon": "branding/favicon.ico"}


def test_resolve_asset_file_stays_inside_root(tmp_path):
    (tmp_path / "legacy").mkdir()
    (tmp_path / "legacy" / "logo.png").write_bytes(PNG)
    (tmp_path / "branding").mkdir()
    (tmp_path / "branding" / "favicon.ico").write_bytes(ICO)
    (tmp_path.parent / "secret.png").write_bytes(PNG)
    cfg = {"branding": {"logo": "logo.png", "favicon": "branding/favicon.ico"}}
    assert branding_assets.resolve_asset_file(tmp_path, cfg, "logo") == (tmp_path / "legacy" / "logo.png").resolve()
    assert (
        branding_assets.resolve_asset_file(tmp_path, cfg, "favicon")
        == (tmp_path / "branding" / "favicon.ico").resolve()
    )
    for bad in ("../secret.png", "/../secret.png", "legacy/../../secret.png"):
        assert branding_assets.resolve_asset_file(tmp_path, {"branding": {"logo": bad}}, "logo") is None


def test_build_copies_branding_dir(tmp_path):
    root = tmp_path / "repo"
    (root / "branding").mkdir(parents=True)
    (root / "branding" / "logo.png").write_bytes(PNG)
    out = tmp_path / "out"
    (out / "branding").mkdir(parents=True)
    (out / "branding" / "stale.png").write_bytes(PNG)
    catalog_build.copy_branding(root, out)
    assert sorted(p.name for p in (out / "branding").iterdir()) == ["logo.png"]
    # No branding/ in the repository: nothing left behind.
    catalog_build.copy_branding(tmp_path / "empty", out)
    assert not (out / "branding").exists()


# --- end to end ---------------------------------------------------------------


@pytest.fixture
def remote(tmp_path, monkeypatch):
    return make_remote(tmp_path, monkeypatch)


@pytest.fixture
def api(client, remote, monkeypatch):
    monkeypatch.setattr(forge, "transport", httpx.MockTransport(lambda r: httpx.Response(404)))
    app.dependency_overrides[get_content_repo] = lambda: remote.repo()
    store = ContentStore(remote.work, check_interval=0)
    app.dependency_overrides[get_content_store] = lambda: store
    return client


async def _maintainer(db, client):
    await create_user(db, "mia", "maintainer")
    return await login(client, "mia")


async def _commit_draft(api, headers, kind, content):
    r = await api.post(f"{API}/drafts", json={"kind": kind, "targetId": None, "content": content}, headers=headers)
    assert r.status_code == 201, r.text
    return await api.post(f"{API}/drafts/{r.json()['id']}/submit", json={"mode": "commit"}, headers=headers)


async def test_config_draft_commits_branding_images(api, db, remote):
    headers = await _maintainer(db, api)
    config = read(remote.work / "config.json")
    config["branding"]["colors"] = {"primary": "#1f6feb"}
    config["$assets"] = {"logo": _b64(PNG), "favicon": _b64(ICO)}
    r = await _commit_draft(api, headers, "config", config)
    assert r.status_code == 200, r.text

    saved = parse(remote.remote_file("main", "config.json"))
    assert "$assets" not in saved
    assert saved["branding"]["logo"] == "branding/logo.png"
    assert saved["branding"]["favicon"] == "branding/favicon.ico"
    assert saved["branding"]["colors"] == {"primary": "#1f6feb"}
    assert remote.remote_file("main", "branding/logo.png") == PNG
    assert remote.remote_file("main", "branding/favicon.ico") == ICO

    r = await api.get(f"{API}/instance/branding/logo")
    assert r.status_code == 200
    assert r.headers["content-type"] == "image/png"
    assert r.content == PNG
    assert "sandbox" in r.headers["content-security-policy"]
    assert (await api.get(f"{API}/instance/branding/banner")).status_code == 404


async def test_config_draft_with_a_bad_image_is_refused_at_save(api, db, remote):
    headers = await _maintainer(db, api)
    config = read(remote.work / "config.json")
    config["$assets"] = {"logo": _b64(b"MZ\x90\x00 executable")}
    r = await api.post(f"{API}/drafts", json={"kind": "config", "targetId": None, "content": config}, headers=headers)
    assert r.status_code == 422


async def test_editing_one_conversion_keeps_the_other_rows_lexemes(api, db, remote):
    """A `1.0` factor survives an edit of another row and a deletion that shifts it."""
    headers = await _maintainer(db, api)
    path = remote.work / "units/unit_conversions.json"
    rows = read(path)
    one = dict(rows[0], conceptId=99, conversionFactor=1.0)
    text = path.read_text(encoding="utf-8")
    # Write the 1.0 row by hand, as the real file has it.
    rows_text = json.dumps([*json.loads(text), {**one}], indent=2, ensure_ascii=False) + "\n"
    assert '"conversionFactor": 1.0' in rows_text
    path.write_text(rows_text, encoding="utf-8")
    commit_all(remote.work, "Add a 1.0 factor")
    git(remote.work, "push", "-q", "origin", "main")

    # What the web app sends: the file parsed losslessly (1.0 stays a raw lexeme),
    # the first row's factor edited, the second row deleted.
    edited = parse(path.read_bytes())
    edited[0]["conversionFactor"] = 2.5
    del edited[1]
    r = await _commit_draft(api, headers, "unit-conversions", edited)
    assert r.status_code == 200, r.text
    after = remote.remote_file("main", "units/unit_conversions.json").decode()
    assert '"conversionFactor": 2.5' in after
    assert '"conversionFactor": 1.0' in after
