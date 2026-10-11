# Hardening ported from linkr@1310cf4a4 (apps/api/app/services/git_service.py):
# isolated environment, ref/oid validation, SSRF guard, per-call token injection,
# credential scrubbing, error codes, per-repo lock.
"""git for the ONE content repository working copy (`settings.content_path`).

- **Clone** (`ensure_clone`, at startup): with `DD_CONTENT_REPO_URL` set and no
  repository in the content dir, a full clone (version history needs every
  commit) of `DD_CONTENT_BRANCH`.
- **Status / pull**: `status()` reads ahead / behind against the remote-tracking
  ref; `pull()` fetches and fast-forwards, refusing a dirty or diverged copy.
- **Writes** never touch the working tree until the remote has accepted them:
  `commit_files` builds a commit with plumbing (a throwaway index, `hash-object`,
  `commit-tree`) on top of a base commit, `push` sends it, and only then does
  `fast_forward` move the working copy (direct commits). A proposal branch is
  pushed the same way and never checked out.

Every git process runs with an isolated environment (no user/system gitconfig,
no credential helper, no prompt, no redirects, https/ssh only), and the access
token is injected into the URL of the one network call that needs it: it is
never written to `.git/config`, and it is scrubbed from any error text.
"""

from __future__ import annotations

import asyncio
import ipaddress
import os
import re
import shutil
import socket
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import quote, urlsplit, urlunsplit

import structlog

logger = structlog.get_logger()

# Never let a hung git subprocess (auth prompt, dead remote) block a worker.
_GIT_TIMEOUT = 120
# A full clone of the content repository is larger than one fetch.
_CLONE_TIMEOUT = 900

# One lock per repo path: two git processes writing .git/ at once collide
# ("could not lock config file", index.lock).
_repo_locks: dict[str, asyncio.Lock] = {}


def lock_for(repo: Path) -> asyncio.Lock:
    key = str(repo)
    lock = _repo_locks.get(key)
    if lock is None:
        lock = asyncio.Lock()
        _repo_locks[key] = lock
    return lock


class GitError(RuntimeError):
    """A git invocation failed. `message` is credential-scrubbed; `code` is a
    stable label the API returns and the UI translates:

    auth_failed, auth_required, not_found, network, unknown (from git's stderr);
    pull_required (the remote moved), diverged (local commits the remote lacks),
    dirty (uncommitted changes in the working copy), wrong_branch (the working
    copy is not on the content branch), no_remote, not_a_repo, invalid_ref.
    """

    def __init__(self, message: str, code: str = "unknown") -> None:
        super().__init__(message)
        self.code = code


# A branch name reaches git as a positional refspec, so a value like
# "--upload-pack=<cmd>" would be option injection. No leading dash, only word
# chars plus ./-/_, no "..", no ".lock" suffix.
_REF_RE = re.compile(r"^[A-Za-z0-9_][\w./-]*$")


def safe_ref(branch: str) -> str:
    if (
        not isinstance(branch, str)
        or not _REF_RE.fullmatch(branch)
        or ".." in branch
        or branch.endswith((".lock", "/", "."))
        or "//" in branch
    ):
        raise GitError(f"invalid branch name: {branch!r}", "invalid_ref")
    return branch


_OID_RE = re.compile(r"^[0-9a-f]{7,64}$")


def safe_oid(oid: str) -> str:
    if not isinstance(oid, str) or not _OID_RE.fullmatch(oid):
        raise GitError(f"invalid git object id: {oid!r}", "invalid_ref")
    return oid


# Content paths only: no "..", no leading slash or dash.
_PATH_RE = re.compile(r"^[A-Za-z0-9_][A-Za-z0-9_.-]*(/[A-Za-z0-9_][A-Za-z0-9_.-]*)*$")


def safe_path(path: str) -> str:
    if not isinstance(path, str) or not _PATH_RE.fullmatch(path) or ".." in path.split("/"):
        raise GitError(f"invalid path: {path!r}", "invalid_ref")
    return path


def _classify_error(text: str) -> str:
    """Map git's stderr to a stable code. Credentials first: an auth denial
    often also mentions the URL."""
    low = text.lower()
    if any(
        s in low
        for s in ("access denied", "authentication failed", "http basic", "invalid username or password", "403")
    ):
        return "auth_failed"
    if any(s in low for s in ("could not read from remote", "repository not found", "not found", "404")):
        return "not_found"
    if any(s in low for s in ("could not resolve host", "unable to access", "timed out", "network")):
        return "network"
    if "authentication" in low or "credential" in low:
        return "auth_failed"
    if any(s in low for s in ("non-fast-forward", "fetch first", "[rejected]", "stale info")):
        return "pull_required"
    return "unknown"


