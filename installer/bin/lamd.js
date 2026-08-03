#!/usr/bin/env node
import { registerMcpServer } from "../src/mcpConfig.js";
import { scaffold } from "../src/scaffold.js";

const [, , command] = process.argv;

if (command !== "init") {
  console.error(`Unknown command: ${command ?? "(none)"}. Usage: lamd init`);
  process.exit(1);
}

const projectRoot = process.cwd();
const { lamdDir, starterRulePath } = scaffold(projectRoot);
const configPath = registerMcpServer(projectRoot);

console.log(`Created ${lamdDir}`);
console.log(`Wrote starter rule: ${starterRulePath}`);
console.log(`Registered LAMD MCP server in ${configPath}`);
