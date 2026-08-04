# Design: LAMD Decision Capture Enforcement

## Problem

LAMD's PRD and architecture docs describe a "proactive technical lead" that
prompts users to record architectural decisions as they happen
(`docs/lamd/prd.md` §3.4, `docs/lamd/architecture.md` §4). In the current
implementation, `lamd_save_decision` is a passive MCP tool
(`server/src/lamd_server/mcp_app.py`) — Claude has to voluntarily decide to
call it. Nothing in the shipped code nudges, reminds, or enforces this.
Compared to the `SessionStart` rules hook (which auto-injects `.lamd/rules/*.md`
without depending on model behavior), decision capture is the weakest link in
the memory system: exactly the kind of thing LAMD exists to make reliable.

This design closes that gap for **decisions only**. Session-summary capture
was considered and explicitly dropped (see Non-Goals) — it stays exactly as
it is today, an on-demand `lamd_save_session` tool with no enforcement.

## Goals

- Make Claude substantially more likely to call `lamd_save_decision` when an
  architectural decision is finalized, without a hard-blocking gate.
- Reuse Claude Code's built-in "always-loaded instructions" mechanism
  (`CLAUDE.md`) rather than building new hook infrastructure.
- Preserve any content a project's `CLAUDE.md` already has — LAMD must never
  clobber user-authored instructions.
- Make the instruction re-applicable: running `lamd init` again after a LAMD
  version bump should update LAMD's own instruction text without touching
  anything else in the file.
- Document the mechanism in `README.md` so anyone using this repo understands
  the instruction block is load-bearing, not decorative.

## Non-Goals

- **Session-summary enforcement.** A `Stop`-hook-based nudge for
  `lamd_save_session` was designed in detail during brainstorming (transcript
  scanning, edit-vs-save ordering, `stop_hook_active` re-entry guard) and then
  deliberately cut: the ROI was judged uncertain relative to the engineering
  and per-turn hook cost, and a matching CLAUDE.md-only advisory instruction
  was also rejected as under-specified ("major/substantial edits" is not a
  checkable condition) and inconsistent with treating decisions and sessions
  as equally load-bearing. `lamd_save_session` remains exactly as it is today.
  Revisiting session capture, if ever, is a separate future design with its
  own trigger condition — not a footnote on this one.
- **Hard-gating decision capture** (e.g. a `PreToolUse` block on further edits
  until a decision is saved). Rejected as too coarse and prone to false
  positives; a soft instruction is the right strength for this gap.
- Any change to `.lamd/decisions/` storage format, `lamd_search_memory`, or
  the `SessionStart` rules hook — all out of scope, unchanged by this design.

## Architecture

Three independent, loosely-coupled additions to the existing installer and
MCP server. None touch decision storage format or existing hooks.

1. **CLAUDE.md decision instruction** — a new installer module that
   idempotently injects a sentinel-marked instruction block into the
   project's `CLAUDE.md`, telling Claude to call `lamd_save_decision` when an
   architectural decision is finalized.
2. **Tightened MCP tool description** — the `lamd_save_decision` tool's
   description in `mcp_app.py` is edited to explicitly state when to call it,
   independent of whether `CLAUDE.md` is present, current, or has been
   edited/removed by a user.
3. **README documentation** — a short addition to the existing Install
   section explaining the CLAUDE.md block's purpose and that removing it
   removes LAMD's only reliable nudge for decision capture.

## Component 1: CLAUDE.md Decision Instruction

New module `installer/src/claudeMdConfig.js`, exporting a function (e.g.
`registerDecisionInstruction(projectRoot)`) called from `installer/bin/lamd.js`
alongside the existing `scaffold()`, `registerMcpServer()`, and
`registerSessionStartHook()` calls.

**Injected block:**

```markdown
<!-- LAMD:BEGIN -->
## Project Memory (LAMD)
When an architectural decision is finalized (a technology choice, a
pattern change, a tradeoff with lasting consequences), call
`lamd_save_decision` to record it before moving on.
<!-- LAMD:END -->
```

**Merge logic** (read-merge-write, mirroring `hookConfig.js`'s pattern for
`.claude/settings.json`, adapted for plain text instead of JSON):

- `CLAUDE.md` does not exist → create it containing just the block.
- `CLAUDE.md` exists, no `<!-- LAMD:BEGIN -->` marker present → append the
  block to the end of the file, preserving all existing content unchanged.
