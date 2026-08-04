import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registerSessionStartHook } from "../src/hookConfig.js";

const LAMD_COMMAND =
  'uv run --no-project python "$CLAUDE_PROJECT_DIR/.claude/hooks/lamd_inject_rules.py"';

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

test("registerSessionStartHook throws a clear, actionable error on malformed settings.json", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-hookcfg-"));
  mkdirSync(join(projectRoot, ".claude"), { recursive: true });
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  writeFileSync(settingsPath, "{ this is not valid json,, }", "utf8");

  assert.throws(
    () => registerSessionStartHook(projectRoot),
    (err) => err instanceof Error && err.message.includes(settingsPath)
  );
});
