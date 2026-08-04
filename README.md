# LAMD Core

LAMD (Local AI Memory Daemon) gives coding agents durable,
project-scoped memory: rules injected into every session, and searchable
records of past decisions and session summaries.

## Install

From your project root, run:

```
npx github:Maheshbsv/lamd init
```

This scaffolds a `.lamd/` directory (`rules/`, `decisions/`, `sessions/`)
with a starter rule file, registers the LAMD MCP server in `.mcp.json` so
compatible agent clients (e.g. Claude Code) can load it automatically, and
installs a `SessionStart` hook (`.claude/hooks/lamd_inject_rules.py`,
registered in `.claude/settings.json`) that injects the contents of
`.lamd/rules/*.md` into every session's context automatically — no manual
tool call required. The MCP server itself runs via `uvx` — no manual
Python package install required.

See `docs/superpowers/specs/2026-08-01-lamd-core-design.md` for the full
design.
