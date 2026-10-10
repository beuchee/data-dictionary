"""The global permission catalogue, the seeded role ladder, and enforcement."""

import pytest
import pytest_asyncio
from fastapi import Depends, FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import select

from app.core.deps import require_permission
from app.core.permissions import ALL_PERMISSIONS, CATALOGUE, DEFAULT_ROLES, seed_default_roles
from app.models.role import Role

from conftest import API, create_user, login, override_db

LADDER = ["viewer", "reviewer", "editor", "maintainer", "admin"]
ROLE_PERMISSIONS = {spec["name"]: set(spec["permissions"]) for spec in DEFAULT_ROLES}


def test_the_ladder_is_strictly_increasing_and_admin_holds_everything():
    assert [spec["name"] for spec in DEFAULT_ROLES] == LADDER
    for lower, higher in zip(LADDER, LADDER[1:], strict=False):
        assert ROLE_PERMISSIONS[lower] < ROLE_PERMISSIONS[higher], (lower, higher)
    assert ROLE_PERMISSIONS["admin"] == set(ALL_PERMISSIONS)


def test_every_role_permission_is_in_the_catalogue():
    known = {f"{r}:{a}" for r, actions in CATALOGUE.items() for a in actions}
    for spec in DEFAULT_ROLES:
        assert set(spec["permissions"]) <= known, spec["name"]
    assert len(ALL_PERMISSIONS) == len(set(ALL_PERMISSIONS))


@pytest.mark.parametrize("role, granted, refused", [
    ("viewer", "concept-sets:read", "reviews:write"),
    ("reviewer", "reviews:write", "concept-sets:propose"),
    ("editor", "concept-sets:propose", "concept-sets:commit"),
    ("maintainer", "concept-sets:commit", "users:manage"),
])
def test_where_each_role_stops(role, granted, refused):
    assert granted in ROLE_PERMISSIONS[role]
    assert refused not in ROLE_PERMISSIONS[role]


async def test_seeding_is_idempotent_and_keeps_an_admins_edits(db, seed_roles):
    viewer = await db.scalar(select(Role).where(Role.name == "viewer"))
    viewer.permissions = ["concept-sets:read"]
    await db.commit()

    await seed_default_roles(db)

    roles = list(await db.scalars(select(Role)))
    assert sorted(r.name for r in roles) == sorted(LADDER)
    assert all(r.is_system for r in roles)
    await db.refresh(viewer)
    assert viewer.permissions == ["concept-sets:read"]


@pytest_asyncio.fixture
async def guarded(maker, seed_roles):
    """A throwaway app with one route per catalogue permission, so enforcement
    is tested on every permission rather than on the few routes that exist yet."""
    guarded_app = FastAPI()
    for permission in ALL_PERMISSIONS:
        async def _endpoint(_user=Depends(require_permission(permission))):
            return {"ok": True}

        guarded_app.add_api_route(f"/guarded/{permission}", _endpoint, methods=["POST"])

    from app.main import app as main_app

    override_db(guarded_app, maker)
    async with (
        AsyncClient(transport=ASGITransport(app=main_app), base_url="http://test") as main_client,
        AsyncClient(transport=ASGITransport(app=guarded_app), base_url="http://test") as guarded_client,
    ):
        override_db(main_app, maker)
        yield main_client, guarded_client
    main_app.dependency_overrides.clear()


@pytest.mark.parametrize("role", LADDER)
async def test_each_role_reaches_exactly_its_permissions(guarded, db, role):
    main_client, guarded_client = guarded
    await create_user(db, f"user-{role}", role=role)
    headers = await login(main_client, f"user-{role}")

    me = (await main_client.get(f"{API}/auth/me", headers=headers)).json()
    assert set(me["permissions"]) == ROLE_PERMISSIONS[role]

    for permission in ALL_PERMISSIONS:
        r = await guarded_client.post(f"/guarded/{permission}", headers=headers)
        expected = 200 if permission in ROLE_PERMISSIONS[role] else 403
        assert r.status_code == expected, (role, permission)


async def test_a_viewer_is_refused_a_write(guarded, db):
    main_client, guarded_client = guarded
    await create_user(db, "reader", role="viewer")
    headers = await login(main_client, "reader")
    for permission in ("concept-sets:propose", "concept-sets:commit", "reviews:write", "units:write"):
        assert (await guarded_client.post(f"/guarded/{permission}", headers=headers)).status_code == 403


async def test_anonymous_is_refused(guarded):
    _, guarded_client = guarded
    assert (await guarded_client.post("/guarded/concept-sets:read")).status_code == 401


async def test_an_unknown_role_grants_nothing(guarded, db):
    main_client, guarded_client = guarded
    await create_user(db, "ghost", role="no-such-role")
    headers = await login(main_client, "ghost")
    assert (await guarded_client.post("/guarded/concept-sets:read", headers=headers)).status_code == 403


async def test_admin_bypasses_its_role_row(guarded, db):
    """Emptying the admin role's permissions must not lock everyone out."""
    main_client, guarded_client = guarded
    admin_role = await db.scalar(select(Role).where(Role.name == "admin"))
    admin_role.permissions = []
    await db.commit()
    await create_user(db, "root", role="admin")
    headers = await login(main_client, "root")
    assert (await guarded_client.post("/guarded/users:manage", headers=headers)).status_code == 200


async def test_an_edited_role_takes_effect_without_a_new_login(guarded, db):
    main_client, guarded_client = guarded
    await create_user(db, "reader", role="viewer")
    headers = await login(main_client, "reader")
    assert (await guarded_client.post("/guarded/reviews:write", headers=headers)).status_code == 403

    viewer = await db.scalar(select(Role).where(Role.name == "viewer"))
    viewer.permissions = [*viewer.permissions, "reviews:write"]
    await db.commit()
    assert (await guarded_client.post("/guarded/reviews:write", headers=headers)).status_code == 200
