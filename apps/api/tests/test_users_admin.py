"""Account administration (/users, /roles) and linked identities (/auth/identities)."""

from sqlalchemy import select

from app.models.git_credential import GitCredential
from app.models.role import Role
from app.models.user import User
from app.models.user_identity import UserIdentity

from conftest import API, TEST_PASSWORD, create_user, login

NEW_PASSWORD = "a-temporary-password-42"


async def _admin(db, client, name="root"):
    user = await create_user(db, name, "admin")
    return user, await login(client, name)


async def test_list_users_with_identities(client, db):
    admin, headers = await _admin(db, client)
    bob = await create_user(db, "bob", "editor")
    db.add(UserIdentity(user_id=bob.id, provider="github", subject="42", username="bobgh"))
    await db.commit()

    r = await client.get(f"{API}/users", headers=headers)
    assert r.status_code == 200, r.text
    rows = {u["username"]: u for u in r.json()}
    assert set(rows) == {"root", "bob"}
    assert rows["bob"]["role"] == "editor"
    assert rows["bob"]["isActive"] is True
    assert rows["bob"]["hasPassword"] is True
    assert [(i["provider"], i["username"]) for i in rows["bob"]["identities"]] == [("github", "bobgh")]
    assert rows["root"]["lastLogin"] is not None
    assert "passwordHash" not in rows["bob"]


async def test_non_admin_cannot_list_or_change_roles(client, db):
    await create_user(db, "root", "admin")
    target = await create_user(db, "bob", "viewer")
    for role in ("viewer", "editor", "maintainer"):
        await create_user(db, f"u-{role}", role)
        headers = await login(client, f"u-{role}")
        assert (await client.get(f"{API}/users", headers=headers)).status_code == 403
        r = await client.patch(f"{API}/users/{target.id}", json={"role": "maintainer"}, headers=headers)
        assert r.status_code == 403
        r = await client.post(
            f"{API}/users/{target.id}/reset-password", json={"password": NEW_PASSWORD}, headers=headers
        )
        assert r.status_code == 403
    await db.refresh(target)
    assert target.role == "viewer"


async def test_anonymous_is_refused(client, db):
    assert (await client.get(f"{API}/users")).status_code in (401, 403)


async def test_change_role_and_deactivate(client, db):
    _, headers = await _admin(db, client)
    bob = await create_user(db, "bob", "viewer")
    r = await client.patch(f"{API}/users/{bob.id}", json={"role": "maintainer"}, headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["role"] == "maintainer"

    r = await client.patch(f"{API}/users/{bob.id}", json={"isActive": False}, headers=headers)
    assert r.status_code == 200
    assert r.json()["isActive"] is False
    r = await client.post(f"{API}/auth/login", json={"username": "bob", "password": TEST_PASSWORD})
    assert r.status_code == 401

    r = await client.patch(f"{API}/users/{bob.id}", json={"isActive": True}, headers=headers)
    assert r.json()["isActive"] is True
    assert (
        await client.post(f"{API}/auth/login", json={"username": "bob", "password": TEST_PASSWORD})
    ).status_code == 200


async def test_unknown_role_is_refused(client, db):
    _, headers = await _admin(db, client)
    bob = await create_user(db, "bob")
    r = await client.patch(f"{API}/users/{bob.id}", json={"role": "superuser"}, headers=headers)
    assert r.status_code == 422


async def test_cannot_demote_or_deactivate_the_last_admin(client, db):
    root, headers = await _admin(db, client)
    other = await create_user(db, "other-admin", "admin")
    other.is_active = False
    await db.commit()

    # An inactive admin does not count: root is the last active one.
    r = await client.patch(f"{API}/users/{root.id}", json={"role": "maintainer"}, headers=headers)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "last_admin"

    # Reactivating the other admin makes the demotion possible.
    assert (await client.patch(f"{API}/users/{other.id}", json={"isActive": True}, headers=headers)).status_code == 200
    r = await client.patch(f"{API}/users/{other.id}", json={"role": "editor"}, headers=headers)
    assert r.status_code == 200
    r = await client.patch(f"{API}/users/{root.id}", json={"role": "editor"}, headers=headers)
    assert r.status_code == 409


async def test_cannot_deactivate_the_last_admin_from_another_admin(client, db):
    await create_user(db, "a1", "admin")
    a2 = await create_user(db, "a2", "admin")
    h1 = await login(client, "a1")
    assert (await client.patch(f"{API}/users/{a2.id}", json={"isActive": False}, headers=h1)).status_code == 200
    a1 = await db.scalar(select(User).where(User.username == "a1"))
    # a1 is now the only active admin, and may not deactivate itself either.
    r = await client.patch(f"{API}/users/{a1.id}", json={"isActive": False}, headers=h1)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] in ("self_deactivation", "last_admin")


