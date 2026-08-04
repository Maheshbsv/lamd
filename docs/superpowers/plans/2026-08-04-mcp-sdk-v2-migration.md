# MCP Server SDK v2 Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move `lamd-mcp-server` off the `mcp` 1.x pin onto `mcp` 2.0.0.x, with the existing test suite as the regression gate and one new test guarding SDK registration behavior.

**Architecture:** No architectural change. `server/src/lamd_server/mcp_app.py` is the only file in the repo importing from `mcp`; it uses only the high-level decorator API (`@mcp.tool()`, `@mcp.resource()`, `mcp.run()`), none of which changed shape in v2 — only the class name and import path moved (`mcp.server.fastmcp.FastMCP` → `mcp.server.mcpserver.MCPServer`).

**Tech Stack:** Python 3.11+, `mcp` SDK, `uv` for dependency management, `pytest` for tests.

## Global Constraints

- Dependency pin: `mcp>=2.0.0,<3.0.0` (spec: `docs/superpowers/specs/2026-08-04-mcp-sdk-v2-migration-design.md`)
- No new runtime or dev dependencies (no `pytest-asyncio`; use `asyncio.run()` in sync test functions)
- Only `server/pyproject.toml`, `server/uv.lock`, `server/src/lamd_server/mcp_app.py`, and one new test file change — no other source file touches `mcp` directly
- No adoption of new v2-only features (`security=`, `Context` injection, `Client` API, HTTP/SSE transports) — out of scope per spec

---

### Task 1: Bump `mcp` to v2 and migrate `mcp_app.py`

**Files:**
- Modify: `server/pyproject.toml:6` (dependency pin)
- Modify: `server/uv.lock` (regenerated, not hand-edited)
- Modify: `server/src/lamd_server/mcp_app.py:4,11` (import + instantiation)
- Test: `server/tests/*.py` (existing 7 files, 40 tests — used as regression gate, not modified)

**Interfaces:**
- Consumes: nothing from other tasks (first task)
- Produces: `mcp` (module-level `MCPServer` instance in `lamd_server.mcp_app`, same public surface as before — `get_rule`, `get_all_rules`, `lamd_search_memory`, `lamd_save_decision`, `lamd_save_session`, `main`) that Task 2 imports for its registration test

- [ ] **Step 1: Confirm the baseline passes before touching anything**

Run: `cd server && uv run pytest -v`
Expected: 40 passed (all existing tests green on `mcp` 1.29.0, confirming the starting point is clean)

- [ ] **Step 2: Bump the dependency pin**

In `server/pyproject.toml`, change:

```toml
dependencies = [
    "mcp>=1.0.0,<2.0.0",
    "rank_bm25>=0.2.2",
    "pyyaml>=6.0",
]
```

to:

```toml
dependencies = [
    "mcp>=2.0.0,<3.0.0",
    "rank_bm25>=0.2.2",
    "pyyaml>=6.0",
]
```

- [ ] **Step 3: Re-lock and sync**

Run: `cd server && uv lock && uv sync`
Expected: `uv.lock` updates to resolve `mcp` in the 2.x range; `uv sync` installs it into `.venv`. Verify with:
`uv run python -c "import importlib.metadata as m; print(m.version('mcp'))"`
Expected output: a `2.x.x` version string.

- [ ] **Step 4: Migrate the import and instantiation**

In `server/src/lamd_server/mcp_app.py`, change:

```python
from mcp.server.fastmcp import FastMCP
```

to:

```python
from mcp.server.mcpserver import MCPServer
```

and change:

```python
mcp = FastMCP("lamd")
```

to:

```python
mcp = MCPServer("lamd")
```

No other lines in the file change — decorators, function bodies, and `mcp.run()` in `main()` stay exactly as they are.

- [ ] **Step 5: Run the full test suite against the migrated code**

Run: `cd server && uv run pytest -v`
Expected: 40 passed. If anything fails, do not proceed to Task 2 — the failure means a v2 behavior change wasn't captured by this plan and needs investigating before continuing.

- [ ] **Step 6: Commit**

```bash
cd server
git add pyproject.toml uv.lock src/lamd_server/mcp_app.py
git commit -m "$(cat <<'EOF'
feat(server): migrate mcp_app.py to MCP Python SDK v2

FastMCP moved from mcp.server.fastmcp to mcp.server.mcpserver and was
renamed MCPServer in mcp 2.0.0. The decorator API and run() are
unchanged for stdio-only servers, so this is an import/class rename.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Add a registration smoke test

**Files:**
- Create: `server/tests/test_mcp_registration.py`

**Interfaces:**
- Consumes: `mcp` (the module-level `MCPServer` instance from `lamd_server.mcp_app`, produced by Task 1) — specifically its async `list_tools()`, `list_resources()`, and `list_resource_templates()` methods, which return objects with `.name`, `.uri`, and `.uriTemplate` attributes respectively (verified interactively against the installed SDK: `list_tools()` returns objects with `.name`, `list_resource_templates()` returns objects with `.uriTemplate`)
- Produces: nothing consumed by later tasks (last task)

This test is a regression/verification check on SDK registration behavior itself (does `@mcp.tool()`/`@mcp.resource()` still register against the `MCPServer` instance the way it did against `FastMCP`), which the existing tests don't cover — they only call the decorated functions directly as plain Python callables, never touching `mcp.list_tools()` / `mcp.list_resources()`. Because the behavior under test is already correct after Task 1, there's no red step from wrong production code — the "fails" step below is a real failure (missing file), not a placeholder.

- [ ] **Step 1: Run pytest for the not-yet-created file to confirm it fails**

Run: `cd server && uv run pytest tests/test_mcp_registration.py -v`
Expected: FAIL — `ERROR: file or directory not found: tests/test_mcp_registration.py`

- [ ] **Step 2: Create the test file**

```python
import asyncio

from lamd_server.mcp_app import mcp


def test_tools_are_registered():
    tools = asyncio.run(mcp.list_tools())
    names = {t.name for t in tools}
    assert names == {
        "lamd_search_memory",
        "lamd_save_decision",
        "lamd_save_session",
    }


def test_resources_are_registered():
    resources = asyncio.run(mcp.list_resources())
    resource_uris = {str(r.uri) for r in resources}
    assert resource_uris == {"lamd://rules"}

    templates = asyncio.run(mcp.list_resource_templates())
    template_uris = {t.uriTemplate for t in templates}
    assert template_uris == {"lamd://rules/{name}"}
```

- [ ] **Step 3: Run the test to verify it passes**

Run: `cd server && uv run pytest tests/test_mcp_registration.py -v`
Expected: 2 passed

- [ ] **Step 4: Run the full suite one more time**

Run: `cd server && uv run pytest -v`
Expected: 42 passed (40 pre-existing + 2 new)

- [ ] **Step 5: Commit**

```bash
cd server
git add tests/test_mcp_registration.py
git commit -m "$(cat <<'EOF'
test(server): add MCP tool/resource registration smoke test

The existing tests call the decorated functions directly as plain
callables and never exercise mcp.list_tools()/list_resources(), so
they wouldn't catch a registration break from the v2 migration. This
closes that gap.

Co-Authored-By: Claude Sonnet 5 <noreply@anthropic.com>
EOF
)"
```
