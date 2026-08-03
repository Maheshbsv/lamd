import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

  return { lamdDir, starterRulePath };
}