# Remotes are network repositories by default: a local path or file:// would
# have the server read its own disk, and ext:: runs a command. An on-prem
# deployment may opt in to local remotes (a bare repository on the server, a
# Docker volume) with DD_GIT_ALLOW_LOCAL_REMOTES; tests flip this flag to use
# local bare repositories. Either way, network remotes keep every check.
_LOCAL_REMOTES_ALLOWED = False

_SCP_LIKE = re.compile(r"[\w.+-]+@([\w.-]+):(?!//)\S+")


def local_remotes_allowed() -> bool:
    from app.config import settings

    return _LOCAL_REMOTES_ALLOWED or settings.git_allow_local_remotes


def _is_local_remote(url: str) -> bool:
    """An absolute filesystem path or a file:// URL (nothing else git reads
    from disk: no relative path, no `transport::address`)."""
    scheme = urlsplit(url).scheme.lower()
    return scheme == "file" or (scheme == "" and url.startswith("/"))


def _require_network_remote(url: str) -> None:
    if _is_local_remote(url) and local_remotes_allowed():
        return
    parts = urlsplit(url)
    if parts.scheme.lower() in ("https", "ssh"):
        host = parts.hostname or ""
    else:
        scp = _SCP_LIKE.fullmatch(url)
        if scp is None:
            raise GitError("remote must be an https:// or ssh URL", "network")
        host = scp.group(1)
    # A host starting with "-" would be read by ssh as an option.
    if not host or host.startswith("-"):
        raise GitError("remote URL has no valid host", "network")


def reject_internal_host(url: str) -> None:
    """Refuse anything but an https/ssh remote (or, opted in, a local path),
    and an https remote whose host resolves to a loopback / link-local /
    private / reserved address (SSRF to the metadata endpoint, localhost, the
    internal network). Also guards the forge API calls, which go to the same
    host."""
    _require_network_remote(url)
    if _is_local_remote(url):
        return  # allowed, or _require_network_remote would have raised
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https"):
        return
    host = parts.hostname
    if not host:
        raise GitError("remote URL has no host", "network")
    try:
        infos = socket.getaddrinfo(host, parts.port or 443, proto=socket.IPPROTO_TCP)
    except OSError:
        return  # unresolvable: let git fail with a network error
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if (
            ip.is_loopback
            or ip.is_link_local
            or ip.is_private
            or ip.is_reserved
            or ip.is_multicast
            or ip.is_unspecified
        ):
            raise GitError("remote host is not allowed (internal address)", "network")


def inject_token(url: str, token: str | None) -> str:
    """Token as the password with a fixed `oauth2` username: GitLab requires it
    for push, GitHub accepts it. Only for http(s) URLs."""
    if not token or urlsplit(url).scheme not in ("http", "https"):
        return url
    parts = urlsplit(url)
    netloc = parts.netloc.rsplit("@", 1)[-1]  # drop any existing credentials
    return urlunsplit(parts._replace(netloc=f"oauth2:{quote(token, safe='')}@{netloc}"))


def strip_credentials(url: str | None) -> str | None:
    """The URL without any userinfo, for display and for `.git/config`."""
    if not url:
        return url
    parts = urlsplit(url)
    if parts.scheme in ("http", "https", "ssh") and "@" in parts.netloc:
        if parts.scheme == "ssh":
            return url
        return urlunsplit(parts._replace(netloc=parts.netloc.rsplit("@", 1)[-1]))
    return url


def _scrub(text: str, token: str | None) -> str:
    if token:
        text = text.replace(token, "***").replace(quote(token, safe=""), "***")
    return text


def _is_ssh_remote(arg: str) -> bool:
    return arg.startswith("ssh://") or _SCP_LIKE.fullmatch(arg) is not None


def _failure(text: str, token: str | None, args) -> GitError:
    """A GitError for a failed git call. ssh's own text (which hosts and ports
    answer) stays in the server log: returned, it would scan the network."""
    msg = _scrub(text, token)
    code = _classify_error(msg)
    if any(_is_ssh_remote(str(a)) for a in args):
        logger.info("git_ssh_failure", detail=msg)
        msg = "The ssh remote could not be reached, or refused access."
    return GitError(msg, code)


