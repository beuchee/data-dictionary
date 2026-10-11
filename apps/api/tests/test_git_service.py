"""git_service against temporary repositories (bare remote + clones)."""

import pytest

from app.services import git_service
from app.services.git_service import Author, ContentRepo, GitError

from git_fixtures import commit_all, git, make_remote, read, write

# --- pure helpers -------------------------------------------------------------


@pytest.mark.parametrize(
    "ref", ["--upload-pack=touch /tmp/x", "-x", "a b", "a..b", "x.lock", "", "a;rm", "a//b", "main\n"]
)
def test_unsafe_refs_are_refused(ref):
    with pytest.raises(GitError) as exc:
        git_service.safe_ref(ref)
    assert exc.value.code == "invalid_ref"


@pytest.mark.parametrize("ref", ["main", "proposal/alice-concept-set-12-abc1234", "release/1.2", "feature_x"])
def test_safe_refs_pass(ref):
    assert git_service.safe_ref(ref) == ref


@pytest.mark.parametrize("path", ["../etc/passwd", "/etc/passwd", "-x", "a/../b", "concept_sets/1.json\n"])
def test_unsafe_paths_are_refused(path):
    with pytest.raises(GitError):
        git_service.safe_path(path)


def test_inject_and_strip_credentials():
    url = git_service.inject_token("https://github.com/o/r.git", "t0k/en")
    assert url == "https://oauth2:t0k%2Fen@github.com/o/r.git"
    assert git_service.strip_credentials(url) == "https://github.com/o/r.git"
    # ssh and local URLs never get a token.
    assert git_service.inject_token("git@github.com:o/r.git", "tok") == "git@github.com:o/r.git"


def test_failure_scrubs_the_token():
    error = git_service._failure("fatal: https://oauth2:s3cret@host/x: Authentication failed", "s3cret", ["push"])
    assert "s3cret" not in str(error)
    assert error.code == "auth_failed"


@pytest.mark.parametrize(
    "url",
    [
        "/srv/repo",
        "file:///srv/repo",
        "ext::sh -c touch% /tmp/pwned",
        "http://github.com/o/r",
        "https://127.0.0.1/o/r",
        "https://localhost/o/r",
        "https://169.254.169.254/latest",
        "https://10.0.0.1/o/r",
    ],
)
def test_ssrf_guard_refuses_local_and_internal_remotes(url):
    with pytest.raises(GitError) as exc:
        git_service.reject_internal_host(url)
    assert exc.value.code == "network"


def test_git_env_is_isolated():
    env = git_service.git_env()
    assert env["GIT_TERMINAL_PROMPT"] == "0"
    assert env["GIT_CONFIG_VALUE_0"] == ""  # no credential helper
    assert env["GIT_ALLOW_PROTOCOL"] == "https:ssh"
    assert "nonexistent" in env["HOME"]


# --- the working copy ---------------------------------------------------------


@pytest.fixture
def remote(tmp_path, monkeypatch):
    return make_remote(tmp_path, monkeypatch)


def test_status_of_a_fresh_clone(remote):
    repo = remote.repo()
    repo.fetch()
    status = repo.status()
    assert status["branch"] == "main"
    assert status["head"] == remote.remote_rev("main")
    assert (status["ahead"], status["behind"], status["dirty"]) == (0, 0, False)
    assert status["remote"] == str(remote.bare)


def test_clone_is_full_and_keeps_no_token(tmp_path, monkeypatch):
    remote = make_remote(tmp_path, monkeypatch)
    other = remote.other_clone()
    write(other / "concept_sets/1.json", {**read(other / "concept_sets/1.json"), "version": "7.0.0"}, "concept-set")
    commit_all(other, "Bump")
    git(other, "push", "-q", "origin", "main")

    target = tmp_path / "fresh"
    repo = ContentRepo(
        target, url=str(remote.bare), branch="main", token="svc-token", committer=Author("DD", "dd@x.org")
    )
    repo.clone()
    assert repo.is_repo()
    assert git(target, "rev-parse", "--is-shallow-repository") == "false"
    assert int(git(target, "rev-list", "--count", "HEAD")) == 2
    assert "svc-token" not in (target / ".git/config").read_text()


