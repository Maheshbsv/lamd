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
const { path: claudeMdPath, action: claudeMdAction } = registerDecisionInstruction(projectRoot);

const CLAUDE_MD_ACTION_LABEL = {
  created: "Created decision-capture instruction in",
  appended: "Appended decision-capture instruction to",
  updated: "Updated decision-capture instruction in",
  unchanged: "Decision-capture instruction already up to date in",
};

console.log(`Created ${lamdDir}`);
console.log(`Wrote starter rule: ${starterRulePath}`);
console.log(`Wrote SessionStart hook: ${hookScriptPath}`);
console.log(`Registered LAMD MCP server in ${configPath}`);
console.log(`Registered SessionStart hook in ${settingsPath}`);
console.log(`${CLAUDE_MD_ACTION_LABEL[claudeMdAction]} ${claudeMdPath}`);

try {
  execFileSync("uvx", ["--version"], { stdio: "ignore" });
} catch {
  console.warn(
    "Warning: `uvx` was not found on PATH. The LAMD MCP server is launched " +
      "via uvx, so install uv before using it: " +
      "https://docs.astral.sh/uv/getting-started/installation/"
  );
}
