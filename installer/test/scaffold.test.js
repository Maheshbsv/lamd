import assert from "node:assert/strict";
import { mkdtempSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { scaffold } from "../src/scaffold.js";

test("scaffold creates the three .lamd subdirectories", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  scaffold(projectRoot);

  assert.ok(existsSync(join(projectRoot, ".lamd", "rules")));
  assert.ok(existsSync(join(projectRoot, ".lamd", "decisions")));
  assert.ok(existsSync(join(projectRoot, ".lamd", "sessions")));
});

test("scaffold writes a starter rule file", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  const { starterRulePath } = scaffold(projectRoot);

  assert.ok(existsSync(starterRulePath));
  assert.match(readFileSync(starterRulePath, "utf8"), /Framework Rules/);
});

test("scaffold does not overwrite an existing starter rule file", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));
  const { starterRulePath } = scaffold(projectRoot);
  writeFileSync(starterRulePath, "custom content", "utf8");

  scaffold(projectRoot);

  assert.equal(readFileSync(starterRulePath, "utf8"), "custom content");
});
