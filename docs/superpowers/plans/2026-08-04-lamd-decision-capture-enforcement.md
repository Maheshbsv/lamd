# LAMD Decision Capture Enforcement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Claude reliably capture architectural decisions into `.lamd/decisions/` by reusing Claude Code's built-in `CLAUDE.md` instruction mechanism and tightening the `lamd_save_decision` MCP tool description — without building new hook infrastructure.

**Architecture:** `lamd init` gains a new step that idempotently injects a sentinel-marked `Project Memory (LAMD)` block into the project's `CLAUDE.md`, following the same read-merge-write philosophy as the existing `.mcp.json`/`.claude/settings.json` merges but adapted for prose via `<!-- LAMD:BEGIN -->`/`<!-- LAMD:END -->` markers. Independently, the `lamd_save_decision` MCP tool's description is tightened so the nudge survives even if a project's `CLAUDE.md` is missing or has had the block removed.

**Tech Stack:** Node.js (ESM), built-in `node:test` runner (installer). Python 3.11+, `pytest`, `mcp` SDK (server).

## Global Constraints

- The injected block uses exactly these markers: `<!-- LAMD:BEGIN -->` and `<!-- LAMD:END -->`.
- Block body (verbatim):
  ```
  ## Project Memory (LAMD)
  When an architectural decision is finalized (a technology choice, a
  pattern change, a tradeoff with lasting consequences), call
  `lamd_save_decision` to record it before moving on.
  ```
- Merge behavior: no `CLAUDE.md` → create it with just the block. Exists, no markers → append block, preserve existing content untouched. Exists, both markers present → replace only the text between them. Exists, `BEGIN` present without a matching `END` → treat as malformed, append a fresh correctly-delimited block after existing content (do not attempt repair).
- Session-summary capture (`lamd_save_session`) is explicitly out of scope — no hook, no CLAUDE.md instruction, no change of any kind to that tool or its storage.
- No new dependencies (Node or Python) may be introduced.
- Installer tests use `node --test` (from `installer/`); server tests use `pytest tests/<file>.py -v` (from `server/`, with `.venv` already set up — no `pip install` step needed).

---

## File Structure

- **Create:** `installer/src/claudeMdConfig.js` — exports `registerDecisionInstruction(projectRoot)`, the CLAUDE.md merge logic.
- **Create:** `installer/test/claudeMdConfig.test.js` — unit tests for the merge logic in isolation.
- **Modify:** `installer/bin/lamd.js` — call `registerDecisionInstruction()` during `lamd init`, log its result.
- **Modify:** `installer/test/cli.test.js` — end-to-end assertions that `lamd init` produces the CLAUDE.md block and doesn't duplicate it on repeat runs.
- **Modify:** `README.md` — document the CLAUDE.md instruction block in the Install section.
- **Modify:** `server/src/lamd_server/mcp_app.py` — add a docstring to `lamd_save_decision` stating when to call it.
- **Modify:** `server/tests/test_mcp_registration.py` — assert the tool's registered description contains the call-to-action text.

---

### Task 1: CLAUDE.md decision-instruction merge module

**Files:**
- Create: `installer/src/claudeMdConfig.js`
- Test: `installer/test/claudeMdConfig.test.js`

**Interfaces:**
- Produces: `registerDecisionInstruction(projectRoot: string): string` — writes/merges the LAMD block into `<projectRoot>/CLAUDE.md`, returns the absolute path to `CLAUDE.md`. Consumed by Task 2's `lamd.js`.

- [ ] **Step 1: Write the failing tests**

Create `installer/test/claudeMdConfig.test.js`:

```js
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registerDecisionInstruction } from "../src/claudeMdConfig.js";

const BEGIN_MARKER = "<!-- LAMD:BEGIN -->";
const END_MARKER = "<!-- LAMD:END -->";

test("registerDecisionInstruction creates CLAUDE.md with the LAMD block when none exists", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));

  const claudeMdPath = registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.includes(BEGIN_MARKER));
  assert.ok(content.includes(END_MARKER));
  assert.ok(content.includes("lamd_save_decision"));
});

test("registerDecisionInstruction appends the block to an existing CLAUDE.md without touching prior content", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(claudeMdPath, "# My Project\n\nSome existing instructions.\n", "utf8");

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.startsWith("# My Project\n\nSome existing instructions.\n"));
  assert.ok(content.includes(BEGIN_MARKER));
});

test("registerDecisionInstruction is idempotent when re-run with unchanged content", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));

  registerDecisionInstruction(projectRoot);
  const claudeMdPath = registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  const occurrences = content.split(BEGIN_MARKER).length - 1;
  assert.equal(occurrences, 1);
});

test("registerDecisionInstruction replaces only the marked block, leaving surrounding content untouched", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(
    claudeMdPath,
    `# My Project\n\n${BEGIN_MARKER}\n## Project Memory (LAMD)\nOld outdated instruction text.\n${END_MARKER}\n\n## Other section\nKeep me.\n`,
    "utf8"
  );

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.includes("# My Project"));
  assert.ok(content.includes("## Other section\nKeep me."));
  assert.ok(!content.includes("Old outdated instruction text."));
  assert.ok(content.includes("lamd_save_decision"));
});

test("registerDecisionInstruction appends a fresh block when the LAMD markers are malformed (BEGIN with no matching END)", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(
    claudeMdPath,
    `# My Project\n\n${BEGIN_MARKER}\nHand-edited, marker never closed.\n`,
    "utf8"
  );

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  const occurrences = content.split(BEGIN_MARKER).length - 1;
  assert.equal(occurrences, 2, "expected the original malformed marker plus one freshly appended block");
  assert.ok(content.includes(END_MARKER));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `installer/`): `node --test test/claudeMdConfig.test.js`
Expected: FAIL — `Cannot find module '../src/claudeMdConfig.js'`

- [ ] **Step 3: Implement `installer/src/claudeMdConfig.js`**

```js
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BEGIN_MARKER = "<!-- LAMD:BEGIN -->";
const END_MARKER = "<!-- LAMD:END -->";

const BLOCK_BODY = `## Project Memory (LAMD)
When an architectural decision is finalized (a technology choice, a
pattern change, a tradeoff with lasting consequences), call
\`lamd_save_decision\` to record it before moving on.`;

function buildBlock() {
  return `${BEGIN_MARKER}\n${BLOCK_BODY}\n${END_MARKER}`;
}

export function registerDecisionInstruction(projectRoot) {
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  const block = buildBlock();

  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, `${block}\n`, "utf8");
    return claudeMdPath;
  }

  const content = readFileSync(claudeMdPath, "utf8");
  const beginIndex = content.indexOf(BEGIN_MARKER);
  const endIndex = content.indexOf(END_MARKER);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(claudeMdPath, `${content}${separator}${block}\n`, "utf8");
    return claudeMdPath;
  }

  const before = content.slice(0, beginIndex);
  const after = content.slice(endIndex + END_MARKER.length);
  writeFileSync(claudeMdPath, `${before}${block}${after}`, "utf8");
  return claudeMdPath;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/claudeMdConfig.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: Commit**

```bash
git add installer/src/claudeMdConfig.js installer/test/claudeMdConfig.test.js
git commit -m "feat(installer): add CLAUDE.md decision-instruction merge module"
```

---

### Task 2: Wire into `lamd init`, extend CLI tests, document in README

**Files:**
- Modify: `installer/bin/lamd.js`
- Modify: `installer/test/cli.test.js`
- Modify: `README.md`

**Interfaces:**
- Consumes: `registerDecisionInstruction(projectRoot: string): string` from Task 1 (`installer/src/claudeMdConfig.js`).

- [ ] **Step 1: Write the failing tests**

Append to `installer/test/cli.test.js` (add these two `test(...)` blocks after the existing ones; the file already imports `execFileSync`, `existsSync`, `mkdtempSync`, `readFileSync`, `join`, `tmpdir`, `test` — add nothing new to the import list):