async def test_users_manage_without_admin_cannot_grant_admin(client, db, maker):
    from app.models.role import Role

    _, _admin_headers = await _admin(db, client)
    role = await db.scalar(select(Role).where(Role.name == "maintainer"))
    role.permissions = [*role.permissions, "users:manage"]
    await db.commit()
    await create_user(db, "mia", "maintainer")
    headers = await login(client, "mia")
    bob = await create_user(db, "bob")
    r = await client.patch(f"{API}/users/{bob.id}", json={"role": "admin"}, headers=headers)
    assert r.status_code == 403
    r = await client.patch(f"{API}/users/{bob.id}", json={"role": "editor"}, headers=headers)
    assert r.status_code == 200


async def test_reset_password_sets_a_temporary_one_and_ends_sessions(client, db):
    _, headers = await _admin(db, client)
    bob = await create_user(db, "bob")
    bob_headers = await login(client, "bob")
    r = await client.post(f"{API}/users/{bob.id}/reset-password", json={"password": "short"}, headers=headers)
    assert r.status_code == 422
    r = await client.post(f"{API}/users/{bob.id}/reset-password", json={"password": NEW_PASSWORD}, headers=headers)
    assert r.status_code == 200, r.text
    assert (await client.get(f"{API}/auth/me", headers=bob_headers)).status_code == 401
    assert (
        await client.post(f"{API}/auth/login", json={"username": "bob", "password": NEW_PASSWORD})
    ).status_code == 200


async def test_roles_are_listed_with_permissions(client, db):
    _, headers = await _admin(db, client)
    r = await client.get(f"{API}/roles", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert [x["name"] for x in body["roles"]] == ["viewer", "reviewer", "editor", "maintainer", "admin"]
    admin = body["roles"][-1]
    assert "users:manage" in admin["permissions"]
    assert body["catalogue"]["units"] == ["write"]


# --- linked identities --------------------------------------------------------


async def test_identities_list_and_unlink(client, db):
    bob = await create_user(db, "bob")
    db.add_all(
        [
            UserIdentity(user_id=bob.id, provider="github", subject="1", username="bobgh"),
            UserIdentity(user_id=bob.id, provider="orcid", subject="0000-0002-1825-0097"),
            GitCredential(user_id=bob.id, host="github.com", secret="x", source="oauth:github"),
        ]
    )
    await db.commit()
    headers = await login(client, "bob")
    r = await client.get(f"{API}/auth/identities", headers=headers)
    assert r.status_code == 200
    body = r.json()
    assert body["hasPassword"] is True
    github = next(i for i in body["identities"] if i["provider"] == "github")

    r = await client.delete(f"{API}/auth/identities/{github['id']}", headers=headers)
    assert r.status_code == 200
    assert [i["provider"] for i in r.json()["identities"]] == ["orcid"]
    assert await db.scalar(select(GitCredential).where(GitCredential.user_id == bob.id)) is None


async def test_cannot_unlink_the_last_sign_in_method(client, db):
    bob = await create_user(db, "bob")
    identity = UserIdentity(user_id=bob.id, provider="github", subject="1")
    db.add(identity)
    await db.commit()
    headers = await login(client, "bob")
    bob.password_hash = None
    await db.commit()

    r = await client.delete(f"{API}/auth/identities/{identity.id}", headers=headers)
    assert r.status_code == 409
    assert r.json()["detail"]["code"] == "last_sign_in_method"


async def test_cannot_unlink_someone_elses_identity(client, db):
    alice = await create_user(db, "alice")
    other = UserIdentity(user_id=alice.id, provider="github", subject="9")
    db.add(other)
    await db.commit()
    await create_user(db, "bob")
    headers = await login(client, "bob")
    assert (await client.delete(f"{API}/auth/identities/{other.id}", headers=headers)).status_code == 404


async def _manager(db, client):
    """A non-admin role holding users:manage (no default role does)."""
    db.add(Role(name="manager", label={"en": "Manager"}, permissions=["users:manage"], is_system=False))
    await db.commit()
    await create_user(db, "manager", "manager")
    return await login(client, "manager")


async def test_users_manage_without_admin_never_reaches_an_admin_account(client, db):
    root = await create_user(db, "root", "admin")
    await create_user(db, "root2", "admin")
    headers = await _manager(db, client)

    # Taking over an admin by setting their password, or locking them out.
    r = await client.post(f"{API}/users/{root.id}/reset-password", headers=headers, json={"password": NEW_PASSWORD})
    assert r.status_code == 403, r.text
    assert r.json()["detail"]["code"] == "admin_only"
    r = await client.patch(f"{API}/users/{root.id}", headers=headers, json={"isActive": False})
    assert r.status_code == 403, r.text
    r = await client.patch(f"{API}/users/{root.id}", headers=headers, json={"role": "viewer"})
    assert r.status_code == 403, r.text
    await login(client, "root")

    # Other accounts stay theirs to manage.
    bob = await create_user(db, "bob", "viewer")
    r = await client.post(f"{API}/users/{bob.id}/reset-password", headers=headers, json={"password": NEW_PASSWORD})
    assert r.status_code == 200, r.text
    r = await client.patch(f"{API}/users/{bob.id}", headers=headers, json={"isActive": False})
    assert r.status_code == 200, r.text
