from datetime import datetime, timezone
from pathlib import Path

from mcp.server.mcpserver import MCPServer

from .git_info import GitUnavailableError, get_current_branch, get_git_user
from .project_root import ProjectRootNotFoundError, find_project_root
from .search import search_memory
from .storage import list_rules, read_memory_records, write_decision, write_session

mcp = MCPServer("lamd")

MISSING_LAMD_ERROR = (
    "No .lamd/ directory found for this project. Run "
    "`npx github:Maheshbsv/lamd init` in the project root first."
)


def _project_root() -> Path:
    try:
        return find_project_root(Path.cwd())
    except ProjectRootNotFoundError as exc:
        raise RuntimeError(MISSING_LAMD_ERROR) from exc


def _require_lamd_dir(root: Path) -> None:
    if not (root / ".lamd").is_dir():
        raise RuntimeError(MISSING_LAMD_ERROR)


@mcp.resource("lamd://rules/{name}")
def get_rule(name: str) -> str:
    root = _project_root()
    _require_lamd_dir(root)
    rules_dir = (root / ".lamd" / "rules").resolve()
    candidate = (rules_dir / name).resolve()
    if not candidate.is_relative_to(rules_dir):
        raise RuntimeError(f"Invalid rule name: {name!r}")
    return candidate.read_text(encoding="utf-8")


@mcp.resource("lamd://rules")
def get_all_rules() -> str:
    root = _project_root()
    _require_lamd_dir(root)
    rules = list_rules(root)
    if not rules:
        return "No rules defined yet."
    return "\n\n---\n\n".join(
        f"# {rule.name}\n\n{rule.read_text(encoding='utf-8')}" for rule in rules
    )


@mcp.tool()
def lamd_search_memory(query: str) -> str:
    root = _project_root()
    _require_lamd_dir(root)
    records = read_memory_records(root)
    results = search_memory(records, query, today=datetime.now(timezone.utc).date())
    if not results:
        return "No matching memory found."
    return "\n\n".join(
        f"[{r.kind}] {r.path.name} (score={r.score:.2f})\n{r.snippet}" for r in results
    )


def _git_context(root: Path) -> tuple[str, str]:
    try:
        author = get_git_user(root)
        branch = get_current_branch(root)
    except GitUnavailableError as exc:
        raise RuntimeError(
            "Could not determine your Git identity "
            f"({exc}). Please tell me your name, and run "
            '`git config user.name "Your Name"` so this is automatic next time.'
        ) from exc
    return author, branch


@mcp.tool()
def lamd_save_decision(decision: str, reason: str, module: str) -> str:
    """Call this when an architectural decision is finalized — a technology choice, pattern change, or tradeoff with lasting consequences — to record it for future sessions."""
    root = _project_root()
    _require_lamd_dir(root)
    author, branch = _git_context(root)
    path = write_decision(root, decision, reason, module, author, branch)
    return f"Saved decision to {path.relative_to(root)}"


@mcp.tool()
def lamd_save_session(summary: str, next_steps: str, files_touched: list[str]) -> str:
    root = _project_root()
    _require_lamd_dir(root)
    author, branch = _git_context(root)
    path = write_session(root, summary, next_steps, files_touched, author, branch)
    return f"Saved session to {path.relative_to(root)}"


def main() -> None:
    mcp.run()