```js
test("lamd init writes the LAMD decision instruction block into CLAUDE.md", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });

  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  assert.ok(existsSync(claudeMdPath));
  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.includes("lamd_save_decision"));
});

test("lamd init run twice does not duplicate the CLAUDE.md decision instruction block", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });
  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });

  const content = readFileSync(join(projectRoot, "CLAUDE.md"), "utf8");
  const occurrences = content.split("<!-- LAMD:BEGIN -->").length - 1;
  assert.equal(occurrences, 1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run (from `installer/`): `node --test test/cli.test.js`
Expected: FAIL — no `CLAUDE.md` is created by `lamd init` yet.

- [ ] **Step 3: Wire `registerDecisionInstruction` into `installer/bin/lamd.js`**

Modify `installer/bin/lamd.js` (full file after edit):

```js
#!/usr/bin/env node
import { execFileSync } from "node:child_process";

import { registerDecisionInstruction } from "../src/claudeMdConfig.js";
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
const claudeMdPath = registerDecisionInstruction(projectRoot);

console.log(`Created ${lamdDir}`);
console.log(`Wrote starter rule: ${starterRulePath}`);
console.log(`Wrote SessionStart hook: ${hookScriptPath}`);
console.log(`Registered LAMD MCP server in ${configPath}`);
console.log(`Registered SessionStart hook in ${settingsPath}`);
console.log(`Registered decision-capture instruction in ${claudeMdPath}`);

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

Run: `node --test test/cli.test.js`
Expected: PASS (all tests, including the two new ones)

Also re-run the full installer suite to confirm nothing else broke:

Run: `node --test`
Expected: PASS (all tests)

- [ ] **Step 5: Document the instruction block in `README.md`**

Add a paragraph to `README.md` immediately after the existing paragraph that describes the `SessionStart` hook (the paragraph ending "...no manual Python package install required."). Insert:

```markdown
`lamd init` also inserts a `Project Memory (LAMD)` block into `CLAUDE.md`
(creating the file if it doesn't exist yet, or appending to it if it does —
your existing content is never touched). This block instructs Claude to
call `lamd_save_decision` whenever an architectural decision is finalized.
It's the only reliable nudge LAMD has for decision capture today, so if you
remove it, Claude falls back to noticing the `lamd_save_decision` tool on
its own judgment rather than being reminded — treat it as load-bearing, not
decorative.
```

- [ ] **Step 6: Commit**

```bash
git add installer/bin/lamd.js installer/test/cli.test.js README.md
git commit -m "feat(installer): register CLAUDE.md decision-capture instruction during lamd init"
```

---

### Task 3: Tighten `lamd_save_decision` tool description

**Files:**
- Modify: `server/src/lamd_server/mcp_app.py`
- Modify: `server/tests/test_mcp_registration.py`

**Interfaces:**
- None — this task changes only a docstring (surfaced by the `mcp` SDK as the tool's registered description) and does not alter `lamd_save_decision`'s signature, return value, or behavior.

- [ ] **Step 1: Write the failing test**

Append to `server/tests/test_mcp_registration.py` (the file already imports `asyncio` and `mcp` — add nothing new):

```python
def test_lamd_save_decision_description_states_when_to_call_it():
    tools = asyncio.run(mcp.list_tools())
    save_decision = next(t for t in tools if t.name == "lamd_save_decision")
    assert "architectural decision is finalized" in save_decision.description
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `server/`): `pytest tests/test_mcp_registration.py -v`
Expected: FAIL — `lamd_save_decision` currently has no docstring, so `description` is `None` (or empty), and the substring check fails.

- [ ] **Step 3: Add the docstring**

Modify `server/src/lamd_server/mcp_app.py` — add a docstring to `lamd_save_decision` (the function body and signature are unchanged):

```python
@mcp.tool()
def lamd_save_decision(decision: str, reason: str, module: str) -> str:
    """Call this when an architectural decision is finalized — a technology
    choice, pattern change, or tradeoff with lasting consequences — to
    record it for future sessions."""
    root = _project_root()
    _require_lamd_dir(root)
    author, branch = _git_context(root)
    path = write_decision(root, decision, reason, module, author, branch)
    return f"Saved decision to {path.relative_to(root)}"
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pytest tests/test_mcp_registration.py -v`
Expected: PASS (3 tests: the two pre-existing plus the new one)

Also re-run the full server suite to confirm nothing else broke:

Run: `pytest -v`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add server/src/lamd_server/mcp_app.py server/tests/test_mcp_registration.py
git commit -m "feat(server): tighten lamd_save_decision tool description with a call-to-action"
```
