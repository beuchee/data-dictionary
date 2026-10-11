"""The forge hosting the content repository: GitHub or GitLab (self-hosted too).

- `forge_kind`: port of v1's `forgeName` (legacy/app.js): `repository.forge` in
  config.json when declared, else github.com means GitHub and any other host
  GitLab (a self-hosted instance that is neither must declare it).
- `config_repo_url`: port of v1's `getConfigRepoUrl`, the URL stamped as a
  concept set's `metadata.sourceRepo`.
- `open_proposal`: opens a GitHub pull request (`POST /repos/{owner}/{repo}/pulls`)
  or a GitLab merge request (`POST /projects/{id}/merge_requests`) for a pushed
  branch. The API host is the git remote's own (GitHub Enterprise: /api/v3), so
  it passes the same SSRF guard as the remote.
"""

from __future__ import annotations

import re
from urllib.parse import quote, urlsplit

import httpx

from app.services.git_service import GitError, reject_internal_host, strip_credentials

# Tests swap in an httpx.MockTransport; production uses the default transport.
transport: httpx.AsyncBaseTransport | None = None

_TIMEOUT = 30.0


def repository_config(config: dict | None) -> dict:
    """config.json's `repository` block (named `github` before v1.2.6)."""
    config = config or {}
    block = config.get("repository") or config.get("github") or {}
    return block if isinstance(block, dict) else {}


def _origin(url: str) -> str | None:
    m = re.match(r"^(https?://[^/]+)", url or "")
    return m.group(1) if m else None


def forge_origin(config: dict | None) -> str:
    return _origin(str(repository_config(config).get("url") or "")) or "https://github.com"


def config_repo_url(config: dict | None) -> str:
    """This dictionary's repository URL, from `repository.url`, else
    `repository.repo` on the forge origin, else (last resort) `upstream`."""
    repo = repository_config(config)
    if repo.get("url"):
        return re.sub(r"/+$", "", re.sub(r"\.git$", "", str(repo["url"])))
    if repo.get("repo"):
        return f"{forge_origin(config)}/{repo['repo']}"
    if repo.get("upstream"):
        return re.sub(r"\.git$", "", str(repo["upstream"]))
    return ""


def forge_kind(config: dict | None, remote_url: str | None = None) -> str:
    """'github' or 'gitlab'."""
    declared = str(repository_config(config).get("forge") or "")
    if re.fullmatch(r"gitlab", declared, re.I):
        return "gitlab"
    if re.fullmatch(r"github", declared, re.I):
        return "github"
    host = urlsplit(remote_url).hostname if remote_url and "://" in remote_url else None
    if not host:
        host = urlsplit(forge_origin(config)).hostname or ""
    return "github" if re.search(r"(^|\.)github\.com$", host, re.I) else "gitlab"


def project_path(remote_url: str) -> str:
    """`owner/repo` (GitHub) or `group/sub/project` (GitLab) of an https remote."""
    parts = urlsplit(strip_credentials(remote_url) or "")
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise GitError("pull / merge requests need an https remote", "no_remote")
    path = re.sub(r"\.git$", "", parts.path.strip("/"))
    if path.count("/") < 1:
        raise GitError(f"cannot read the project path from {remote_url!r}", "no_remote")
    return path


def api_base(kind: str, remote_url: str) -> str:
    parts = urlsplit(strip_credentials(remote_url) or "")
    origin = f"{parts.scheme}://{parts.netloc}"
    if kind == "github":
        return "https://api.github.com" if (parts.hostname or "").lower() == "github.com" else f"{origin}/api/v3"
    return f"{origin}/api/v4"


class ForgeError(RuntimeError):
    def __init__(self, message: str, status: int | None = None):
        super().__init__(message)
        self.status = status


async def open_proposal(
    *,
    kind: str,
    remote_url: str,
    token: str | None,
    head: str,
    base: str,
    title: str,
    body: str,
) -> str:
    """Open the PR / MR and return its web URL."""
    if not token:
        raise ForgeError("no token to open the pull / merge request with")
    reject_internal_host(remote_url)
    path = project_path(remote_url)
    root = api_base(kind, remote_url)
    headers = {"Authorization": f"Bearer {token}", "User-Agent": "data-dictionary"}
    if kind == "github":
        url = f"{root}/repos/{path}/pulls"
        payload = {"title": title, "head": head, "base": base, "body": body}
        headers["Accept"] = "application/vnd.github+json"
        key = "html_url"
    else:
        url = f"{root}/projects/{quote(path, safe='')}/merge_requests"
        payload = {"source_branch": head, "target_branch": base, "title": title, "description": body}
        key = "web_url"
    async with httpx.AsyncClient(transport=transport, timeout=_TIMEOUT, follow_redirects=False) as client:
        try:
            response = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            raise ForgeError(f"the forge could not be reached: {type(exc).__name__}") from None
    if response.status_code not in (200, 201):
        detail = ""
        try:
            data = response.json()
            detail = str(data.get("message") or data.get("error") or "")[:300]
        except ValueError:
            pass
        raise ForgeError(
            f"the forge refused the request ({response.status_code}) {detail}".strip(), response.status_code
        )
    try:
        web_url = response.json().get(key)
    except ValueError:
        web_url = None
    if not isinstance(web_url, str):
        raise ForgeError("the forge answered without a URL")
    return web_url
