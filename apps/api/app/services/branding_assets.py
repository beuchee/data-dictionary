"""Branding images (logo, favicon) carried by a `config` draft.

A config draft may hold, next to the config.json keys, a reserved top-level
`$assets` object: `{"logo"?: {"filename", "base64"}, "favicon"?: {…}}`. It never
reaches config.json: at submit the images are checked (type sniffed from the
bytes, size capped, SVG without scripts), written as `branding/logo.<ext>` /
`branding/favicon.<ext>` at the repository root, and `branding.logo` /
`branding.favicon` point at them. Paths stay relative to the site root, as v1
reads them (`build.py` copies `branding/` next to v1's pages; v2's vite plugin
serves it; the API serves the current ones at `/instance/branding/{kind}`).
docs/data-formats.md § Branding images.
"""

from __future__ import annotations

import base64
import binascii
import re
from collections.abc import Callable
from pathlib import Path
from typing import Any

ASSETS_KEY = "$assets"
BRANDING_DIR = "branding"
KINDS = ("logo", "favicon")
MAX_BYTES = {"logo": 1024 * 1024, "favicon": 256 * 1024}

CONTENT_TYPES = {
    "png": "image/png",
    "jpg": "image/jpeg",
    "gif": "image/gif",
    "webp": "image/webp",
    "ico": "image/x-icon",
    "svg": "image/svg+xml",
}

# Markup that would run in an SVG opened as a document (a <img> never runs it,
# but the file is also reachable directly: the static site serves it without
# the API's sandbox CSP). Checked after numeric character references are
# decoded; an element may carry a namespace prefix (`<svg:script>` runs in an
# XML document); a URL scheme may hold whitespace (`java\tscript:`), which URL
# parsing drops.
_SVG_FORBIDDEN = re.compile(
    rb"<\s*(?:[\w.-]+:)?(?:script|foreignObject|iframe|embed|object|handler)\b"
    rb"|j\s*a\s*v\s*a\s*s\s*c\s*r\s*i\s*p\s*t\s*:"
    rb"|[\s/\"']on[a-z]+\s*="
    rb"|attributeName\s*=\s*[\"']?\s*on"
    rb"|<!ENTITY|<\?xml-stylesheet",
    re.IGNORECASE,
)
_CHAR_REF = re.compile(rb"&#(x[0-9a-f]+|[0-9]+);?", re.IGNORECASE)


def _decode_char_refs(data: bytes) -> bytes:
    def one(m: re.Match) -> bytes:
        ref = m.group(1).decode()
        try:
            code = int(ref[1:], 16) if ref[0] in "xX" else int(ref)
            return chr(code).encode("utf-8")
        except (ValueError, OverflowError):
            return b"?"

    return _CHAR_REF.sub(one, data)


def unsafe_svg(data: bytes) -> bool:
    return _SVG_FORBIDDEN.search(data) is not None or _SVG_FORBIDDEN.search(_decode_char_refs(data)) is not None


class AssetError(ValueError):
    def __init__(self, code: str, message: str, kind: str | None = None):
        super().__init__(message)
        self.code = code
        self.kind = kind

    def detail(self) -> dict:
        return {"code": self.code, "message": str(self), "asset": self.kind}


