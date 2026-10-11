import json
from typing import Any

from fastapi import Response


def json_response(value: Any) -> Response:
    """Content documents as compact JSON, skipping FastAPI's jsonable_encoder:
    it walks every node, which costs seconds on a multi-megabyte resolved list.
    A RawFloat (dictionary_format) is a float, so it encodes as one."""
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False)
    return Response(content=body.encode("utf-8"), media_type="application/json")
