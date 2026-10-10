"""Both serializers emit the same bytes on every real content file.

Runs the TypeScript serializer through Node (type stripping, Node >= 22.6) over
the whole repo and compares SHA-256 digests. Skipped, with the reason, when Node
or the npm dependencies are unavailable.
"""

from __future__ import annotations

import hashlib
import json
import re
import shutil
import subprocess

import pytest

from conftest import PACKAGE_ROOT, REPO_ROOT, read_bytes
from dictionary_format import parse, serialize_bytes

SCRIPT = PACKAGE_ROOT / "scripts" / "serialize-hashes.ts"


def _node() -> str:
    node = shutil.which("node")
    if not node:
        pytest.skip("node not found on PATH: cross-implementation check skipped")
    version = subprocess.run([node, "--version"], capture_output=True, text=True).stdout.strip()
    m = re.match(r"v(\d+)\.(\d+)", version)
    if not m or (int(m[1]), int(m[2])) < (22, 6):
        pytest.skip(f"node {version} cannot strip TypeScript types (needs >= 22.6)")
    if not any((p / "node_modules" / "lossless-json").is_dir() for p in (PACKAGE_ROOT, REPO_ROOT)):
        pytest.skip("npm dependencies not installed (run `npm install` at the repo root)")
    return node


def test_ts_and_python_serializers_agree(files):
    node = _node()
    paths = [path for path, _ in files]
    proc = subprocess.run(
        [node, "--no-warnings", "--experimental-strip-types", str(SCRIPT), str(REPO_ROOT)],
        input="\n".join(paths),
        capture_output=True,
        text=True,
        cwd=PACKAGE_ROOT,
        timeout=300,
    )
    assert proc.returncode == 0, proc.stderr
    ts_hashes = json.loads(proc.stdout)
    assert sorted(ts_hashes) == sorted(paths)
    differing = [
        path
        for path, kind in files
        if hashlib.sha256(serialize_bytes(parse(read_bytes(path)), kind)).hexdigest() != ts_hashes[path]
    ]
    assert differing == []
