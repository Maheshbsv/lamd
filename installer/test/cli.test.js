import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = join(__dirname, "..", "bin", "lamd.js");

test("lamd init scaffolds .lamd/ and writes .mcp.json", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  execFileSync("node", [CLI_PATH, "init"], { cwd: projectRoot });

  assert.ok(existsSync(join(projectRoot, ".lamd", "rules", "01-framework.md")));
  assert.ok(existsSync(join(projectRoot, ".mcp.json")));
});

test("lamd with an unknown command exits non-zero", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  assert.throws(() => {
    execFileSync("node", [CLI_PATH, "bogus"], { cwd: projectRoot });
  });
});
