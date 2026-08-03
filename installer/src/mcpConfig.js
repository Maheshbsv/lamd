import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SERVER_NAME = "lamd";
const SERVER_ENTRY = {
  command: "uvx",
  args: [
    "--from",
    "git+https://github.com/Maheshbsv/lamd.git#subdirectory=server",
    "lamd-mcp-server",
  ],
};

export function registerMcpServer(projectRoot) {
  const configPath = join(projectRoot, ".mcp.json");
  const config = existsSync(configPath)
    ? JSON.parse(readFileSync(configPath, "utf8"))
    : {};

  config.mcpServers = config.mcpServers || {};
  config.mcpServers[SERVER_NAME] = SERVER_ENTRY;

  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}
