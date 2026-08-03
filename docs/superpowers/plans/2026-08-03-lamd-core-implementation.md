# LAMD Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build LAMD Core — a Python MCP server that gives Claude Code git-native, file-based project memory (rules/decisions/sessions), plus a thin Node installer CLI that scaffolds `.lamd/` and registers the server.

**Architecture:** Two independent deliverables in one repo. `server/` is a Python package exposing three MCP tools (`lamd_search_memory`, `lamd_save_decision`, `lamd_save_session`) and a dynamic `lamd://rules/{name}` resource, built on the official `mcp` SDK (FastMCP-style decorators) and `rank_bm25` for search. `installer/` is a Node CLI (`npx github:Maheshbsv/lamd init`) with no logic beyond directory scaffolding and MCP config registration — all substantive logic lives server-side. The two never call each other directly; they're connected only via the `.mcp.json` file the installer writes and the server reads at launch.

**Tech Stack:** Python 3.11+, `mcp` SDK, `rank_bm25`, `pyyaml`, `pytest`. Node.js (ESM), built-in `node:test` runner — no extra JS test framework.

## Global Constraints

- Install command is `npx github:Maheshbsv/lamd init` — no npm registry publish, no version pinning for MVP (always runs from `main` HEAD).
- Installer is a **thin** Node CLI: scaffolding + MCP registration only. No memory logic, no BM25, no git querying — that all lives in the Python server.
- MCP server is Python, built on the official `mcp` SDK using FastMCP-style resource/tool decorators.
- Search ranking uses `rank_bm25`'s `BM25Okapi`, with a recency-decay multiplier applied on top.
- All `.lamd/` content is plain files committed to git; branch isolation comes from `git checkout`, not server logic. The `branch` field on decisions/sessions is for display only.
- Rules (`.lamd/rules/*.md`) are exposed as MCP resources and injected in full — never searched, never truncated. Only `decisions/` and `sessions/` are searched.
- Decision filenames: `<YYYYMMDD-HHMMSS>-<slug>.json`. Session filenames: `<YYYY-MM-DD>-<slug>.md`.
- Error handling: missing `.lamd/` → clear error telling the user to run init (server never auto-creates it). Corrupted/unreadable memory file → skipped with a logged warning, does not abort the rest of the search. Git unavailable or `user.name` unset → error asking the user to provide a name and mentioning `git config user.name` must be set.
- All Python tests use `pytest` with an isolated fake `.lamd/` under `tmp_path` — never touch a real project's `.lamd/`.

---

## File Structure

```
server/
  pyproject.toml
  src/lamd_server/
    __init__.py
    project_root.py      # walk-up detection for .lamd/ or .git
    git_info.py           # git user.name / branch lookup
    storage.py             # rule listing, decision/session writers, memory record reader
    search.py              # BM25 + recency decay ranking
    mcp_app.py             # FastMCP wiring: resource + 3 tools, main() entrypoint
  tests/
    test_project_root.py
    test_git_info.py
    test_storage_decisions.py
    test_storage_sessions_and_records.py
    test_search.py
    test_mcp_search_tool.py
    test_mcp_save_tools.py

installer/
  package.json
  bin/lamd.js             # CLI entrypoint: `lamd init`
  src/scaffold.js          # creates .lamd/{rules,decisions,sessions}, starter rule file
  src/mcpConfig.js         # merges lamd entry into .mcp.json
  test/scaffold.test.js
  test/mcpConfig.test.js
  test/cli.test.js
```

---

### Task 1: Python project scaffolding + project-root detection

**Files:**
- Create: `server/pyproject.toml`
- Create: `server/src/lamd_server/__init__.py`
- Create: `server/src/lamd_server/project_root.py`
- Test: `server/tests/test_project_root.py`

**Interfaces:**
- Produces: `find_project_root(start: pathlib.Path) -> pathlib.Path` and `ProjectRootNotFoundError(Exception)` in `lamd_server.project_root`. Walks upward from `start`: returns the first ancestor (inclusive) containing `.lamd/`; if none found, returns the first ancestor containing `.git`; if neither found anywhere up to the filesystem root, raises `ProjectRootNotFoundError`.

- [ ] **Step 1: Create the Python package skeleton**

`server/pyproject.toml`:
```toml
[project]
name = "lamd-mcp-server"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = [
    "mcp>=1.0.0",
    "rank_bm25>=0.2.2",
    "pyyaml>=6.0",
]

[project.scripts]
lamd-mcp-server = "lamd_server.mcp_app:main"

[project.optional-dependencies]
dev = ["pytest>=8.0"]

[build-system]
requires = ["hatchling"]
build-backend = "hatchling.build"

[tool.hatch.build.targets.wheel]
packages = ["src/lamd_server"]

[tool.pytest.ini_options]
testpaths = ["tests"]
```

