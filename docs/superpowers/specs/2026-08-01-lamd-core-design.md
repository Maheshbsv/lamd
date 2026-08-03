# Design: LAMD Core

## 1. Summary

LAMD (Local AI Memory Daemon) is a git-native, file-based memory and context
engine for Claude Code. It solves "blind collision" between collaborators
(often non-technical business users) who work on separate branches without
shared awareness of established architectural rules and decisions.

Source requirements: `docs/lamd/brd.md`, `docs/lamd/prd.md`,
`docs/lamd/architecture.md`.

## 2. Distribution & Runtime Architecture

- **Install**: `npx github:<owner>/<repo> init` — a thin Node CLI, published
  from the project's own GitHub repo (exact path TBD, see §8), with no
  logic beyond scaffolding and registration (all substantive logic lives in
  the Python server). On run it:
  1. Creates `.lamd/rules/`, `.lamd/decisions/`, `.lamd/sessions/` in the
     current project.
  2. Writes a starter `.lamd/rules/01-framework.md`.
  3. Registers the LAMD MCP server in the user's Claude Code MCP config,
     configured to launch the Python server via `uvx` (or `uv run`) so the
     end user never installs Python packages by hand.
- **Runtime**: The MCP server is Python, built on the official `mcp` SDK
  (FastMCP-style resource/tool decorators). Claude Code launches it as a
  per-project background process with cwd at the project root.
- **Project root detection**: on startup, the server walks upward from its
  cwd looking for a `.lamd/` directory (falling back to a `.git` directory
  as a secondary marker) to locate the active project. No explicit path
  configuration is required.

## 3. File System Schema

All memory is stored under `.lamd/` at the project root and committed to
git alongside application code.

- **`.lamd/rules/*.md`** — plain Markdown. Hard guardrails (e.g. "Use
  React", "Always use async/await"). Exposed as MCP *resources* and
  injected in full into every session's context — never searched, never
  truncated.
- **`.lamd/decisions/<YYYYMMDD-HHMMSS>-<slug>.json`** — one file per
  decision. The timestamp in the filename means two collaborators
  essentially never write to the same file, so JSON merge-conflict risk is
  avoided by construction rather than by conflict-resolution tooling.
  Fields: `decision`, `reason`, `module`, `author`, `date`, `branch`.
- **`.lamd/sessions/<YYYY-MM-DD>-<slug>.md`** — Markdown with YAML
  frontmatter: `date`, `user`, `branch`, `status`, `files_touched`. Body is
  a free-text summary and pending next steps.
- **Branch awareness**: no LAMD-side isolation logic. Because `.lamd/`
  files are ordinary committed files, `git checkout` naturally scopes
  which decisions/sessions are visible on a given branch. The `branch`
  field on each record is stored for display/reference only.

## 4. MCP Tools

| Tool | Input | Behavior |
| :--- | :--- | :--- |
| `lamd_search_memory` | `{ "query": "string" }` | Reads all files in `decisions/` and `sessions/` (never `rules/` — those are always fully injected already). Ranks with `rank_bm25` (BM25Okapi), applies a recency-decay multiplier, returns the top ~3-5 results truncated to fit context. |
| `lamd_save_decision` | `{ "decision", "reason", "module" }` | Fetches `git config user.name` and current branch, writes a new timestamped JSON file to `decisions/`. |
| `lamd_save_session` | `{ "summary", "next_steps", "files_touched" }` | Fetches git user/branch, writes a new Markdown+frontmatter file to `sessions/`. |

## 5. Rule Enforcement & Proactive Curation

Enforcement is prompt-engineering only for this MVP — there is no
technical hook that statically blocks non-compliant code before it's
written; Claude Code has no reliable interception point for that today.
The server injects directives instructing Claude to:

- Read `.lamd/rules/` resources before acting, and refuse (with
  explanation + compliant alternative) any request that violates them.
- Proactively ask to save a decision when an architectural consensus is
  reached.
- Proactively ask to generate a session summary when a coding task
  completes.

## 6. Error Handling

- **Missing `.lamd/`**: tools return a clear error telling the user to run
  the init command. The MCP server does not auto-create the directory —
  that's the installer's responsibility, not a runtime concern.
- **Corrupted/unreadable file** in `decisions/` or `sessions/`: skipped
  with a logged warning; does not abort the rest of the search.
- **Git unavailable or `user.name` unset**: Ask user to provide a name and 
  mention `git config user.name` is not available and suggest it must be set.

## 7. Testing

- `pytest`, with all tests building an isolated fake `.lamd/` under
  `tmp_path` — no test ever touches a real project's `.lamd/`.
- Coverage targets: decision/session file writers, BM25 ranking + recency
  decay behavior, and the project-root walk-up detection logic.

## 8. Follow-ups (out of scope for this spec)

- This repository is not yet a git repository (`git init` was previously
  deferred to the user) — needed before the "commit to git" step of any
  spec/plan workflow can run, and before `.lamd/` itself is meaningful.
- The npx installer CLI's own packaging/publish details (GitHub repo path,
  npm package name, versioning) are not yet decided — deferred until
  implementation planning.
