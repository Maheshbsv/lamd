# LAMD Rules Auto-Injection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every LAMD-consuming project automatically get a `SessionStart` hook — installed by `lamd init` — that injects `.lamd/rules/*.md` into Claude Code's context at the start of every session, with no manual MCP tool call required.

**Architecture:** The hook itself is a standalone Python script (stdlib only) that reads `.lamd/rules/*.md` directly off disk and prints Claude Code's `SessionStart` hook JSON shape to stdout — no dependency on `lamd-mcp-server` being installed or running. This script ships as a template inside the `installer/` package (`installer/templates/lamd_inject_rules.py`) and is copied into the consuming project's `.claude/hooks/` directory by `scaffold()`, alongside the existing `.lamd/` scaffolding. A new `installer/src/hookConfig.js` module merges a `SessionStart` entry into the consuming project's `.claude/settings.json`, the same way `mcpConfig.js` already merges an entry into `.mcp.json`. `bin/lamd.js` wires both into the existing `lamd init` flow.

**Tech Stack:** Python 3.13 stdlib only (`pathlib`, `json`, `sys`) for the hook script. Node.js (ESM), built-in `node:test` runner for the installer — matches the existing `installer/` code exactly, no new dependencies.

## Global Constraints

- The hook script has no dependency on `lamd-mcp-server` or any third-party package — stdlib only (`pathlib`, `json`, `sys`).
- `.lamd/rules/` missing or empty → hook script exits 0, output JSON omits the `additionalContext` key entirely (silent no-op).
- An individual rule file that fails to read (permissions, bad encoding) is skipped; processing continues for the rest; the skip is noted on stderr, never in the injected `additionalContext`.
- The hook script must not exit non-zero on the normal empty/missing-directory case — only on a genuine bug (per spec's stated concern that a `SessionStart` hook failure should not block a session from starting).
- Rule files are read in filename sort order (numeric-prefixed filenames like `01-framework.md` sort predictably), each concatenated under a `## <filename>` header.
- Installer changes must not clobber existing, unrelated content: `registerSessionStartHook` must preserve other `.claude/settings.json` keys and other hook events, exactly as `registerMcpServer` already does for `.mcp.json` (see `installer/test/mcpConfig.test.js:25`).
- `lamd init` must remain idempotent: running it twice must not duplicate the `SessionStart` hook entry in `.claude/settings.json`, and must not stop `scaffold()` from being safe to re-run (existing behavior for the starter rule file — never overwritten — must be preserved).
- The hook script file itself (`.claude/hooks/lamd_inject_rules.py`) is LAMD-owned generated code, not user content — unlike the starter rule file, it should be overwritten on every `lamd init` run so re-running init picks up the latest version of the script.

---

## File Structure

```
installer/
  templates/
    lamd_inject_rules.py       # NEW — the SessionStart hook script, copied verbatim into consumer projects
  src/
    scaffold.js                  # MODIFIED — also copies templates/lamd_inject_rules.py into .claude/hooks/
    hookConfig.js                # NEW — merges SessionStart hook entry into .claude/settings.json
  bin/
    lamd.js                      # MODIFIED — calls registerSessionStartHook, logs its output
  test/
    lamd_inject_rules.test.js    # NEW — exercises the Python hook script via subprocess
    hookConfig.test.js           # NEW — mirrors mcpConfig.test.js
    scaffold.test.js             # MODIFIED — asserts hook script is copied and overwritten
    cli.test.js                  # MODIFIED — asserts end-to-end .claude/hooks + .claude/settings.json output

README.md                        # MODIFIED — documents the SessionStart hook installation
```

---

### Task 1: The `SessionStart` hook script

**Files:**
- Create: `installer/templates/lamd_inject_rules.py`
- Test: `installer/test/lamd_inject_rules.test.js`

**Interfaces:**
- Produces: a standalone Python script, invoked as `python installer/templates/lamd_inject_rules.py` with the process's current working directory treated as the project root (i.e. it reads `Path.cwd() / ".lamd" / "rules"`). No CLI arguments. Prints a single JSON object to stdout matching Claude Code's `SessionStart` hook output shape:
  ```json
  {"hookSpecificOutput": {"hookEventName": "SessionStart", "additionalContext": "..."}}
  ```
  or, when there is no rule content to inject:
  ```json
  {}
  ```
  Exits 0 in both cases.

- [ ] **Step 1: Write the failing tests**

Create `installer/test/lamd_inject_rules.test.js`:

```js
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(__dirname, "..", "templates", "lamd_inject_rules.py");

function runHook(projectRoot) {
  const output = execFileSync("python", [SCRIPT_PATH], { cwd: projectRoot });
  return JSON.parse(output.toString());
}

test("missing .lamd/rules directory produces no additionalContext, exits 0", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hook-"));

  const result = runHook(projectRoot);

  assert.equal(result.hookSpecificOutput, undefined);
});

test("empty .lamd/rules directory produces no additionalContext, exits 0", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hook-"));
  mkdirSync(join(projectRoot, ".lamd", "rules"), { recursive: true });

  const result = runHook(projectRoot);

  assert.equal(result.hookSpecificOutput, undefined);
});

test("injects rule file content under a filename header", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hook-"));
  const rulesDir = join(projectRoot, ".lamd", "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "01-framework.md"), "Use Angular JS and SQLite.", "utf8");

  const result = runHook(projectRoot);

  const context = result.hookSpecificOutput.additionalContext;
  assert.match(context, /## 01-framework\.md/);
  assert.match(context, /Use Angular JS and SQLite\./);
  assert.equal(result.hookSpecificOutput.hookEventName, "SessionStart");
});

test("concatenates multiple rule files in filename sort order", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hook-"));
  const rulesDir = join(projectRoot, ".lamd", "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "02-style.md"), "Second rule.", "utf8");
  writeFileSync(join(rulesDir, "01-framework.md"), "First rule.", "utf8");

  const result = runHook(projectRoot);

  const context = result.hookSpecificOutput.additionalContext;
  assert.ok(
    context.indexOf("01-framework.md") < context.indexOf("02-style.md"),
    "01-framework.md must appear before 02-style.md"
  );
});

test("skips an unreadable rule file and still injects the readable ones", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hook-"));
  const rulesDir = join(projectRoot, ".lamd", "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "01-good.md"), "Good rule.", "utf8");
  // Invalid UTF-8 byte sequence — triggers a decode error when the script reads it as text.
  writeFileSync(join(rulesDir, "02-bad.md"), Buffer.from([0xff, 0xfe, 0x00, 0xff]));

  const output = execFileSync("python", [SCRIPT_PATH], { cwd: projectRoot });
  const result = JSON.parse(output.toString());

  assert.match(result.hookSpecificOutput.additionalContext, /Good rule\./);
  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /02-bad/);
});

test("ignores non-.md files in the rules directory", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hook-"));
  const rulesDir = join(projectRoot, ".lamd", "rules");
  mkdirSync(rulesDir, { recursive: true });
  writeFileSync(join(rulesDir, "01-framework.md"), "Rule content.", "utf8");
  writeFileSync(join(rulesDir, "notes.txt"), "Not a rule.", "utf8");

  const result = runHook(projectRoot);

  assert.doesNotMatch(result.hookSpecificOutput.additionalContext, /Not a rule\./);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd installer && node --test test/lamd_inject_rules.test.js`
Expected: FAIL — `installer/templates/lamd_inject_rules.py` does not exist yet (ENOENT).

- [ ] **Step 3: Write the hook script**

Create `installer/templates/lamd_inject_rules.py`:

```python
"""Claude Code SessionStart hook: injects .lamd/rules/*.md into context."""
import json
import sys
from pathlib import Path


def load_rules(rules_dir: Path) -> str:
    sections = []
    for md_file in sorted(rules_dir.glob("*.md")):
        try:
            content = md_file.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            print(f"lamd_inject_rules: skipping {md_file.name}: {exc}", file=sys.stderr)
            continue
        sections.append(f"## {md_file.name}\n\n{content}")
    return "\n\n".join(sections)


def main() -> None:
    rules_dir = Path.cwd() / ".lamd" / "rules"

    if not rules_dir.is_dir():
        print(json.dumps({}))
        return

    combined = load_rules(rules_dir)

    if not combined:
        print(json.dumps({}))
        return

    output = {
        "hookSpecificOutput": {
            "hookEventName": "SessionStart",
            "additionalContext": combined,
        }
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd installer && node --test test/lamd_inject_rules.test.js`
Expected: PASS (all 6 tests)

- [ ] **Step 5: Manual unit-level check (spec's acceptance step 1)**

Run: `cd installer/templates && python lamd_inject_rules.py`
(from a directory with no `.lamd/`) Expected stdout: `{}`

- [ ] **Step 6: Commit**

```bash
git add installer/templates/lamd_inject_rules.py installer/test/lamd_inject_rules.test.js
git commit -m "feat(installer): add SessionStart hook script for rules auto-injection"
```

---

### Task 2: `hookConfig.js` — merge the `SessionStart` hook into `.claude/settings.json`

**Files:**
- Create: `installer/src/hookConfig.js`
- Test: `installer/test/hookConfig.test.js`

**Interfaces:**
- Consumes: nothing from Task 1 directly (the command string it writes references a fixed relative path, `.claude/hooks/lamd_inject_rules.py`, that Task 3 will ensure exists).
- Produces: `registerSessionStartHook(projectRoot: string): string` in `installer/src/hookConfig.js`, exported the same way `registerMcpServer` is exported from `mcpConfig.js`. Returns the absolute path to `.claude/settings.json`. Merges (does not replace) `.claude/settings.json`: adds a `hooks.SessionStart` array entry that runs `python "$CLAUDE_PROJECT_DIR/.claude/hooks/lamd_inject_rules.py"`, without touching other keys in the file, without touching other `SessionStart` entries the user may already have, and without duplicating the LAMD entry on repeat calls.

- [ ] **Step 1: Write the failing tests**

Create `installer/test/hookConfig.test.js`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registerSessionStartHook } from "../src/hookConfig.js";

const LAMD_COMMAND = 'python "$CLAUDE_PROJECT_DIR/.claude/hooks/lamd_inject_rules.py"';

test("registerSessionStartHook creates .claude/settings.json with a SessionStart entry when none exists", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hookcfg-"));

  const settingsPath = registerSessionStartHook(projectRoot);

  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].command, LAMD_COMMAND);
  assert.equal(settings.hooks.SessionStart[0].hooks[0].type, "command");
});