`server/src/lamd_server/__init__.py`:
```python
```
(empty file — marks the package)

- [ ] **Step 2: Write the failing test**

`server/tests/test_project_root.py`:
```python
import pytest

from lamd_server.project_root import ProjectRootNotFoundError, find_project_root


def test_finds_root_with_lamd_dir_at_start(tmp_path):
    (tmp_path / ".lamd").mkdir()
    assert find_project_root(tmp_path) == tmp_path


def test_finds_root_with_lamd_dir_from_nested_child(tmp_path):
    (tmp_path / ".lamd").mkdir()
    nested = tmp_path / "src" / "deep"
    nested.mkdir(parents=True)
    assert find_project_root(nested) == tmp_path


def test_falls_back_to_git_dir_when_no_lamd(tmp_path):
    (tmp_path / ".git").mkdir()
    nested = tmp_path / "src"
    nested.mkdir()
    assert find_project_root(nested) == tmp_path


def test_prefers_lamd_over_git_at_same_level(tmp_path):
    (tmp_path / ".lamd").mkdir()
    (tmp_path / ".git").mkdir()
    assert find_project_root(tmp_path) == tmp_path


def test_raises_when_neither_marker_found(tmp_path):
    isolated = tmp_path / "no_markers_here"
    isolated.mkdir()
    with pytest.raises(ProjectRootNotFoundError):
        find_project_root(isolated)
```

- [ ] **Step 3: Run tests to verify they fail**

Run (from `server/`): `pip install -e ".[dev]" && pytest tests/test_project_root.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lamd_server.project_root'`

- [ ] **Step 4: Implement `project_root.py`**

`server/src/lamd_server/project_root.py`:
```python
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
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pytest tests/test_project_root.py -v`
Expected: PASS (5 passed)

- [ ] **Step 6: Commit**

```bash
git add server/pyproject.toml server/src/lamd_server/__init__.py server/src/lamd_server/project_root.py server/tests/test_project_root.py
git commit -m "feat(server): add project scaffolding and project-root detection"
```

---

### Task 2: Git info helper

**Files:**
- Create: `server/src/lamd_server/git_info.py`
- Test: `server/tests/test_git_info.py`

**Interfaces:**
- Consumes: nothing from other tasks (only stdlib `subprocess`/`pathlib`).
- Produces: `GitUnavailableError(Exception)`, `get_git_user(cwd: pathlib.Path) -> str`, `get_current_branch(cwd: pathlib.Path) -> str` in `lamd_server.git_info`. Both raise `GitUnavailableError` (with a human-readable message) if git is missing, the command fails, or (for `get_git_user`) `user.name` is unset/empty.

- [ ] **Step 1: Write the failing test**

`server/tests/test_git_info.py`:
```python
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_git_info.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lamd_server.git_info'`

- [ ] **Step 3: Implement `git_info.py`**

`server/src/lamd_server/git_info.py`:
```python
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
    name = _run_git(["config", "user.name"], cwd=cwd)
    if not name:
        raise GitUnavailableError("git config user.name is not set")
    return name


def get_current_branch(cwd: Path) -> str:
    return _run_git(["rev-parse", "--abbrev-ref", "HEAD"], cwd=cwd)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_git_info.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add server/src/lamd_server/git_info.py server/tests/test_git_info.py
git commit -m "feat(server): add git user/branch lookup helper"
```

---

### Task 3: Decision storage writer + rule listing

**Files:**
- Create: `server/src/lamd_server/storage.py`
- Test: `server/tests/test_storage_decisions.py`

