import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import StaticPool

import app.models  # noqa: F401  -- populate Base.metadata
from app.config import settings
from app.core import crypto, security
from app.core.database import get_db
from app.core.permissions import seed_default_roles
from app.core.security import hash_password
from app.main import app
from app.models.base import Base
from app.models.user import User

# Production-cost bcrypt (~250 ms per hash or verify) would dominate the
# suite's runtime. 4 is bcrypt's minimum and keeps the exact same code path.
security.BCRYPT_ROUNDS = 4
settings.secret_key = "test-secret-long-enough-for-hs256-0123456789"

API = "/api/v1"
TEST_PASSWORD = "pw-for-tests-only"


@pytest.fixture(autouse=True)
def _isolate_data_dir(tmp_path, monkeypatch):
    """Point the data dir at a temp dir so tests never touch ~/.data-dictionary."""
    monkeypatch.setattr(settings, "data_dir", str(tmp_path))
    # data_path is a cached_property: drop any cached value so it re-resolves.
    settings.__dict__.pop("data_path", None)
    # The encryption key lives in data_dir: each test gets its own.
    crypto.reset_keyring()
    yield
    settings.__dict__.pop("data_path", None)
    crypto.reset_keyring()


@pytest_asyncio.fixture
async def engine():
    # One shared in-memory connection, so the schema persists across sessions.
    eng = create_async_engine(
        "sqlite+aiosqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    @event.listens_for(eng.sync_engine, "connect")
    def _fk_pragma(dbapi_conn, _record):
        cur = dbapi_conn.cursor()
        cur.execute("PRAGMA foreign_keys=ON")
        cur.close()

    async with eng.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield eng
    await eng.dispose()


@pytest_asyncio.fixture
async def maker(engine):
    return async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)


@pytest_asyncio.fixture
async def db(maker) -> AsyncSession:
    async with maker() as session:
        yield session


@pytest_asyncio.fixture
async def seed_roles(maker):
    """The lifespan seeds the system roles in production; permission checks
    resolve a role name to its Role row, so the rows must exist here too."""
    async with maker() as session:
        await seed_default_roles(session)


def override_db(target, maker) -> None:
    async def _override_get_db():
        async with maker() as session:
            yield session

    target.dependency_overrides[get_db] = _override_get_db


@pytest_asyncio.fixture
async def client(maker, seed_roles):
    override_db(app, maker)
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


async def create_user(db, username: str, role: str = "viewer", password: str = TEST_PASSWORD) -> User:
    user = User(username=username, password_hash=hash_password(password), role=role)
    db.add(user)
    await db.commit()
    return user


async def login(client, username: str, password: str = TEST_PASSWORD) -> dict:
    r = await client.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}
