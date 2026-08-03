import subprocess

import pytest

from lamd_server.git_info import GitUnavailableError, get_current_branch, get_git_user


@pytest.fixture
def git_repo(tmp_path):
    repo = tmp_path / "repo"
    repo.mkdir()
    subprocess.run(["git", "init", "-q"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=repo, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=repo, check=True)
    subprocess.run(["git", "checkout", "-q", "-b", "feature/lamd"], cwd=repo, check=True)
    # Create initial commit so HEAD exists
    (repo / "file.txt").write_text("test")
    subprocess.run(["git", "add", "file.txt"], cwd=repo, check=True)
    subprocess.run(["git", "commit", "-q", "-m", "initial"], cwd=repo, check=True)
    return repo


def test_get_git_user_returns_configured_name(git_repo):
    assert get_git_user(git_repo) == "Test User"


def test_get_current_branch_returns_checked_out_branch(git_repo):
    assert get_current_branch(git_repo) == "feature/lamd"


def test_get_git_user_raises_when_name_unset(git_repo):
    subprocess.run(["git", "config", "user.name", ""], cwd=git_repo, check=True)
    with pytest.raises(GitUnavailableError):
        get_git_user(git_repo)


def test_get_git_user_raises_outside_a_repo(tmp_path):
    not_a_repo = tmp_path / "plain_dir"
    not_a_repo.mkdir()
    with pytest.raises(GitUnavailableError):
        get_git_user(not_a_repo)