**Interfaces:**
- Consumes: nothing (writes plain files given already-resolved `root`, `author`, `branch` — callers get those from Task 1/2).
- Produces (this task's slice of `lamd_server.storage`): `list_rules(root: Path) -> list[Path]` (sorted `.md` files in `root/.lamd/rules`), `write_decision(root: Path, decision: str, reason: str, module: str, author: str, branch: str, *, now: datetime.datetime | None = None) -> Path`. Task 4 adds `write_session` and `read_memory_records`/`MemoryRecord` to this same file — do not let this task's structure block that addition.

- [ ] **Step 1: Write the failing test**

`server/tests/test_storage_decisions.py`:
```python
import json
from datetime import datetime, timezone

from lamd_server.storage import list_rules, write_decision


def test_list_rules_returns_sorted_markdown_files(tmp_path):
    rules_dir = tmp_path / ".lamd" / "rules"
    rules_dir.mkdir(parents=True)
    (rules_dir / "02-testing.md").write_text("# Testing", encoding="utf-8")
    (rules_dir / "01-framework.md").write_text("# Framework", encoding="utf-8")
    (rules_dir / "notes.txt").write_text("ignore me", encoding="utf-8")

    result = list_rules(tmp_path)

    assert [p.name for p in result] == ["01-framework.md", "02-testing.md"]


def test_list_rules_returns_empty_list_when_dir_missing(tmp_path):
    assert list_rules(tmp_path) == []


def test_write_decision_creates_expected_file_and_content(tmp_path):
    fixed_now = datetime(2026, 8, 15, 13, 45, 30, tzinfo=timezone.utc)

    path = write_decision(
        tmp_path,
        decision="Use React for the frontend",
        reason="Team already knows it, avoids ramp-up time",
        module="frontend",
        author="Test User",
        branch="feature/lamd",
        now=fixed_now,
    )

    assert path == tmp_path / ".lamd" / "decisions" / "20260815-134530-use-react-for-the-frontend.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data == {
        "decision": "Use React for the frontend",
        "reason": "Team already knows it, avoids ramp-up time",
        "module": "frontend",
        "author": "Test User",
        "date": "2026-08-15",
        "branch": "feature/lamd",
    }
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_storage_decisions.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lamd_server.storage'`

- [ ] **Step 3: Implement `storage.py` (decision + rules portion)**

`server/src/lamd_server/storage.py`:
```python
import json
import re
from datetime import datetime, timezone
from pathlib import Path


def _slugify(text: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug or "untitled"


def list_rules(root: Path) -> list[Path]:
    rules_dir = root / ".lamd" / "rules"
    if not rules_dir.is_dir():
        return []
    return sorted(rules_dir.glob("*.md"))


def write_decision(
    root: Path,
    decision: str,
    reason: str,
    module: str,
    author: str,
    branch: str,
    *,
    now: datetime | None = None,
) -> Path:
    now = now or datetime.now(timezone.utc)
    timestamp = now.strftime("%Y%m%d-%H%M%S")
    slug = _slugify(decision)
    path = root / ".lamd" / "decisions" / f"{timestamp}-{slug}.json"
    payload = {
        "decision": decision,
        "reason": reason,
        "module": module,
        "author": author,
        "date": now.strftime("%Y-%m-%d"),
        "branch": branch,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    return path
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_storage_decisions.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Commit**

```bash
git add server/src/lamd_server/storage.py server/tests/test_storage_decisions.py
git commit -m "feat(server): add rule listing and decision writer"
```

---

### Task 4: Session writer + memory record reader

**Files:**
- Modify: `server/src/lamd_server/storage.py` (append `write_session`, `MemoryRecord`, `read_memory_records`)
- Test: `server/tests/test_storage_sessions_and_records.py`

**Interfaces:**
- Consumes: `write_decision` from Task 3 (used in this task's tests to set up fixture data for `read_memory_records`).
- Produces: `write_session(root: Path, summary: str, next_steps: str, files_touched: list[str], author: str, branch: str, *, now: datetime.datetime | None = None) -> Path`; `MemoryRecord` dataclass with fields `path: Path`, `kind: str` (`"decision"` or `"session"`), `text: str`, `date: datetime.date`; `read_memory_records(root: Path) -> list[MemoryRecord]` — reads all files under `.lamd/decisions/` and `.lamd/sessions/`, skips unreadable ones with a logged warning (module logger `"lamd_server"`), never raises on a single bad file. These are what Task 5's `search_memory` consumes.

- [ ] **Step 1: Write the failing test**

`server/tests/test_storage_sessions_and_records.py`:
```python
import logging
from datetime import date, datetime, timezone

from lamd_server.storage import (
    read_memory_records,
    write_decision,
    write_session,
)


def test_write_session_creates_expected_file_and_content(tmp_path):
    fixed_now = datetime(2026, 8, 15, 9, 0, 0, tzinfo=timezone.utc)

    path = write_session(
        tmp_path,
        summary="Implemented the login form",
        next_steps="Wire up the API call",
        files_touched=["src/Login.tsx", "src/api.ts"],
        author="Test User",
        branch="feature/login",
        now=fixed_now,
    )

    assert path == tmp_path / ".lamd" / "sessions" / "2026-08-15-implemented-the-login-form.md"
    content = path.read_text(encoding="utf-8")
    assert "date: '2026-08-15'" in content or "date: 2026-08-15" in content
    assert "user: Test User" in content
    assert "branch: feature/login" in content
    assert "Implemented the login form" in content
    assert "Wire up the API call" in content


def test_read_memory_records_reads_decisions_and_sessions(tmp_path):
    now = datetime(2026, 8, 15, 9, 0, 0, tzinfo=timezone.utc)
    write_decision(
        tmp_path, "Use React", "Team knows it", "frontend", "A", "main", now=now
    )
    write_session(
        tmp_path, "Did some work", "Next: tests", ["a.py"], "A", "main", now=now
    )

    records = read_memory_records(tmp_path)

    kinds = sorted(r.kind for r in records)
    assert kinds == ["decision", "session"]
    assert all(r.date == date(2026, 8, 15) for r in records)
    decision_record = next(r for r in records if r.kind == "decision")
    assert "Use React" in decision_record.text
    session_record = next(r for r in records if r.kind == "session")
    assert "Did some work" in session_record.text


def test_read_memory_records_skips_corrupted_files_and_logs_warning(tmp_path, caplog):
    decisions_dir = tmp_path / ".lamd" / "decisions"
    decisions_dir.mkdir(parents=True)
    (decisions_dir / "20260815-000000-broken.json").write_text("not json", encoding="utf-8")

    with caplog.at_level(logging.WARNING, logger="lamd_server"):
        records = read_memory_records(tmp_path)

    assert records == []
    assert any("broken.json" in message for message in caplog.messages)


def test_read_memory_records_returns_empty_list_when_no_dirs(tmp_path):
    assert read_memory_records(tmp_path) == []
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_storage_sessions_and_records.py -v`
Expected: FAIL with `ImportError: cannot import name 'write_session' from 'lamd_server.storage'`

- [ ] **Step 3: Append session writer and record reader to `storage.py`**

Append to `server/src/lamd_server/storage.py` (add these imports to the top: `import logging`, `from dataclasses import dataclass`, `import yaml`, and change `from datetime import datetime, timezone` to also import `date as date_cls`... concretely, replace the existing import block with):

```python
import json
import logging
import re
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime, timezone
from pathlib import Path

import yaml

logger = logging.getLogger("lamd_server")
```

Then append at the end of the file:

```python
def write_session(
    root: Path,
    summary: str,
    next_steps: str,
    files_touched: list[str],
    author: str,
    branch: str,
    *,
    now: datetime | None = None,
) -> Path:
    now = now or datetime.now(timezone.utc)
    date_str = now.strftime("%Y-%m-%d")
    slug = _slugify(summary)
    path = root / ".lamd" / "sessions" / f"{date_str}-{slug}.md"
    frontmatter = {
        "date": date_str,
        "user": author,
        "branch": branch,
        "status": "complete",
        "files_touched": files_touched,
    }
    content = (
        "---\n"
        + yaml.safe_dump(frontmatter, sort_keys=False)
        + "---\n\n"
        + f"{summary}\n\n## Next Steps\n\n{next_steps}\n"
    )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    return path


@dataclass
class MemoryRecord:
    path: Path
    kind: str
    text: str
    date: date_cls


def _read_decision_record(path: Path) -> MemoryRecord:
    data = json.loads(path.read_text(encoding="utf-8"))
    text = f"{data['decision']} {data['reason']} {data['module']}"
    record_date = datetime.strptime(data["date"], "%Y-%m-%d").date()
    return MemoryRecord(path=path, kind="decision", text=text, date=record_date)


def _read_session_record(path: Path) -> MemoryRecord:
    raw = path.read_text(encoding="utf-8")
    _, frontmatter_raw, body = raw.split("---", 2)
    frontmatter = yaml.safe_load(frontmatter_raw)
    files_touched = frontmatter.get("files_touched") or []
    text = f"{body.strip()} {' '.join(files_touched)}"
    record_date = datetime.strptime(str(frontmatter["date"]), "%Y-%m-%d").date()
    return MemoryRecord(path=path, kind="session", text=text, date=record_date)


def read_memory_records(root: Path) -> list[MemoryRecord]:
    records: list[MemoryRecord] = []

    decisions_dir = root / ".lamd" / "decisions"
    if decisions_dir.is_dir():
        for path in sorted(decisions_dir.glob("*.json")):
            try:
                records.append(_read_decision_record(path))
            except Exception:
                logger.warning("Skipping unreadable decision file: %s", path, exc_info=True)

    sessions_dir = root / ".lamd" / "sessions"
    if sessions_dir.is_dir():
        for path in sorted(sessions_dir.glob("*.md")):
            try:
                records.append(_read_session_record(path))
            except Exception:
                logger.warning("Skipping unreadable session file: %s", path, exc_info=True)

    return records
```

Also add `pyyaml` to `server/pyproject.toml` dependencies if not already present (it was added in Task 1 — verify it's there).

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_storage_sessions_and_records.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Run the full storage test suite to check for regressions**

Run: `pytest tests/test_storage_decisions.py tests/test_storage_sessions_and_records.py -v`
Expected: PASS (7 passed)

- [ ] **Step 6: Commit**

```bash
git add server/src/lamd_server/storage.py server/tests/test_storage_sessions_and_records.py server/pyproject.toml
git commit -m "feat(server): add session writer and memory record reader"
```

---

### Task 5: BM25 search with recency decay

**Files:**
- Create: `server/src/lamd_server/search.py`
- Test: `server/tests/test_search.py`

**Interfaces:**
- Consumes: `MemoryRecord` from `lamd_server.storage` (Task 4).
- Produces: `SearchResult` dataclass (`path: Path`, `kind: str`, `score: float`, `snippet: str`) and `search_memory(records: list[MemoryRecord], query: str, *, today: datetime.date, top_k: int = 5) -> list[SearchResult]` in `lamd_server.search`. This is what Task 6's `lamd_search_memory` MCP tool calls.

- [ ] **Step 1: Write the failing test**

`server/tests/test_search.py`:
```python
from datetime import date

from lamd_server.search import search_memory
from lamd_server.storage import MemoryRecord


def _record(text, day_offset, kind="decision", path="rec.json"):
    return MemoryRecord(
        path=path if not isinstance(path, str) else __import__("pathlib").Path(path),
        kind=kind,
        text=text,
        date=date(2026, 8, 15 - day_offset) if day_offset < 15 else date(2026, 7, 15),
    )


def test_search_memory_returns_empty_list_for_no_records():
    assert search_memory([], "anything", today=date(2026, 8, 15)) == []


def test_search_memory_ranks_relevant_result_first():
    records = [
        _record("database schema uses postgres for storage", 0, path="a.json"),
        _record("frontend uses react and typescript", 0, path="b.json"),
    ]

    results = search_memory(records, "database schema", today=date(2026, 8, 15))

    assert results[0].path.name == "a.json"


def test_search_memory_applies_recency_decay_to_equally_relevant_records():
    records = [
        _record("auth flow uses jwt tokens", 0, path="recent.json"),
        _record("auth flow uses jwt tokens", 60, path="old.json"),
    ]

    results = search_memory(records, "auth flow jwt", today=date(2026, 8, 15))

    assert results[0].path.name == "recent.json"
    assert results[0].score > results[1].score


def test_search_memory_respects_top_k():
    records = [_record(f"topic number {i}", 0, path=f"{i}.json") for i in range(10)]

    results = search_memory(records, "topic", today=date(2026, 8, 15), top_k=3)

    assert len(results) == 3


def test_search_memory_snippet_is_truncated():
    long_text = "word " * 300
    records = [_record(long_text, 0, path="long.json")]

    results = search_memory(records, "word", today=date(2026, 8, 15))

    assert len(results[0].snippet) <= 500
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_search.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lamd_server.search'`

- [ ] **Step 3: Implement `search.py`**

`server/src/lamd_server/search.py`:
```python
from dataclasses import dataclass
from datetime import date as date_cls
from pathlib import Path

from rank_bm25 import BM25Okapi

from .storage import MemoryRecord

RECENCY_HALF_LIFE_DAYS = 30
SNIPPET_MAX_CHARS = 500


@dataclass
class SearchResult:
    path: Path
    kind: str
    score: float
    snippet: str


def _tokenize(text: str) -> list[str]:
    return text.lower().split()


def search_memory(
    records: list[MemoryRecord],
    query: str,
    *,
    today: date_cls,
    top_k: int = 5,
) -> list[SearchResult]:
    if not records:
        return []

    corpus = [_tokenize(record.text) for record in records]
    bm25 = BM25Okapi(corpus)
    raw_scores = bm25.get_scores(_tokenize(query))

    scored = []
    for record, raw_score in zip(records, raw_scores):
        age_days = max((today - record.date).days, 0)
        decay = 0.5 ** (age_days / RECENCY_HALF_LIFE_DAYS)
        scored.append((record, raw_score * decay))

    scored.sort(key=lambda pair: pair[1], reverse=True)

    return [
        SearchResult(
            path=record.path,
            kind=record.kind,
            score=score,
            snippet=record.text[:SNIPPET_MAX_CHARS],
        )
        for record, score in scored[:top_k]
    ]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_search.py -v`
Expected: PASS (5 passed)

- [ ] **Step 5: Commit**

```bash
git add server/src/lamd_server/search.py server/tests/test_search.py
git commit -m "feat(server): add BM25 search with recency decay"
```

---

### Task 6: MCP wiring — rules resource + search tool

**Files:**
- Create: `server/src/lamd_server/mcp_app.py`
- Test: `server/tests/test_mcp_search_tool.py`

**Interfaces:**
- Consumes: `find_project_root`/`ProjectRootNotFoundError` (Task 1), `list_rules`/`read_memory_records` (Tasks 3–4), `search_memory` (Task 5).
- Produces: `mcp` (the `FastMCP` app instance), `MISSING_LAMD_ERROR: str`, `get_rule(name: str) -> str`, `lamd_search_memory(query: str) -> str` in `lamd_server.mcp_app`. Task 7 adds `lamd_save_decision`/`lamd_save_session` tools and `main()` to this same file.

- [ ] **Step 1: Write the failing test**

`server/tests/test_mcp_search_tool.py`:
```python
import os
from datetime import datetime, timezone

import pytest

from lamd_server.mcp_app import MISSING_LAMD_ERROR, get_rule, lamd_search_memory
from lamd_server.storage import write_decision


@pytest.fixture
def project(tmp_path, monkeypatch):
    (tmp_path / ".lamd" / "rules").mkdir(parents=True)
    (tmp_path / ".lamd" / "decisions").mkdir(parents=True)
    (tmp_path / ".lamd" / "sessions").mkdir(parents=True)
    (tmp_path / ".lamd" / "rules" / "01-framework.md").write_text(
        "# Use React", encoding="utf-8"
    )
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_get_rule_returns_file_contents(project):
    assert get_rule("01-framework.md") == "# Use React"


def test_lamd_search_memory_returns_no_match_message_when_empty(project):
    assert lamd_search_memory("anything") == "No matching memory found."


def test_lamd_search_memory_returns_formatted_results(project):
    write_decision(
        project,
        "Use React",
        "Team already knows it",
        "frontend",
        "Test User",
        "main",
        now=datetime.now(timezone.utc),
    )

    result = lamd_search_memory("react frontend")

    assert "decision" in result
    assert "Use React" in result


def test_lamd_search_memory_errors_when_no_lamd_dir(tmp_path, monkeypatch):
    empty_dir = tmp_path / "no_lamd"
    empty_dir.mkdir()
    (empty_dir / ".git").mkdir()
    monkeypatch.chdir(empty_dir)

    with pytest.raises(RuntimeError, match=MISSING_LAMD_ERROR):
        lamd_search_memory("anything")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mcp_search_tool.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'lamd_server.mcp_app'`

- [ ] **Step 3: Implement `mcp_app.py` (resource + search tool portion)**

`server/src/lamd_server/mcp_app.py`:
```python
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
    path = root / ".lamd" / "rules" / name
    return path.read_text(encoding="utf-8")


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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mcp_search_tool.py -v`
Expected: PASS (4 passed)

- [ ] **Step 5: Commit**

```bash
git add server/src/lamd_server/mcp_app.py server/tests/test_mcp_search_tool.py
git commit -m "feat(server): wire rules resource and search tool via FastMCP"
```

---

### Task 7: MCP wiring — save tools + entrypoint

**Files:**
- Modify: `server/src/lamd_server/mcp_app.py` (append `lamd_save_decision`, `lamd_save_session`, `main()`)
- Test: `server/tests/test_mcp_save_tools.py`

**Interfaces:**
- Consumes: `get_git_user`/`get_current_branch`/`GitUnavailableError` (Task 2), `write_decision`/`write_session` (Tasks 3–4), plus `_project_root`/`_require_lamd_dir`/`MISSING_LAMD_ERROR`/`mcp` already defined in `mcp_app.py` (Task 6).
- Produces: `lamd_save_decision(decision: str, reason: str, module: str) -> str`, `lamd_save_session(summary: str, next_steps: str, files_touched: list[str]) -> str`, `main() -> None` (the `lamd-mcp-server` console-script entrypoint, calls `mcp.run()`) in `lamd_server.mcp_app`.

- [ ] **Step 1: Write the failing test**

`server/tests/test_mcp_save_tools.py`:
```python
import json
import subprocess

import pytest

from lamd_server.mcp_app import lamd_save_decision, lamd_save_session


@pytest.fixture
def project(tmp_path, monkeypatch):
    (tmp_path / ".lamd" / "rules").mkdir(parents=True)
    (tmp_path / ".lamd" / "decisions").mkdir(parents=True)
    (tmp_path / ".lamd" / "sessions").mkdir(parents=True)
    subprocess.run(["git", "init", "-q"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.name", "Test User"], cwd=tmp_path, check=True)
    subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=tmp_path, check=True)
    monkeypatch.chdir(tmp_path)
    return tmp_path


def test_lamd_save_decision_writes_file(project):
    message = lamd_save_decision("Use React", "Team knows it", "frontend")

    assert "Saved decision" in message
    files = list((project / ".lamd" / "decisions").glob("*.json"))
    assert len(files) == 1
    data = json.loads(files[0].read_text(encoding="utf-8"))
    assert data["decision"] == "Use React"
    assert data["author"] == "Test User"


def test_lamd_save_session_writes_file(project):
    message = lamd_save_session("Did the thing", "Test it next", ["a.py"])

    assert "Saved session" in message
    files = list((project / ".lamd" / "sessions").glob("*.md"))
    assert len(files) == 1
    assert "Did the thing" in files[0].read_text(encoding="utf-8")


def test_lamd_save_decision_errors_with_helpful_message_when_git_unavailable(project):
    subprocess.run(["git", "config", "user.name", ""], cwd=project, check=True)

    with pytest.raises(RuntimeError, match="git config user.name"):
        lamd_save_decision("Use React", "Team knows it", "frontend")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_mcp_save_tools.py -v`
Expected: FAIL with `ImportError: cannot import name 'lamd_save_decision' from 'lamd_server.mcp_app'`

- [ ] **Step 3: Append save tools and entrypoint to `mcp_app.py`**

Add these imports to the top of `server/src/lamd_server/mcp_app.py` (alongside the existing ones):
```python
from .git_info import GitUnavailableError, get_current_branch, get_git_user
from .storage import write_decision, write_session
```

Append at the end of the file:

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_mcp_save_tools.py -v`
Expected: PASS (3 passed)

- [ ] **Step 5: Run the full Python test suite to check for regressions**

Run (from `server/`): `pytest -v`
Expected: all tests across all files PASS

- [ ] **Step 6: Commit**

```bash
git add server/src/lamd_server/mcp_app.py server/tests/test_mcp_save_tools.py
git commit -m "feat(server): wire save-decision and save-session tools, add entrypoint"
```

---

### Task 8: Node installer — scaffold `.lamd/`

**Files:**
- Create: `installer/package.json`
- Create: `installer/src/scaffold.js`
- Test: `installer/test/scaffold.test.js`

**Interfaces:**
- Produces: `scaffold(projectRoot: string) -> { lamdDir: string, starterRulePath: string }` (named export) in `installer/src/scaffold.js`. Creates `.lamd/rules/`, `.lamd/decisions/`, `.lamd/sessions/` under `projectRoot`, and writes `.lamd/rules/01-framework.md` with starter content **only if it doesn't already exist** (re-running init must not clobber an edited starter rule).

- [ ] **Step 1: Create `package.json`**

`installer/package.json`:
```json
{
  "name": "lamd-installer",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "bin": {
    "lamd": "./bin/lamd.js"
  },
  "scripts": {
    "test": "node --test"
  },
  "engines": {
    "node": ">=18"
  }
}
```

- [ ] **Step 2: Write the failing test**

`installer/test/scaffold.test.js`:
```js
import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scaffold } from "../src/scaffold.js";