def test_clone_refuses_a_non_empty_directory(tmp_path, monkeypatch):
    remote = make_remote(tmp_path, monkeypatch)
    target = tmp_path / "busy"
    target.mkdir()
    (target / "file").write_text("x")
    repo = ContentRepo(target, url=str(remote.bare), branch="main", token=None, committer=Author("DD", "d@x"))
    with pytest.raises(GitError) as exc:
        repo.clone()
    assert exc.value.code == "not_a_repo"


def test_pull_fast_forwards(remote):
    other = remote.other_clone()
    (other / "README.md").write_text("hello\n")
    sha = commit_all(other, "Readme")
    git(other, "push", "-q", "origin", "main")

    repo = remote.repo()
    result = repo.pull()
    assert result["updated"] is True
    assert result["head"] == sha
    assert (remote.work / "README.md").read_text() == "hello\n"


def test_pull_refuses_a_diverged_copy(remote):
    other = remote.other_clone()
    (other / "a.txt").write_text("a")
    commit_all(other, "Remote")
    git(other, "push", "-q", "origin", "main")
    (remote.work / "b.txt").write_text("b")
    commit_all(remote.work, "Local")

    with pytest.raises(GitError) as exc:
        remote.repo().pull()
    assert exc.value.code == "diverged"


def test_pull_refuses_a_dirty_copy(remote):
    other = remote.other_clone()
    (other / "a.txt").write_text("a")
    commit_all(other, "Remote")
    git(other, "push", "-q", "origin", "main")
    (remote.work / "config.json").write_text("{}\n")

    with pytest.raises(GitError) as exc:
        remote.repo().pull()
    assert exc.value.code == "dirty"


def test_commit_files_leaves_the_working_tree_alone(remote):
    repo = remote.repo()
    base = repo.base_for_write(direct=True)
    sha = repo.commit_files(
        base,
        {"units/new.json": b"[]\n", "concept_sets/3.json": None},
        "Edit\n\nbody\n",
        Author("Alice Martin", "alice@example.org"),
    )
    # Nothing moved locally until the caller pushes and fast-forwards.
    assert repo.rev("HEAD") == base
    assert not (remote.work / "units/new.json").exists()
    assert repo.show(sha, "units/new.json") == b"[]\n"
    assert repo.show(sha, "concept_sets/3.json") is None
    assert (
        git(remote.work, "log", "-1", "--format=%an <%ae>|%cn", sha)
        == "Alice Martin <alice@example.org>|Data Dictionary"
    )

    repo.push(sha, "main", repo.token)
    repo.fast_forward(sha)
    assert remote.remote_rev("main") == sha
    assert (remote.work / "units/new.json").read_bytes() == b"[]\n"
    assert repo.status()["ahead"] == 0


def test_direct_write_needs_the_copy_at_the_remote_head(remote):
    other = remote.other_clone()
    (other / "a.txt").write_text("a")
    commit_all(other, "Remote")
    git(other, "push", "-q", "origin", "main")

    with pytest.raises(GitError) as exc:
        remote.repo().base_for_write(direct=True)
    assert exc.value.code == "pull_required"
    # A proposal builds on the remote head, whatever the working copy.
    assert remote.repo().base_for_write(direct=False) == remote.remote_rev("main")


def test_a_rejected_push_reads_as_pull_required(remote):
    repo = remote.repo()
    base = repo.base_for_write(direct=True)
    other = remote.other_clone()
    (other / "a.txt").write_text("a")
    commit_all(other, "Remote")
    git(other, "push", "-q", "origin", "main")

    sha = repo.commit_files(base, {"b.txt": b"b"}, "Mine\n", Author("A", "a@x"))
    with pytest.raises(GitError) as exc:
        repo.push(sha, "main", repo.token)
    assert exc.value.code == "pull_required"


def test_a_nested_directory_is_not_the_repository(remote):
    nested = ContentRepo(remote.work / "units", url=None, branch="main", token=None, committer=Author("A", "a@x"))
    assert not nested.is_repo()