def git_env() -> dict[str, str]:
    """Non-interactive, and isolated from the host's ambient credentials: no
    user/system gitconfig, no credential helper, no redirects (a redirect would
    slip past the internal-host check), https/ssh only."""
    return {
        "PATH": os.environ.get("PATH", "/usr/bin:/bin"),
        "GIT_TERMINAL_PROMPT": "0",
        "GIT_ASKPASS": "true",
        "HOME": "/nonexistent-data-dictionary-git-home",
        "GIT_CONFIG_NOSYSTEM": "1",
        "GIT_CONFIG_COUNT": "4",
        "GIT_CONFIG_KEY_0": "credential.helper",
        "GIT_CONFIG_VALUE_0": "",
        "GIT_CONFIG_KEY_1": "init.defaultBranch",
        "GIT_CONFIG_VALUE_1": "main",
        "GIT_CONFIG_KEY_2": "http.followRedirects",
        "GIT_CONFIG_VALUE_2": "false",
        # Commits are built by the server: never ask a signing agent.
        "GIT_CONFIG_KEY_3": "commit.gpgSign",
        "GIT_CONFIG_VALUE_3": "false",
        "GIT_ALLOW_PROTOCOL": "https:ssh:file" if local_remotes_allowed() else "https:ssh",
    }


def _run_bytes(
    repo: Path | None,
    *args: str,
    token: str | None = None,
    check: bool = True,
    env_extra: dict | None = None,
    input: bytes | None = None,
    timeout: int = _GIT_TIMEOUT,
) -> subprocess.CompletedProcess[bytes]:
    env = git_env()
    if env_extra:
        env.update(env_extra)
    argv = ["git", *(["-C", str(repo)] if repo is not None else []), *args]
    try:
        proc = subprocess.run(argv, capture_output=True, timeout=timeout, env=env, input=input)
    except subprocess.TimeoutExpired as exc:
        raise GitError(f"git {args[0]} timed out", "network") from exc
    except FileNotFoundError as exc:
        raise GitError("git is not installed on the server", "unknown") from exc
    if check and proc.returncode != 0:
        text = (proc.stderr or proc.stdout).decode("utf-8", "replace").strip()
        raise _failure(text, token, args)
    return proc


def _run(repo: Path | None, *args: str, **kwargs) -> str:
    return _run_bytes(repo, *args, **kwargs).stdout.decode("utf-8", "replace")


@dataclass
class Author:
    name: str
    email: str


# ---------------------------------------------------------------------------
# The content repository
# ---------------------------------------------------------------------------


