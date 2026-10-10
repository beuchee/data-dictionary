from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.core.database import get_db
from app.core.permissions import ADMIN_ROLE
from app.core.security import hash_password, password_policy_error
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


@router.post("/initialize", response_model=UserResponse)
async def setup_initialize(request: SetupRequest, db: AsyncSession = Depends(get_db)):
    """Create the first admin. Refused as soon as any user exists."""
    if await _user_count(db) > 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Setup already completed")
    username = request.username.strip()
    if not username:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "The username must not be blank")
    if error := password_policy_error(request.password, username):
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, error)
    user = User(
        username=username,
        email=request.email,
        first_name=request.first_name,
        last_name=request.last_name,
        password_hash=hash_password(request.password),
        role=ADMIN_ROLE,
    )
    db.add(user)
    await db.commit()
    await db.refresh(user)
    return user
