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
