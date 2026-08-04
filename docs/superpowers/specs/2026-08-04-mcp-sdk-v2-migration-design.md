# Migrate MCP server to Python SDK v2.0.0

## Context

`server/pyproject.toml` currently pins `mcp>=1.0.0,<2.0.0` (added in b08d3ea)
because `mcp` v2.0.0 renamed the high-level `FastMCP` server class. The MCP
Python SDK v2.0.0 was released 2026-07-28; v1.x is now in maintenance mode
(security fixes only). This spec migrates `lamd-mcp-server` onto the v2 line.

Verified against the v2.0.0 GitHub release notes, the official "what's new in
v2" and migration docs, and a source/search cross-check (multiple independent
sources agree): `FastMCP` was renamed `MCPServer` and moved from
`mcp.server.fastmcp` to `mcp.server.mcpserver`. The `@mcp.tool()` /
`@mcp.resource()` decorator API is unchanged. Breaking changes in v2 affect
`Context`/`get_context()`, host/port/transport constructor args, the low-level
`Server` class, and the client API — none of which `lamd-mcp-server` uses.

## Current usage (server/src/lamd_server/mcp_app.py)

- `from mcp.server.fastmcp import FastMCP`
- `mcp = FastMCP("lamd")`
- Two `@mcp.resource(...)` handlers (`get_rule`, `get_all_rules`)
- Three `@mcp.tool()` handlers (`lamd_search_memory`, `lamd_save_decision`,
  `lamd_save_session`)
- `mcp.run()` in `main()`, no args (stdio transport)
- No `Context` parameter, no `get_context()`, no host/port/transport config

This is the only file in the repo that imports from `mcp` directly.

## Changes

### `server/pyproject.toml`

- Dependency constraint: `"mcp>=1.0.0,<2.0.0"` → `"mcp>=2.0.0,<3.0.0"`
- Run `uv lock` to update `server/uv.lock` to resolve `mcp` 2.x.

### `server/src/lamd_server/mcp_app.py`

- Import: `from mcp.server.fastmcp import FastMCP` →
  `from mcp.server.mcpserver import MCPServer`
- Instantiation: `mcp = FastMCP("lamd")` → `mcp = MCPServer("lamd")`
- Everything else (decorators, function bodies, `mcp.run()` in `main()`)
  is unchanged — no transport args are passed today, and stdio remains the
  default transport with no arguments in v2.

No other source file changes.

## Testing

The existing 7 test files (40 tests) under `server/tests/` already exercise
the decorated functions directly (e.g. `lamd_save_decision(...)`,
`get_rule(...)`, `lamd_search_memory(...)`) rather than through a simulated
MCP client. This works because `@mcp.tool()` / `@mcp.resource()` register the
function but return the original callable unchanged, in both v1 and v2. These
tests are the primary regression check for the migration — if the decorator
behavior changed the callable's signature or return value, they'd fail.

Add one new test asserting registration itself survived the migration (the
existing tests never touch the `MCPServer`/`FastMCP` instance, only the
undecorated functions) — e.g. assert the expected tool and resource names
appear on `mcp`'s registered tools/resources after import.

## Verification

1. `uv lock` in `server/` to update the lockfile.
2. `uv sync` (or equivalent) to install `mcp` 2.x into `.venv`.
3. `pytest` in `server/` — all tests green, with `mcp` 2.x actually installed
   (confirm via `pip show mcp` or equivalent), not just the pin changed.

## Out of scope

No adoption of new v2-only features (`security=` on `@mcp.resource()`,
`Context` dependency injection, the new `Client` API, HTTP/SSE transports).
Nothing in this server needs them, and this migration is scoped to "update to
the new SDK," not "adopt new SDK features."
