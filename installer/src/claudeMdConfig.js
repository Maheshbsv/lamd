import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BEGIN_MARKER = "<!-- LAMD:BEGIN -->";
const END_MARKER = "<!-- LAMD:END -->";
const BEGIN_LINE_RE = /^<!-- LAMD:BEGIN -->$/m;
const END_LINE_RE = /^<!-- LAMD:END -->$/m;

function lastBeginIndexBefore(content, endIndex) {
  const re = /^<!-- LAMD:BEGIN -->$/gm;
  let lastIndex = -1;
  let match;
  while ((match = re.exec(content)) !== null && match.index <= endIndex) {
    lastIndex = match.index;
  }
  return lastIndex;
}

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
  const endMatch = END_LINE_RE.exec(content);
  const endIndex = endMatch ? endMatch.index : -1;
  const beginIndex =
    endIndex === -1
      ? (BEGIN_LINE_RE.exec(content)?.index ?? -1)
      : lastBeginIndexBefore(content, endIndex);

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