def sniff_type(data: bytes) -> str | None:
    """The image type of `data` from its leading bytes (never from a filename)."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "png"
    if data.startswith(b"\xff\xd8\xff"):
        return "jpg"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "gif"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    if data[:4] == b"\x00\x00\x01\x00":
        return "ico"
    head = data[:1024].lstrip(b"\xef\xbb\xbf \t\r\n")
    if (head.startswith(b"<?xml") or head.startswith(b"<svg") or head.startswith(b"<!--")) and b"<svg" in data[:4096]:
        return "svg"
    return None


def decode_asset(kind: str, value: Any) -> tuple[str, bytes]:
    """`(extension, bytes)` of one `$assets` entry, or AssetError."""
    if kind not in KINDS:
        raise AssetError("unknown_asset", f"Unknown branding asset {kind!r} (logo or favicon)", kind)
    if not isinstance(value, dict) or not isinstance(value.get("base64"), str):
        raise AssetError("invalid_asset", f"The {kind} must be {{filename, base64}}", kind)
    encoded = value["base64"]
    # A data: URL is accepted as well as bare base64.
    if encoded.startswith("data:"):
        encoded = encoded.partition(",")[2]
    if len(encoded) > MAX_BYTES[kind] * 4 // 3 + 8:
        raise AssetError("asset_too_large", f"The {kind} exceeds {MAX_BYTES[kind] // 1024} KB", kind)
    try:
        data = base64.b64decode(encoded, validate=True)
    except (binascii.Error, ValueError):
        raise AssetError("invalid_asset", f"The {kind} is not valid base64", kind) from None
    if not data:
        raise AssetError("invalid_asset", f"The {kind} is empty", kind)
    if len(data) > MAX_BYTES[kind]:
        raise AssetError("asset_too_large", f"The {kind} exceeds {MAX_BYTES[kind] // 1024} KB", kind)
    ext = sniff_type(data)
    if ext is None:
        raise AssetError("unsupported_asset_type", f"The {kind} is not a PNG, JPEG, GIF, WebP, ICO or SVG image", kind)
    if ext == "svg" and unsafe_svg(data):
        raise AssetError("unsafe_svg", f"The {kind} SVG contains scripts or embedded content", kind)
    return ext, data


def validate_assets(content: Any) -> None:
    """Raise AssetError when a draft's `$assets` is malformed (no-op without one)."""
    if not isinstance(content, dict) or ASSETS_KEY not in content:
        return
    assets = content[ASSETS_KEY]
    if assets is None:
        return
    if not isinstance(assets, dict):
        raise AssetError("invalid_asset", f"{ASSETS_KEY} must be an object")
    for kind, value in assets.items():
        if value is not None:
            decode_asset(kind, value)


def asset_path(kind: str, ext: str) -> str:
    return f"{BRANDING_DIR}/{kind}.{ext}"


def apply_assets(content: dict, base: dict | None, show: Callable[[str], bytes | None]) -> dict[str, bytes | None]:
    """Pop `$assets` from `content` (a config draft, edited in place), point
    `branding.<kind>` at each uploaded image, and return the files to write:
    the images (unless identical to the repository's), and None for a previous
    `branding/` image no longer named. `show(path)` reads the repository's."""
    validate_assets(content)
    assets = content.pop(ASSETS_KEY, None) or {}
    files: dict[str, bytes | None] = {}
    branding = content.get("branding")
    for kind, value in assets.items():
        if value is None:
            continue
        ext, data = decode_asset(kind, value)
        path = asset_path(kind, ext)
        if not isinstance(branding, dict):
            branding = {}
            content["branding"] = branding
        branding[kind] = path
        if show(path) != data:
            files[path] = data
    base_branding = (base or {}).get("branding") if isinstance(base, dict) else None
    if isinstance(base_branding, dict):
        new_branding = content.get("branding") if isinstance(content.get("branding"), dict) else {}
        for kind in KINDS:
            old = base_branding.get(kind)
            if (
                isinstance(old, str)
                and old.startswith(f"{BRANDING_DIR}/")
                and old != new_branding.get(kind)
                and old not in files
                and old not in (new_branding.get(k) for k in KINDS)
                and show(old) is not None
            ):
                files[old] = None
    return files


_SAFE_REL = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$")


def resolve_asset_file(root: Path, config: dict | None, kind: str) -> Path | None:
    """The file `branding.<kind>` of `config` names, inside `root`: a
    `branding/` path at the repository root, else v1's location (`legacy/`)."""
    if kind not in KINDS or not isinstance(config, dict):
        return None
    branding = config.get("branding")
    rel = branding.get(kind) if isinstance(branding, dict) else None
    if not isinstance(rel, str):
        return None
    rel = rel.strip().lstrip("/")
    if not _SAFE_REL.fullmatch(rel) or ".." in rel.split("/"):
        return None
    root = root.resolve()
    candidates = [root / rel] if rel.startswith(f"{BRANDING_DIR}/") else [root / "legacy" / rel, root / rel]
    for candidate in candidates:
        resolved = candidate.resolve()
        if resolved.is_file() and resolved.is_relative_to(root):
            return resolved
    return None