- `CLAUDE.md` exists, both markers present → replace only the text between
  them with the current block content, leaving everything outside the
  markers untouched. This makes `lamd init` re-runs update LAMD's own
  instruction wording across version bumps without disturbing user content.
- `CLAUDE.md` exists with `<!-- LAMD:BEGIN -->` but no matching
  `<!-- LAMD:END -->` (corrupted/hand-edited) → treat as unmarked: append a
  fresh, correctly-delimited block after the existing content rather than
  guessing at intent or attempting a partial repair.

## Component 2: Tightened MCP Tool Description

Small, surgical edit to `lamd_save_decision`'s tool description in
`server/src/lamd_server/mcp_app.py`: state explicitly when to call it (e.g.
"Call this when an architectural decision is finalized — a technology
choice, pattern change, or tradeoff with lasting consequences — to record it
for future sessions"), rather than a bare parameter-only description.

This is deliberately redundant with Component 1: a session where `CLAUDE.md`
is missing, stale, or has had the LAMD block manually removed still sees the
nudge, because MCP clients surface tool descriptions to the model
independently of any project instruction file. No behavior change to the
tool's logic or signature.

## Component 3: README Documentation

Add a short paragraph to `README.md`'s existing Install section, next to the
current `SessionStart` hook description, stating that `lamd init` also
inserts a `Project Memory (LAMD)` block into `CLAUDE.md`, and that this
instruction is load-bearing: removing it leaves Claude with no built-in
nudge to record decisions, falling back entirely to the tool description's
weaker, session-instruction-independent nudge.

## Data Flow

`lamd init` runtime sequence (unchanged steps omitted):

1. `scaffold()` creates `.lamd/` structure (existing, unchanged).
2. `registerMcpServer()` merges `.mcp.json` (existing, unchanged).
3. `registerSessionStartHook()` merges `.claude/settings.json` (existing,
   unchanged).
4. **New:** `registerDecisionInstruction()` reads `CLAUDE.md` if present,
   applies the merge logic above, writes the result.
5. CLI logs the outcome (created / appended / updated / no-op) alongside the
   existing log lines for the other three steps.

No runtime hook is added — this is entirely installer-time (`lamd init`) and
MCP-server-description work. There is no new behavior during a Claude Code
session beyond what the model reads from `CLAUDE.md` and the tool schema, both
of which already exist as Claude Code / MCP mechanisms.

## Error Handling

- `CLAUDE.md` read/write failures (permissions, disk) propagate as thrown
  errors from `registerDecisionInstruction()`, consistent with
  `registerSessionStartHook()`'s existing behavior of surfacing filesystem
  errors to the CLI rather than swallowing them.
- Malformed marker pairs (Component 1's fourth case) are handled by
  appending a fresh block rather than throwing — corrupted LAMD markers
  should not block `lamd init` from completing the rest of scaffolding.

## Testing

**`installer/test/claudeMdConfig.test.js`** (new), mirroring
`hookConfig.test.js`'s structure:

- No `CLAUDE.md` → file created with exactly the block.
- `CLAUDE.md` exists, no marker → block appended, original content
  byte-identical before the appended block.
- `CLAUDE.md` exists, markers present, re-run with identical block content →
  idempotent, no duplication, file unchanged.
- `CLAUDE.md` exists, markers present with different (older) block content →
  content between markers replaced, content outside markers untouched.
- `CLAUDE.md` exists with `<!-- LAMD:BEGIN -->` and no matching
  `<!-- LAMD:END -->` → fresh block appended after existing content.

**`installer/test/cli.test.js`** (extended): an end-to-end case asserting
`lamd init` produces a `CLAUDE.md` containing the block, alongside the
existing scaffold/mcp-config/hook assertions; a repeat-`lamd init` case
confirming no duplication.

**MCP server:** no new test required beyond confirming existing server tests
(if any cover tool registration) still pass — the change is a description
string, not logic.

## Rollout

This scaffolds into **new** `lamd init` runs only, same as the
`SessionStart` hook. Existing projects that already ran `lamd init` before
this change get the CLAUDE.md block (and updated tool description) the next
time they run `lamd init` again — there is no automatic re-scaffolding of
already-initialized projects, consistent with how the `SessionStart` hook
rollout worked.
