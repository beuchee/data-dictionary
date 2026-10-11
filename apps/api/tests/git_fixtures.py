"""Temporary content repositories: a bare "remote" and working clones of it.
Never the real repository, never the network."""

import os
import subprocess
from dataclasses import dataclass
from pathlib import Path

from dictionary_format import parse, serialize_bytes

from app.services import git_service
from app.services.git_service import Author, ContentRepo

from content_fixtures import build_content_dir

_ENV = {
    **os.environ,
    "GIT_AUTHOR_NAME": "Test",
    "GIT_AUTHOR_EMAIL": "test@example.org",
    "GIT_COMMITTER_NAME": "Test",
    "GIT_COMMITTER_EMAIL": "test@example.org",
    "GIT_CONFIG_NOSYSTEM": "1",
    "HOME": "/nonexistent-test-home",
}


def git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", "-c", "commit.gpgsign=false", "-c", "init.defaultBranch=main", "-C", str(root), *args],
        capture_output=True,
        text=True,
        env=_ENV,
        check=True,
    )
    return result.stdout.strip()


def commit_all(root: Path, message: str) -> str:
    git(root, "add", "-A")
    git(root, "commit", "-q", "-m", message)
    return git(root, "rev-parse", "HEAD")


def read(path: Path):
    return parse(path.read_bytes())


def write(path: Path, value, kind: str | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(serialize_bytes(value, kind))


@dataclass
class Remote:
    bare: Path
    work: Path
    tmp: Path

    def repo(self, token: str | None = "svc-token") -> ContentRepo:
        return ContentRepo(
            self.work,
            url=str(self.bare),
            branch="main",
            token=token,
            committer=Author("Data Dictionary", "dd@example.org"),
        )

    def other_clone(self, name: str = "other") -> Path:
        path = self.tmp / name
        if not path.exists():
            git(self.tmp, "clone", "-q", str(self.bare), str(path))
        else:
            git(path, "pull", "-q", "--ff-only")
        return path

    def remote_file(self, ref: str, rel: str) -> bytes:
        return subprocess.run(
            ["git", "-C", str(self.bare), "cat-file", "blob", f"{ref}:{rel}"],
            capture_output=True,
            check=True,
        ).stdout

    def remote_rev(self, ref: str) -> str:
        return git(self.bare, "rev-parse", ref)

    def remote_branches(self) -> list[str]:
        out = git(self.bare, "for-each-ref", "--format=%(refname:short)", "refs/heads/")
        return [line for line in out.splitlines() if line]


def make_remote(tmp: Path, monkeypatch) -> Remote:
    """Seed repo (content fixtures, empty version index snapshotted), its bare
    clone as the remote, and a working clone as the server's content dir."""
    monkeypatch.setattr(git_service, "_LOCAL_REMOTES_ALLOWED", True)
    seed = build_content_dir(tmp / "seed")
    # The fixture's index points at commits of the real repository: start over.
    write(seed / "concept_sets_versions.json", {}, "concept-sets-versions")
    git(seed, "init", "-q", "-b", "main")
    commit_all(seed, "Initial content")
    bare = tmp / "remote.git"
    git(tmp, "clone", "-q", "--bare", str(seed), str(bare))
    work = tmp / "content"
    git(tmp, "clone", "-q", str(bare), str(work))
    return Remote(bare=bare, work=work, tmp=tmp)
