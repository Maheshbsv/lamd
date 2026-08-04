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
