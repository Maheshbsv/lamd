import subprocess
from pathlib import Path


class GitUnavailableError(Exception):
    """Raised when git is missing, fails, or user.name is not configured."""


def _run_git(args: list[str], cwd: Path) -> str:
    try:
        result = subprocess.run(
            ["git", *args],
            cwd=cwd,
            capture_output=True,
            text=True,
            timeout=5,
        )
    except FileNotFoundError as exc:
        raise GitUnavailableError("git is not installed or not on PATH") from exc

    if result.returncode != 0:
        message = result.stderr.strip() or f"git {' '.join(args)} failed"
        raise GitUnavailableError(message)

    return result.stdout.strip()


def get_git_user(cwd: Path) -> str:
    _run_git(["rev-parse", "--is-inside-work-tree"], cwd=cwd)
    name = _run_git(["config", "user.name"], cwd=cwd)
    if not name:
        raise GitUnavailableError("git config user.name is not set")
    return name


def get_current_branch(cwd: Path) -> str:
    return _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)
