"""Imported mappings (v2 plan §7): an uploaded file parsed server-side into
normalized rows, shared by the whole instance and not versioned. The coverage
of each project is computed in the browser from `GET /mappings/{id}`.

Reads follow `require_read("mappings:read")`; create and delete need
`mappings:write` (editor and up).
"""

import asyncio
import gzip
import json
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, File, Form, HTTPException, Path, UploadFile, status
from fastapi.responses import Response
from sqlalchemy import delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.datetime_format import to_iso_ms_z
from app.core.deps import require_permission, require_read
from app.core.json_response import json_response
from app.models.mapping_import import MappingImport, MappingImportRows
from app.models.user import User
from app.services import mapping_import as mi

logger = structlog.get_logger()

router = APIRouter(prefix="/mappings", tags=["mappings"])

_read = require_read("mappings:read")
_write = require_permission("mappings:write")

# Bytes accepted per import, all files together.
MAX_UPLOAD_BYTES = 256 * 1024**2
MAX_FILES = 10

ImportId = Annotated[str, Path(max_length=36)]

_OPTION_KEYS = {"format", "delimiter", "encoding", "sheet", "hasHeader", "skipRows", "columns"}
_DELIMITERS = {"auto", ",", ";", "\t", "|"}
_ENCODINGS = {"auto", "utf-8", "windows-1252"}


def _bad(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_400_BAD_REQUEST, detail)


def _parse_options(raw: str) -> dict:
    """The JSON `options` field, checked: unknown keys and values are refused,
    the parser only sees what it understands."""
    try:
        options = json.loads(raw) if raw else {}
    except ValueError:
        raise _bad("options is not JSON") from None
    if not isinstance(options, dict) or set(options) - _OPTION_KEYS:
        raise _bad("Unknown option")
    fmt = options.get("format", "auto")
    if fmt != "auto" and fmt not in mi.FORMATS:
        raise _bad("Unknown format")
    if options.get("delimiter", "auto") not in _DELIMITERS or options.get("encoding", "auto") not in _ENCODINGS:
        raise _bad("Unknown delimiter or encoding")
    if not isinstance(options.get("hasHeader", True), bool):
        raise _bad("hasHeader must be a boolean")
    skip = options.get("skipRows", 0)
    if isinstance(skip, bool) or not isinstance(skip, int) or not 0 <= skip <= 1000:
        raise _bad("skipRows must be an integer between 0 and 1000")
    sheet = options.get("sheet")
    if sheet is not None and (not isinstance(sheet, str) or len(sheet) > 255):
        raise _bad("sheet must be a string")
    columns = options.get("columns") or {}
    if not isinstance(columns, dict) or any(
        k not in mi.COLUMN_ROLES or not isinstance(v, str) or len(v) > 255 for k, v in columns.items()
    ):
        raise _bad("Unknown column role")
    return options


def _summary(m: MappingImport) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "description": m.description,
        "format": m.format,
        "sourceFileName": m.source_file_name,
        "options": m.options,
        "stats": m.stats,
        "warnings": m.warnings,
        "defaultStatuses": m.default_statuses,
        "createdBy": m.created_by,
        "createdAt": to_iso_ms_z(m.created_at),
    }


def _display_name(user: User) -> str:
    full = " ".join(p for p in (user.first_name, user.last_name) if p)
    return full or user.username


@router.get("")
async def list_imports(_user=Depends(_read), db: AsyncSession = Depends(get_db)):
    """Every import, newest first, without rows."""
    imports = (await db.scalars(select(MappingImport).order_by(MappingImport.created_at.desc()))).all()
    return json_response([_summary(m) for m in imports])


@router.get("/{import_id}")
async def get_import(import_id: ImportId, _user=Depends(_read), db: AsyncSession = Depends(get_db)):
    """One import with its rows (`MappingRow[]`)."""
    m = await db.get(MappingImport, import_id)
    payload = await db.get(MappingImportRows, import_id)
    if m is None or payload is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mapping import not found")
    rows = await asyncio.to_thread(lambda: json.loads(gzip.decompress(payload.data)))
    return json_response({**_summary(m), "rows": rows})


async def _read_uploads(files: list[UploadFile]) -> list[mi.InputFile]:
    out: list[mi.InputFile] = []
    total = 0
    for f in files:
        chunks = []
        while chunk := await f.read(1024 * 1024):
            total += len(chunk)
            if total > MAX_UPLOAD_BYTES:
                raise HTTPException(413, "Files too large")
            chunks.append(chunk)
        name = (f.filename or "upload").replace("\\", "/").rsplit("/", 1)[-1][:255] or "upload"
        out.append(mi.InputFile(name, b"".join(chunks)))
    return out


def _parse(files: list[mi.InputFile], options: dict) -> dict:
    if options.get("format", "auto") == "auto":
        detected = mi.detect_format(mi.expand_files(files), options)
        options = {**detected["options"], **options, "format": detected["format"]}
    result = mi.parse_mapping(files, options)
    result["options"] = options
    return result


@router.post("", status_code=status.HTTP_201_CREATED)
async def create_import(
    files: list[UploadFile] = File(...),
    options: str = Form("{}", max_length=20_000),
    name: str = Form("", max_length=255),
    description: str = Form("", max_length=5000),
    user: User = Depends(_write),
    db: AsyncSession = Depends(get_db),
):
    """Upload one or more files (a ZIP, or CONCEPT + CONCEPT_RELATIONSHIP) with
    the parse `options` (JSON: format — `auto` to detect —, delimiter, encoding,
    sheet, hasHeader, skipRows, columns). A file that does not read as that
    format is a 422 with `{code, detail}`."""
    if not files or len(files) > MAX_FILES:
        raise _bad(f"Send between 1 and {MAX_FILES} files")
    parsed_options = _parse_options(options)
    inputs = await _read_uploads(files)
    try:
        result = await asyncio.to_thread(_parse, inputs, parsed_options)
    except mi.MappingImportError as e:
        raise HTTPException(422, {"code": e.code, "detail": e.detail}) from None
    data = await asyncio.to_thread(
        lambda: gzip.compress(json.dumps(result["rows"], separators=(",", ":"), ensure_ascii=False).encode(), 6)
    )
    file_names = ", ".join(f.name for f in inputs)
    m = MappingImport(
        name=name.strip() or result["suggestedName"] or inputs[0].name,
        description=description.strip() or None,
        format=result["format"],
        source_file_name=file_names[:1024],
        options=result["options"],
        stats=result["stats"],
        warnings=result["warnings"],
        default_statuses=result["defaultStatuses"],
        created_by_id=user.id,
        created_by=_display_name(user),
    )
    db.add(m)
    await db.flush()
    db.add(MappingImportRows(import_id=m.id, row_count=len(result["rows"]), data=data))
    await db.commit()
    await db.refresh(m)
    logger.info("mapping_import_created", id=m.id, format=m.format, rows=len(result["rows"]))
    response = json_response(_summary(m))
    response.status_code = status.HTTP_201_CREATED
    return response


@router.delete("/{import_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_import(import_id: ImportId, _user=Depends(_write), db: AsyncSession = Depends(get_db)):
    m = await db.get(MappingImport, import_id)
    if m is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Mapping import not found")
    # Explicit, not left to the FK cascade: SQLite enforces it only with the pragma on.
    await db.execute(delete(MappingImportRows).where(MappingImportRows.import_id == import_id))
    await db.delete(m)
    await db.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)