test("scaffold creates the three .lamd subdirectories", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  scaffold(projectRoot);

  assert.ok(existsSync(join(projectRoot, ".lamd", "rules")));
  assert.ok(existsSync(join(projectRoot, ".lamd", "decisions")));
  assert.ok(existsSync(join(projectRoot, ".lamd", "sessions")));
});

test("scaffold writes a starter rule file", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  const { starterRulePath } = scaffold(projectRoot);

  assert.ok(existsSync(starterRulePath));
  assert.match(readFileSync(starterRulePath, "utf8"), /Framework Rules/);
});

test("scaffold does not overwrite an existing starter rule file", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));
  scaffold(projectRoot);
  const { starterRulePath } = scaffold(projectRoot);
  writeFileSync(starterRulePath, "custom content", "utf8");

  scaffold(projectRoot);

  assert.equal(readFileSync(starterRulePath, "utf8"), "custom content");
});
```

- [ ] **Step 3: Run test to verify it fails**

Run (from `installer/`): `node --test`
Expected: FAIL with a module-not-found error for `../src/scaffold.js`

- [ ] **Step 4: Implement `scaffold.js`**

`installer/src/scaffold.js`:
```js
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STARTER_RULE = `# Framework Rules

- (Add your project's hard guardrails here, e.g. "Use React", "Always use async/await")
`;

