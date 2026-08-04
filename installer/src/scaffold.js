import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK_TEMPLATE_PATH = join(__dirname, "..", "templates", "lamd_inject_rules.py");

const STARTER_RULE = `# Framework Rules

- (Add your project's hard guardrails here, e.g. "Use React", "Always use async/await")
`;

export function scaffold(projectRoot) {
  const lamdDir = join(projectRoot, ".lamd");
  for (const name of ["rules", "decisions", "sessions"]) {
    mkdirSync(join(lamdDir, name), { recursive: true });
  }

  const starterRulePath = join(lamdDir, "rules", "01-framework.md");
  if (!existsSync(starterRulePath)) {
    writeFileSync(starterRulePath, STARTER_RULE, "utf8");
  }

  const hooksDir = join(projectRoot, ".claude", "hooks");
  mkdirSync(hooksDir, { recursive: true });
  const hookScriptPath = join(hooksDir, "lamd_inject_rules.py");
  writeFileSync(hookScriptPath, readFileSync(HOOK_TEMPLATE_PATH, "utf8"), "utf8");

  return { lamdDir, starterRulePath, hookScriptPath };
}
