# LAMD Rules Auto-Injection — Design

Date: 2026-08-04
Status: Approved (Part A of a two-part fix; Part B — auto-capture of decisions/sessions — is a separate follow-up increment, out of scope here)

## Problem

LAMD (the memory/context framework at `.mcp.json` → `lamd` MCP server) currently exposes rules and memory only as pull-based MCP tools/resources (`lamd://rules`, `lamd_save_decision`, `lamd_save_session`, `lamd_search_memory`). Nothing in this project automatically surfaces `.lamd/rules/*.md` into a session's context — a rules-relevant question only gets a rules-aware answer if the model happens to call the MCP resource itself. This defeats the purpose of having project rules at all: they should be there by default, not by luck.

This design addresses only the injection half of the gap (Part A). Part B — nudging the model to proactively call `lamd_save_decision`/`lamd_save_session` — is deliberately deferred to its own design/plan cycle.

## Goal

Rules defined in `.lamd/rules/*.md` are automatically present in context at the start of every Claude Code session in this project, with no manual tool call required.

## Non-goals

- Auto-capture of decisions or session summaries (Part B, separate spec).
- Injecting memory from `.lamd/decisions/` or `.lamd/sessions/` (deferred per the "rules only" scoping decision — kept lean to avoid unbounded context growth as the log fills up).
- Changes to the `lamd` MCP server itself. This fix is prototyped entirely in this consuming project (`lamd-test`), with porting into the LAMD repo as a future step once proven.

## Architecture

A `SessionStart` hook, registered in `.claude/settings.json`, runs a small Python script at the start of every session. The script reads `.lamd/rules/*.md` directly off disk — bypassing the MCP server entirely — and emits their content as `additionalContext` in the hook's JSON output, which Claude Code injects into context automatically.

Direct file read (rather than shelling out through the `lamd-mcp-server`) was chosen so injection has no dependency on the MCP server being installed, running, or reachable — it's just reading markdown files that already exist on disk.

## Components

1. **`.claude/hooks/lamd_inject_rules.py`**
   Standalone script, Python stdlib only (`pathlib`, `json`, `sys`). No dependency on `lamd-mcp-server` or any third-party package.

2. **`.claude/settings.json`**
   Add a `SessionStart` hook entry invoking the script above.

## Data flow

1. Session starts.
2. Claude Code invokes the `SessionStart` hook.
3. Script globs `.lamd/rules/*.md`, sorted by filename (numeric-prefixed filenames like `01-framework.md` sort predictably).
4. For each file, content is concatenated under a `## <filename>` header.
5. The combined text is wrapped in the hook's expected JSON shape (`hookSpecificOutput.additionalContext`) and printed to stdout.
6. Claude Code surfaces the returned `additionalContext` as injected context for the session, the same mechanism used for other SessionStart-injected content.

## Error handling

- `.lamd/rules/` missing or empty → script exits 0, omits the `additionalContext` key entirely. Silent no-op; session starts normally with no rules content.
- An individual rule file fails to read (permissions, bad encoding) → skip that file, continue processing the rest; note the skip on stderr so it's visible in hook debug logs without polluting injected context.
- The script must not exit non-zero on the normal empty/missing-directory case — only on a genuine bug — since a `SessionStart` hook failure should not be allowed to block a session from starting.
- Open verification item: confirm Claude Code's actual behavior when a `SessionStart` hook exits non-zero or emits malformed JSON (does it block startup, warn, or silently ignore?). Verify this during implementation before relying on "hook failure is safely non-blocking" as a guarantee.

## Testing plan

1. **Unit-level**: run `python .claude/hooks/lamd_inject_rules.py` directly from the repo root; confirm the JSON output contains `01-framework.md`'s content, correctly formatted under its header.
2. **Empty-state**: temporarily rename `.lamd/rules/` (or point the script at an empty temp dir) and confirm the script exits 0 with no `additionalContext` key — no crash, no malformed output.
3. **Acceptance test**: start a fresh Claude Code session in `lamd-test` and ask a framework-related question ("what stack should I use here?") without mentioning LAMD or calling any lamd tool. Confirm the answer reflects the Angular JS / SQLite / Python rules from `01-framework.md` purely from automatic injection — this is the exact gap identified earlier in this project and is the acceptance bar for calling Part A done.

## Future work (explicitly out of scope here)

- Part B: skill-based nudges so the model proactively calls `lamd_save_decision` after architectural choices and `lamd_save_session` at natural session wrap-up points (chosen over a hard Stop-hook gate, to avoid end-of-session friction).
- Porting this hook + skill pattern from `lamd-test`'s local `.claude/` directory into the `lamd` repo itself (e.g. as an init template or installer step), so any project adopting LAMD gets both parts by default rather than needing to hand-roll them per project.