class ContentRepo:
    """The working copy at `path`, its remote (`url`, else its `origin`), and the
    content `branch`. Methods are blocking: call them through `run()` (which
    takes the repo lock and a worker thread)."""

    def __init__(self, path: Path, *, url: str | None, branch: str, token: str | None, committer: Author):
        self.path = Path(path)
        self.url = url or None
        self.branch = safe_ref(branch)
        self.token = token or None
        self.committer = committer

    @property
    def lock(self) -> asyncio.Lock:
        return lock_for(self.path)

    async def run(self, fn, *args, **kwargs):
        async with self.lock:
            return await asyncio.to_thread(fn, *args, **kwargs)

    # --- inspection --------------------------------------------------------

    def is_repo(self) -> bool:
        if not self.path.is_dir():
            return False
        # The top level itself: paths in commits are relative to it, so a content
        # dir nested inside some other repository does not count.
        proc = _run_bytes(self.path, "rev-parse", "--show-toplevel", check=False)
        if proc.returncode != 0:
            return False
        top = proc.stdout.decode("utf-8", "replace").strip()
        return bool(top) and Path(top).resolve() == self.path.resolve()

    def require_repo(self) -> None:
        if not self.is_repo():
            raise GitError("the content directory is not a git repository", "not_a_repo")

    def remote_url(self) -> str | None:
        """The remote: `DD_CONTENT_REPO_URL`, else the working copy's `origin`."""
        if self.url:
            return self.url
        if not self.is_repo():
            return None
        out = _run(self.path, "remote", "get-url", "origin", check=False).strip()
        return out or None

    def _network_url(self, token: str | None) -> str:
        url = self.remote_url()
        if not url:
            raise GitError("the content repository has no remote", "no_remote")
        reject_internal_host(url)
        return inject_token(url, token)

    @property
    def tracking_ref(self) -> str:
        return f"refs/remotes/origin/{self.branch}"

    def rev(self, ref: str) -> str | None:
        out = _run(self.path, "rev-parse", "-q", "--verify", f"{ref}^{{commit}}", check=False).strip()
        return out or None

    def current_branch(self) -> str | None:
        out = _run(self.path, "symbolic-ref", "-q", "--short", "HEAD", check=False).strip()
        return out or None

    def is_dirty(self) -> bool:
        return bool(_run(self.path, "status", "--porcelain", "--untracked-files=no").strip())

    def show(self, rev: str, path: str) -> bytes | None:
        """The bytes of `path` at `rev`, or None when it is absent there."""
        proc = _run_bytes(self.path, "cat-file", "blob", f"{safe_oid(rev)}:{safe_path(path)}", check=False)
        return proc.stdout if proc.returncode == 0 else None

    def list_dir(self, rev: str, directory: str) -> list[str]:
        out = _run(self.path, "ls-tree", "--name-only", safe_oid(rev), f"{safe_path(directory)}/", check=False)
        return [line.rsplit("/", 1)[-1] for line in out.splitlines() if line.strip()]

    def has_commit(self, sha: str) -> bool:
        return _run_bytes(self.path, "cat-file", "-e", f"{safe_oid(sha)}^{{commit}}", check=False).returncode == 0

    def ahead_behind(self) -> tuple[int, int] | None:
        if self.rev(self.tracking_ref) is None or self.rev("HEAD") is None:
            return None
        out = _run(self.path, "rev-list", "--left-right", "--count", f"HEAD...{self.tracking_ref}").split()
        return int(out[0]), int(out[1])

    def status(self) -> dict:
        self.require_repo()
        counts = self.ahead_behind()
        return {
            "branch": self.current_branch(),
            "contentBranch": self.branch,
            "head": self.rev("HEAD"),
            "remote": strip_credentials(self.remote_url()),
            "remoteHead": self.rev(self.tracking_ref),
            "ahead": counts[0] if counts else None,
            "behind": counts[1] if counts else None,
            "dirty": self.is_dirty(),
        }

    # --- network -----------------------------------------------------------

    def fetch(self) -> str:
        """Update origin/<branch> from the remote; returns its sha."""
        self.require_repo()
        url = self._network_url(self.token)
        _run(self.path, "fetch", "-q", url, f"+refs/heads/{self.branch}:{self.tracking_ref}", token=self.token)
        sha = self.rev(self.tracking_ref)
        if sha is None:
            raise GitError(f"branch {self.branch} not found on the remote", "not_found")
        return sha

    def clone(self) -> None:
        """Full clone of the content branch into `path` (absent or empty)."""
        if not self.url:
            raise GitError("DD_CONTENT_REPO_URL is not set", "no_remote")
        reject_internal_host(self.url)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if self.path.exists() and any(self.path.iterdir()):
            raise GitError(f"{self.path} is not empty and not a git repository", "not_a_repo")
        target = str(self.path)
        try:
            _run(
                None,
                "clone",
                "-q",
                "--branch",
                self.branch,
                "--",
                inject_token(self.url, self.token),
                target,
                token=self.token,
                timeout=_CLONE_TIMEOUT,
            )
        except GitError:
            shutil.rmtree(self.path, ignore_errors=True)
            raise
        # The token was only in the clone's argv: store the remote without it.
        _run(self.path, "remote", "set-url", "origin", strip_credentials(self.url) or self.url)

    def pull(self) -> dict:
        """Fetch and fast-forward the working copy. Refuses a dirty copy, one on
        another branch, and one with local commits the remote lacks."""
        self.require_repo()
        before = self.rev("HEAD")
        remote_head = self.fetch()
        if self.current_branch() != self.branch:
            raise GitError(f"the working copy is not on {self.branch}", "wrong_branch")
        if self.is_dirty():
            raise GitError("the working copy has uncommitted changes", "dirty")
        ahead, behind = self.ahead_behind() or (0, 0)
        if ahead and behind:
            raise GitError(
                f"the working copy and the remote have diverged ({ahead} local, {behind} remote commits); "
                "resolve it outside the app",
                "diverged",
            )
        if behind:
            _run(self.path, "merge", "--ff-only", "-q", remote_head)
        return {"before": before, "head": self.rev("HEAD"), "updated": before != self.rev("HEAD")}

    def push(self, sha: str, branch: str, token: str | None) -> None:
        """Push commit `sha` to refs/heads/<branch> (never forced)."""
        url = self._network_url(token)
        _run(self.path, "push", "-q", url, f"{safe_oid(sha)}:refs/heads/{safe_ref(branch)}", token=token)

    # --- writes ------------------------------------------------------------

    def base_for_write(self, *, direct: bool) -> str:
        """The commit a write builds on: the freshly fetched remote head when there
        is a remote, else HEAD. A direct commit also needs the working copy on the
        content branch, clean, and exactly at that head (`pull_required`)."""
        self.require_repo()
        has_remote = self.remote_url() is not None
        base = self.fetch() if has_remote else self.rev("HEAD")
        if base is None:
            raise GitError("the content repository has no commit", "not_a_repo")
        if direct:
            if self.current_branch() != self.branch:
                raise GitError(f"the working copy is not on {self.branch}", "wrong_branch")
            if self.is_dirty():
                raise GitError("the working copy has uncommitted changes", "dirty")
            if self.rev("HEAD") != base:
                ahead, behind = self.ahead_behind() or (0, 0)
                code = "diverged" if ahead else "pull_required"
                raise GitError("the remote has changes this server has not pulled yet; pull first", code)
        return base

    def commit_files(self, parent: str, files: dict[str, bytes | None], message: str, author: Author) -> str:
        """A commit on top of `parent` whose tree is `parent`'s with `files`
        written (bytes) or removed (None). The working tree and index are not
        touched. Returns the new commit's sha."""
        safe_oid(parent)
        env_identity = {
            "GIT_AUTHOR_NAME": author.name,
            "GIT_AUTHOR_EMAIL": author.email,
            "GIT_COMMITTER_NAME": self.committer.name,
            "GIT_COMMITTER_EMAIL": self.committer.email,
        }
        with tempfile.TemporaryDirectory() as tmp:
            env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
            _run(self.path, "read-tree", parent, env_extra=env)
            for path, data in files.items():
                safe_path(path)
                if data is None:
                    _run(self.path, "update-index", "--force-remove", "--", path, env_extra=env)
                    continue
                blob = _run(self.path, "hash-object", "-w", "--stdin", input=data).strip()
                _run(self.path, "update-index", "--add", "--cacheinfo", f"100644,{blob},{path}", env_extra=env)
            tree = _run(self.path, "write-tree", env_extra=env).strip()
        return _run(
            self.path,
            "commit-tree",
            tree,
            "-p",
            parent,
            "-F",
            "-",
            input=message.encode("utf-8"),
            env_extra=env_identity,
        ).strip()

    def fast_forward(self, sha: str) -> None:
        """Move the working copy (on the content branch) forward to `sha`."""
        _run(self.path, "merge", "--ff-only", "-q", safe_oid(sha))
        if self.remote_url():
            # Keep origin/<branch> in step with what was just pushed.
            _run(self.path, "update-ref", self.tracking_ref, sha)


def content_branch_default(config: dict | None) -> str:
    repo = (config or {}).get("repository") or (config or {}).get("github") or {}
    branch = repo.get("branch") if isinstance(repo, dict) else None
    return branch if isinstance(branch, str) and branch.strip() else "main"


def _read_config_branch(path: Path) -> str:
    import json

    try:
        config = json.loads((path / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        config = None
    return content_branch_default(config)


def get_content_repo() -> ContentRepo:
    """The content repository as configured (a FastAPI dependency; tests override it)."""
    from app.config import settings

    path = settings.content_path
    return ContentRepo(
        path,
        url=settings.content_repo_url,
        branch=settings.content_branch or _read_config_branch(path),
        token=settings.git_token,
        committer=Author(settings.git_author_name, settings.git_author_email),
    )


def ensure_clone() -> bool:
    """At startup: clone the configured repository when the content dir holds
    none. True when a clone was made."""
    repo = get_content_repo()
    if not repo.url or repo.is_repo():
        return False
    logger.info("content_repo_cloning", url=strip_credentials(repo.url), branch=repo.branch, path=str(repo.path))
    repo.clone()
    logger.info("content_repo_cloned", head=repo.rev("HEAD"))
    return True
