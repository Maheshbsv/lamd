import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registerMcpServer } from "../src/mcpConfig.js";

test("registerMcpServer creates .mcp.json with the lamd entry when none exists", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));

  const configPath = registerMcpServer(projectRoot);

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.lamd, {
    command: "uvx",
    args: [
      "--from",
      "git+https://github.com/Maheshbsv/lamd.git#subdirectory=server",
      "lamd-mcp-server",
    ],
  });
});

test("registerMcpServer merges into an existing .mcp.json without dropping other servers", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-test-"));
  const configPath = join(projectRoot, ".mcp.json");
  writeFileSync(
    configPath,
    JSON.stringify({ mcpServers: { other: { command: "other-cmd" } } }),
    "utf8"
  );

  registerMcpServer(projectRoot);

  const config = JSON.parse(readFileSync(configPath, "utf8"));
  assert.deepEqual(config.mcpServers.other, { command: "other-cmd" });
  assert.ok(config.mcpServers.lamd);
});
