"""`POST /vocabulary/sql`: read-only SQL over the vocabulary, for Dev tools.
Admins only (`settings:manage`); see services/vocabulary_sql.py for the locks."""

import asyncio

import duckdb
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import Field

from app.core.deps import require_permission
from app.core.json_response import json_response
from app.schemas.base import CamelModel
from app.services import vocabulary as lib
from app.services import vocabulary_sql as vsql

router = APIRouter(prefix="/vocabulary", tags=["vocabulary"])

_manage = require_permission("settings:manage")


class SqlRequest(CamelModel):
    sql: str = Field(min_length=1, max_length=vsql.MAX_SQL_LENGTH)
    limit: int = Field(1000, ge=1, le=vsql.MAX_ROWS)


@router.post("/sql")
async def run_sql(body: SqlRequest, _user=Depends(_manage)):
    """`{columns, rows, rowCount, truncated, elapsedMs}`; 400 for a refused or
    failing statement, 408 past the time limit, 503 without a vocabulary."""
    try:
        result = await asyncio.to_thread(vsql.run_query, body.sql, body.limit)
    except vsql.SqlRefused as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from None
    except vsql.SqlTimeout as e:
        raise HTTPException(status.HTTP_408_REQUEST_TIMEOUT, str(e)) from None
    except lib.VocabularyUnavailable:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, "No OMOP vocabulary has been imported") from None
    except duckdb.Error as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e).splitlines()[0][:500]) from None
    return json_response(result)
