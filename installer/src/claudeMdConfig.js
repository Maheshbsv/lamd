import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BEGIN_MARKER = "<!-- LAMD:BEGIN -->";
const END_MARKER = "<!-- LAMD:END -->";

const BLOCK_BODY = `## Project Memory (LAMD)
When an architectural decision is finalized (a technology choice, a
pattern change, a tradeoff with lasting consequences), call
\`lamd_save_decision\` to record it before moving on.`;

function buildBlock() {
  return `${BEGIN_MARKER}\n${BLOCK_BODY}\n${END_MARKER}`;
}

export function registerDecisionInstruction(projectRoot) {
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  const block = buildBlock();

  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, `${block}\n`, "utf8");
    return claudeMdPath;
  }

  const content = readFileSync(claudeMdPath, "utf8");
  const endIndex = content.indexOf(END_MARKER);
  const beginIndex =
    endIndex === -1
      ? content.indexOf(BEGIN_MARKER)
      : content.lastIndexOf(BEGIN_MARKER, endIndex);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    const separator = content.endsWith("\n") ? "\n" : "\n\n";
    writeFileSync(claudeMdPath, `${content}${separator}${block}\n`, "utf8");
    return claudeMdPath;
  }

  const before = content.slice(0, beginIndex);
  const after = content.slice(endIndex + END_MARKER.length);
  writeFileSync(claudeMdPath, `${before}${block}${after}`, "utf8");
  return claudeMdPath;
}