export function scaffold(projectRoot) {
  const lamdDir = join(projectRoot, ".lamd");
  for (const name of ["rules", "decisions", "sessions"]) {
    mkdirSync(join(lamdDir, name), { recursive: true });
  }

  const starterRulePath = join(lamdDir, "rules", "01-framework.md");
  if (!existsSync(starterRulePath)) {
    writeFileSync(starterRulePath, STARTER_RULE, "utf8");
  }

  return { lamdDir, starterRulePath };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `node --test`
Expected: PASS (3 passed)

- [ ] **Step 6: Commit**

```bash
git add installer/package.json installer/src/scaffold.js installer/test/scaffold.test.js
git commit -m "feat(installer): add .lamd/ directory scaffolding"
```

---

### Task 9: Node installer — MCP registration + CLI entrypoint

**Files:**
- Create: `installer/src/mcpConfig.js`
- Create: `installer/bin/lamd.js`
- Test: `installer/test/mcpConfig.test.js`
- Test: `installer/test/cli.test.js`

**Interfaces:**
- Consumes: `scaffold` (Task 8).
- Produces: `registerMcpServer(projectRoot: string) -> string` (named export in `installer/src/mcpConfig.js`, returns the path to `.mcp.json`) and the `lamd` CLI (`bin/lamd.js`, invoked as `lamd init`) that calls both `scaffold` and `registerMcpServer` and prints a summary.

- [ ] **Step 1: Write the failing test for `mcpConfig.js`**

`installer/test/mcpConfig.test.js`:
```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registerMcpServer } from "../src/mcpConfig.js";

test("registerMcpServer creates .mcp.json with the lamd entry when none exists", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  const configPath = registerMcpServer(projectRoot);

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.lamd, {
    command: "uvx",
    args: [
      "--from",
      "git+https://github.com/Maheshbsv/lamd.git#subdirectory=server",
      "lamd-mcp-server",
    ],
  });
});

test("registerMcpServer merges into an existing .mcp.json without dropping other servers", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));
  const configPath = join(projectRoot, ".mcp.json");
  writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { other: { command: "other-cmd" } } }),
    "utf8"
  );

  registerMcpServer(projectRoot);

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.other, { command: "other-cmd" });
  assert.ok(config.mcpServers.lamd);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/mcpConfig.test.js`
Expected: FAIL with a module-not-found error for `../src/mcpConfig.js`

- [ ] **Step 3: Implement `mcpConfig.js`**

`installer/src/mcpConfig.js`:
```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_NAME = "lamd";
const SERVER_ENTRY = {
  command: "uvx",
  args: [
    "--from",
    "git+https://github.com/Maheshbsv/lamd.git#subdirectory=server",
    "lamd-mcp-server",
  ],
};

export function registerMcpServer(projectRoot) {
  const configPath = join(projectRoot, ".mcp.json");
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};

  config.mcpServers = config.mcpServers || {};
  config.mcpServers[SERVER_NAME] = SERVER_ENTRY;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/mcpConfig.test.js`
Expected: PASS (2 passed)

- [ ] **Step 5: Write the failing test for the CLI entrypoint**

`installer/test/cli.test.js`:
```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "lamd.js");

test("lamd init scaffolds .lamd/ and writes .mcp.json", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });

  assert.ok(existsSync(join(projectRoot, ".lamd", "rules", "01-framework.md")));
  assert.ok(existsSync(join(projectRoot, ".mcp.json")));
});

test("lamd with an unknown command exits non-zero", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  assert.throws(() => {
    execFileSync("node", [CLI_PATH, "bogus"], { cwd: projectRoot });
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `node --test test/cli.test.js`
Expected: FAIL (`bin/lamd.js` does not exist yet)

- [ ] **Step 7: Implement `bin/lamd.js`**

`installer/bin/lamd.js`:
```js
#!/usr/bin/env node
import { registerMcpServer } from "../src/mcpConfig.js";
import { scaffold } from "../src/scaffold.js";

const [, , command] = process.argv;

if (command !== "init") {
  console.error(`Unknown command: ${command ?? "(none)"}. Usage: lamd init`);
  process.exit(1);
}

const projectRoot = process.cwd();
const { lamdDir, starterRulePath } = scaffold(projectRoot);
const configPath = registerMcpServer(projectRoot);

console.log(`Created ${lamdDir}`);
console.log(`Wrote starter rule: ${starterRulePath}`);
console.log(`Registered LAMD MCP server in ${configPath}`);
```

Make it executable: `chmod +x installer/bin/lamd.js` (skip on Windows — the shebang is unused there but harmless).

- [ ] **Step 8: Run tests to verify they pass**

Run (from `installer/`): `node --test`
Expected: all tests across `test/scaffold.test.js`, `test/mcpConfig.test.js`, `test/cli.test.js` PASS

- [ ] **Step 9: Commit**

```bash
git add installer/src/mcpConfig.js installer/bin/lamd.js installer/test/mcpConfig.test.js installer/test/cli.test.js
git commit -m "feat(installer): register MCP server and wire CLI entrypoint"
```

---

## Self-Review Notes

- **Spec coverage:** §2 install/runtime → Tasks 1, 8, 9. §3 file schema → Tasks 3, 4. §4 MCP tools → Tasks 6, 7. §5 rule injection → Task 6 (`get_rule` resource). §6 error handling (missing `.lamd/`, corrupted file, git unavailable) → Tasks 4, 6, 7. §7 testing (pytest + tmp_path isolation) → all Python tasks. §8 distribution decisions (GitHub-only, no versioning) → Task 9's hardcoded `uvx --from git+https://github.com/Maheshbsv/lamd.git#subdirectory=server` command, no package.json publish config. Proactive-curation prompt injection (spec §5, PRD §3.4) is a system-prompt/instructions concern, not code — out of scope for this plan; flagged here so it isn't silently dropped.
- **Placeholder scan:** no TBD/TODO markers; every step has runnable code.
- **Type consistency:** `MemoryRecord` (Task 4) fields match what `search_memory` (Task 5) and `read_memory_records`'s callers (Task 6) use. `write_decision`/`write_session` signatures (Tasks 3–4) match their call sites in `mcp_app.py` (Task 7). `scaffold()`'s return shape (`{ lamdDir, starterRulePath }`) matches what `bin/lamd.js` (Task 9) destructures.
