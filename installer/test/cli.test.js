import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
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

test("lamd init succeeds (exit 0) even when uvx is not on PATH", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  // The test sandbox never installs Python tooling, so uvx is expected to
  // be absent from PATH here already. Exercise it explicitly (rather than
  // relying on that being implicitly true) by scrubbing PATH entirely for
  // the child process. Use the absolute node executable path so clearing
  // PATH doesn't also prevent locating `node` itself.
  const output = execFileSync(process.execPath, [CLI_PATH, "init"], {
    cwd: projectRoot,
    env: { ...process.env, PATH: "", Path: "" },
  });

  assert.match(output.toString(), /Registered LAMD MCP server/);
  assert.ok(existsSync(join(projectRoot, ".mcp.json")));
});

test("lamd with an unknown command exits non-zero", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  assert.throws(() => {
    execFileSync("node", [CLI_PATH, "bogus"], { cwd: projectRoot });
  });
});

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