test("registerSessionStartHook merges into an existing .claude/settings.json without dropping other keys", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hookcfg-"));
  mkdirSync(join(projectRoot, ".claude"), { recursive: true });
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify({ permissions: { allow: ["WebSearch"] } }),
    "utf8"
  );

  registerSessionStartHook(projectRoot);

  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.deepEqual(settings.permissions, { allow: ["WebSearch"] });
  assert.equal(settings.hooks.SessionStart.length, 1);
});

test("registerSessionStartHook preserves an existing unrelated SessionStart hook entry", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hookcfg-"));
  mkdirSync(join(projectRoot, ".claude"), { recursive: true });
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  writeFileSync(
    settingsPath,
    JSON.stringify({
      hooks: {
        SessionStart: [
          { matcher: "", hooks: [{ type: "command", command: "echo other-hook" }] },
        ],
      },
    }),
    "utf8"
  );

  registerSessionStartHook(projectRoot);

  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.hooks.SessionStart.length, 2);
  const commands = settings.hooks.SessionStart.flatMap((e) => e.hooks.map((h) => h.command));
  assert.ok(commands.includes("echo other-hook"));
  assert.ok(commands.includes(LAMD_COMMAND));
});

test("registerSessionStartHook is idempotent", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hookcfg-"));

  registerSessionStartHook(projectRoot);
  const settingsPath = registerSessionStartHook(projectRoot);

  const settings = JSON.parse(readFileSync(settingsPath, "utf8"));
  assert.equal(settings.hooks.SessionStart.length, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd installer && node --test test/hookConfig.test.js`
Expected: FAIL — `../src/hookConfig.js` does not exist (ENOENT / module not found).

- [ ] **Step 3: Write `hookConfig.js`**

Create `installer/src/hookConfig.js`:

```js
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LAMD_HOOK_COMMAND =
  'python "$CLAUDE_PROJECT_DIR/.claude/hooks/lamd_inject_rules.py"';

export function registerSessionStartHook(projectRoot) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8"))
    : {};

  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];

  const alreadyRegistered = settings.hooks.SessionStart.some((entry) =>
    (entry.hooks || []).some((hook) => hook.command === LAMD_HOOK_COMMAND)
  );

  if (!alreadyRegistered) {
    settings.hooks.SessionStart.push({
      matcher: "",
      hooks: [{ type: "command", command: LAMD_HOOK_COMMAND }],
    });
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settingsPath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd installer && node --test test/hookConfig.test.js`
Expected: PASS (all 4 tests)

- [ ] **Step 5: Commit**

```bash
git add installer/src/hookConfig.js installer/test/hookConfig.test.js
git commit -m "feat(installer): merge SessionStart hook entry into .claude/settings.json"
```

---

### Task 3: Copy the hook script into the consumer project via `scaffold()`

**Files:**
- Modify: `installer/src/scaffold.js`
- Modify: `installer/test/scaffold.test.js`

**Interfaces:**
- Consumes: `installer/templates/lamd_inject_rules.py` from Task 1 (read via a path relative to `scaffold.js`'s own module location, using `import.meta.url`).
- Produces: `scaffold(projectRoot: string)` now returns `{ lamdDir, starterRulePath, hookScriptPath }` — adds `hookScriptPath` (absolute path to `<projectRoot>/.claude/hooks/lamd_inject_rules.py`) to the existing return shape. `hookScriptPath` content is **always overwritten** on each call (unlike `starterRulePath`, which is only written if absent).

- [ ] **Step 1: Write the failing tests**

Add to `installer/test/scaffold.test.js` (after the existing tests, keep existing imports and extend them):

```js
import { readFileSync as _unused } from "node:fs"; // already imported above; keep single import line — see note
```

Note: don't add a duplicate import — instead extend the existing `import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";` at the top of the file if any names are missing (all four are already imported by the current file). Then append these tests:

```js
test("scaffold copies the SessionStart hook script into .claude/hooks/", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  const { hookScriptPath } = scaffold(projectRoot);

  assert.ok(existsSync(hookScriptPath));
  assert.match(readFileSync(hookScriptPath, "utf8"), /hookEventName/);
});

test("scaffold overwrites the hook script on repeat runs", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));
  const { hookScriptPath } = scaffold(projectRoot);
  writeFileSync(hookScriptPath, "stale content", "utf8");

  scaffold(projectRoot);

  assert.notEqual(readFileSync(hookScriptPath, "utf8"), "stale content");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd installer && node --test test/scaffold.test.js`
Expected: FAIL — `hookScriptPath` is `undefined`, `existsSync(undefined)` throws or returns false.

- [ ] **Step 3: Update `scaffold.js`**

Replace the full contents of `installer/src/scaffold.js`:

```js
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_TEMPLATE_PATH = join(__dirname, "..", "templates", "lamd_inject_rules.py");

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

  const hooksDir = join(projectRoot, ".claude", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookScriptPath = join(hooksDir, "lamd_inject_rules.py");
  writeFileSync(hookScriptPath, readFileSync(HOOK_TEMPLATE_PATH, "utf8"), "utf8");

  return { lamdDir, starterRulePath, hookScriptPath };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd installer && node --test test/scaffold.test.js`
Expected: PASS (all 5 tests — 3 existing + 2 new)

- [ ] **Step 5: Commit**

```bash
git add installer/src/scaffold.js installer/test/scaffold.test.js
git commit -m "feat(installer): copy SessionStart hook script during scaffold"
```

---

### Task 4: Wire `hookConfig` into `lamd init`

**Files:**
- Modify: `installer/bin/lamd.js`
- Modify: `installer/test/cli.test.js`

**Interfaces:**
- Consumes: `registerSessionStartHook` from `../src/hookConfig.js` (Task 2), `scaffold`'s new `hookScriptPath` field (Task 3).
- Produces: `lamd init` now additionally creates `.claude/hooks/lamd_inject_rules.py` and registers the hook in `.claude/settings.json`, logging both to stdout.

- [ ] **Step 1: Write the failing tests**

Add to `installer/test/cli.test.js` (after the existing tests, same imports apply):

```js
test("lamd init scaffolds the SessionStart hook and registers it in .claude/settings.json", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });

  assert.ok(existsSync(join(projectRoot, ".claude", "hooks", "lamd_inject_rules.py")));
  assert.ok(existsSync(join(projectRoot, ".claude", "settings.json")));
});

test("lamd init run twice does not duplicate the SessionStart hook entry", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });
  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });

  const settings = JSON.parse(
    readFileSync(join(projectRoot, ".claude", "settings.json"), "utf8")
  );
  assert.equal(settings.hooks.SessionStart.length, 1);
});
```

This requires `readFileSync` to be imported in `cli.test.js` — add it to the existing `node:fs` import line (`import { existsSync, mkdtempSync, readFileSync } from "node:fs";`).

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd installer && node --test test/cli.test.js`
Expected: FAIL — `.claude/hooks/lamd_inject_rules.py` and `.claude/settings.json` don't exist yet (the CLI doesn't call the new functions).

- [ ] **Step 3: Update `bin/lamd.js`**

Replace the full contents of `installer/bin/lamd.js`:

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { registerSessionStartHook } from "../src/hookConfig.js";
import { registerMcpServer } from "../src/mcpConfig.js";
import { scaffold } from "../src/scaffold.js";

const [, , command] = process.argv;

if (command !== "init") {
  console.error(`Unknown command: ${command ?? "(none)"}. Usage: lamd init`);
  process.exit(1);
}

const projectRoot = process.cwd();
const { lamdDir, starterRulePath, hookScriptPath } = scaffold(projectRoot);
const configPath = registerMcpServer(projectRoot);
const settingsPath = registerSessionStartHook(projectRoot);

console.log(`Created ${lamdDir}`);
console.log(`Wrote starter rule: ${starterRulePath}`);
console.log(`Wrote SessionStart hook: ${hookScriptPath}`);
console.log(`Registered LAMD MCP server in ${configPath}`);
console.log(`Registered SessionStart hook in ${settingsPath}`);

try {
  execFileSync("uvx", ["--version"], { stdio: "ignore" });
} catch {
  console.warn(
    "Warning: `uvx` was not found on PATH. The LAMD MCP server is launched " +
      "via uvx, so install uv before using it: " +
      "https://docs.astral.sh/uv/getting-started/installation/"
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd installer && node --test`
Expected: PASS — full installer suite (all files), no regressions in existing tests.

- [ ] **Step 5: Commit**

```bash
git add installer/bin/lamd.js installer/test/cli.test.js
git commit -m "feat(installer): register SessionStart hook during lamd init"
```

---

### Task 5: Update README

**Files:**
- Modify: `README.md`

**Interfaces:** None — documentation only.

- [ ] **Step 1: Update the Install section**

In `README.md`, replace the existing "This scaffolds a `.lamd/` directory..." paragraph with:

```markdown
This scaffolds a `.lamd/` directory (`rules/`, `decisions/`, `sessions/`)
with a starter rule file, registers the LAMD MCP server in `.mcp.json` so
compatible agent clients (e.g. Claude Code) can load it automatically, and
installs a `SessionStart` hook (`.claude/hooks/lamd_inject_rules.py`,
registered in `.claude/settings.json`) that injects the contents of
`.lamd/rules/*.md` into every session's context automatically — no manual
tool call required. The MCP server itself runs via `uvx` — no manual
Python package install required.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document SessionStart hook auto-installed by lamd init"
```

---

### Task 6: End-to-end acceptance check

**Files:** None modified — verification only.

- [ ] **Step 1: Run the full installer test suite**

Run: `cd installer && node --test`
Expected: PASS, all files, no failures.

- [ ] **Step 2: Manual acceptance test (spec's acceptance step 3)**

```bash
cd $(mktemp -d)
node <path-to-mbskill>/installer/bin/lamd.js init
cat .claude/hooks/lamd_inject_rules.py    # confirm it matches the template
cat .claude/settings.json                  # confirm the SessionStart entry is present
python .claude/hooks/lamd_inject_rules.py  # confirm it prints the starter rule wrapped in additionalContext
```

Expected: the last command's stdout is valid JSON containing `hookSpecificOutput.additionalContext` with the `01-framework.md` starter rule content under a `## 01-framework.md` header.

- [ ] **Step 3: Confirm hook-failure behavior (spec's open verification item)**

The spec flags this as unresolved: *"confirm Claude Code's actual behavior when a `SessionStart` hook exits non-zero or emits malformed JSON."* This plan's hook script is written defensively (catches per-file read errors, never exits non-zero on the empty/missing-directory case), so the question doesn't block shipping — but it's still open for whoever next touches this hook. Leave a note in the spec or a follow-up task if you investigate it; don't silently drop it.

No commit for this task — it's a verification checkpoint.

---

## Self-Review Notes

- **Spec coverage:** `.claude/hooks/lamd_inject_rules.py` (Task 1) ✓; `.claude/settings.json` `SessionStart` registration (Task 2, wired in Task 4) ✓; stdlib-only constraint ✓ (Task 1); glob + sort + `## <filename>` header concatenation ✓ (Task 1); empty/missing directory → exit 0, no `additionalContext` key ✓ (Task 1); per-file read failure → skip + stderr note, continue ✓ (Task 1); non-zero exit reserved for genuine bugs ✓ (Task 1, no blanket try/except); unit-level test (spec step 1) ✓ (Task 6); empty-state test (spec step 2) ✓ (Task 1 tests + Task 6); acceptance test (spec step 3) ✓ (Task 6); porting into the LAMD repo as installer scaffolding (spec's explicit future-work item) ✓ (Tasks 3–4, per the scope decision confirmed with the user).
- **Non-goals respected:** no `.lamd/decisions/` or `.lamd/sessions/` injection added; no changes to `server/` (the MCP server package) — everything lives in `installer/`.
- **Type/interface consistency:** `scaffold()`'s return shape (`{ lamdDir, starterRulePath, hookScriptPath }`) matches what Task 4's `bin/lamd.js` destructures. `registerSessionStartHook(projectRoot)` signature matches `registerMcpServer(projectRoot)`'s existing shape (single `projectRoot` string arg, returns the config path) for consistency across the installer's two "register X" functions.
