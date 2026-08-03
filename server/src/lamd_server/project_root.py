from pathlib import Path


class ProjectRootNotFoundError(Exception):
    """Raised when no .lamd/ or .git directory is found walking up from start."""


def find_project_root(start: Path) -> Path:
    current = start.resolve()
    candidates = [current, *current.parents]

    for candidate in candidates:
        if (candidate / ".lamd").is_dir():
            return candidate

    for candidate in candidates:
        if (candidate / ".git").exists():
            return candidate

    raise ProjectRootNotFoundError(
        f"No .lamd/ or .git directory found starting from {start}"
    )
