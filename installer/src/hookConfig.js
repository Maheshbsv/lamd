import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HOOK_RELATIVE_PATH } from "./hookPaths.js";

const LAMD_HOOK_COMMAND = `uv run --no-project python "$CLAUDE_PROJECT_DIR/${HOOK_RELATIVE_PATH}"`;

export function registerSessionStartHook(projectRoot) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  let settings;
  try {
    settings = existsSync(settingsPath)
      ? JSON.parse(readFileSync(settingsPath, "utf8"))
      : {};
  } catch (err) {
    throw new Error(
      `Failed to parse ${settingsPath} — fix or remove it and re-run 'lamd init'. (${err.message})`
    );
  }

  settings.hooks = settings.hooks || {};
  settings.hooks.SessionStart = settings.hooks.SessionStart || [];

  const alreadyRegistered = settings.hooks.SessionStart.some((entry) =>
    (entry.hooks || []).some((hook) => hook.command === LAMD_HOOK_COMMAND)
  );

  if (!alreadyRegistered) {
    settings.hooks.SessionStart.push({
      matcher: "",
      hooks: [{ type: "command", command: LAMD_HOOK_COMMAND }],
    });
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
  return settingsPath;
}
