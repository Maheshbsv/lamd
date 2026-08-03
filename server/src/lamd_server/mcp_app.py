from datetime import datetime, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

from .project_root import find_project_root
from .search import search_memory
from .storage import read_memory_records

mcp = FastMCP("lamd")

MISSING_LAMD_ERROR = (
    "No .lamd/ directory found for this project. Run "
    "`npx github:Maheshbsv/lamd init` in the project root first."
)


def _project_root() -> Path:
    return find_project_root(Path.cwd())


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
