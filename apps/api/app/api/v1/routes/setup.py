import asyncio
import weakref

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_db
from app.core.permissions import ADMIN_ROLE
from app.core.security import hash_password, password_policy_error, username_error
from app.models.user import User
from app.schemas.auth import SetupRequest, SetupStatusResponse, UserResponse

router = APIRouter(prefix="/setup", tags=["setup"])


async def _user_count(db: AsyncSession) -> int:
    return await db.scalar(select(func.count(User.id))) or 0


@router.get("/status", response_model=SetupStatusResponse)
async def setup_status(db: AsyncSession = Depends(get_db)):
    """Whether the first-run setup is still needed (no user exists yet)."""
    return SetupStatusResponse(
        needs_setup=await _user_count(db) == 0,
        password_min_length=settings.password_min_length,
    )


# One check-then-insert at a time: concurrent first-run submissions would all
# see no user and each create an admin. One API process (docker/api-entrypoint.sh);
# a lock per event loop, as an asyncio.Lock is bound to the loop it waits on.
_setup_locks: "weakref.WeakKeyDictionary[asyncio.AbstractEventLoop, asyncio.Lock]" = weakref.WeakKeyDictionary()


def _setup_lock() -> asyncio.Lock:
    loop = asyncio.get_running_loop()
    lock = _setup_locks.get(loop)
    if lock is None:
        lock = _setup_locks[loop] = asyncio.Lock()
    return lock


@router.post("/initialize", response_model=UserResponse)
async def setup_initialize(request: SetupRequest, db: AsyncSession = Depends(get_db)):
    """Create the first admin. Refused as soon as any user exists."""
    # Before any hashing: once set up, this public route costs nothing.
    if await _user_count(db) > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Setup already completed")
    username = request.username.strip()
    if error := username_error(username):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
    if error := password_policy_error(request.password, username):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
    password_hash = hash_password(request.password)
    async with _setup_lock():
        if await _user_count(db) > 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Setup already completed")
        user = User(
            username=username,
            email=request.email,
            first_name=request.first_name,
            last_name=request.last_name,
            password_hash=password_hash,
            role=ADMIN_ROLE,
        )
        db.add(user)
        await db.commit()
    await db.refresh(user)
    return user
