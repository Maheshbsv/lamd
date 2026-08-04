import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const LAMD_HOOK_COMMAND =
  'python "$CLAUDE_PROJECT_DIR/.claude/hooks/lamd_inject_rules.py"';

export function registerSessionStartHook(projectRoot) {
  const settingsPath = join(projectRoot, ".claude", "settings.json");
  const settings = existsSync(settingsPath)
    ? JSON.parse(readFileSync(settingsPath, "utf8"))
    : {};

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
