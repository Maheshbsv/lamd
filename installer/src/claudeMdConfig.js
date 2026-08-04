import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const BEGIN_MARKER = "<!-- LAMD:BEGIN -->";
const END_MARKER = "<!-- LAMD:END -->";
const BEGIN_LINE_RE = /^<!-- LAMD:BEGIN -->\r?$/m;
const END_LINE_RE = /^<!-- LAMD:END -->\r?$/m;

const BLOCK_BODY_LINES = [
  "## Project Memory (LAMD)",
  "When an architectural decision is finalized (a technology choice, a",
  "pattern change, a tradeoff with lasting consequences), call",
  "`lamd_save_decision` to record it before moving on.",
];

function detectEol(content) {
  return content.includes("\r\n") ? "\r\n" : "\n";
}

function buildBlock(eol) {
  return [BEGIN_MARKER, ...BLOCK_BODY_LINES, END_MARKER].join(eol);
}

function lastBeginIndexBefore(content, endIndex) {
  const re = /^<!-- LAMD:BEGIN -->\r?$/gm;
  let lastIndex = -1;
  let match;
  while ((match = re.exec(content)) !== null && match.index <= endIndex) {
    lastIndex = match.index;
  }
  return lastIndex;
}

export function registerDecisionInstruction(projectRoot) {
  const claudeMdPath = join(projectRoot, "CLAUDE.md");

  if (!existsSync(claudeMdPath)) {
    writeFileSync(claudeMdPath, `${buildBlock("\n")}\n`, "utf8");
    return { path: claudeMdPath, action: "created" };
  }

  const content = readFileSync(claudeMdPath, "utf8");
  const eol = detectEol(content);
  const block = buildBlock(eol);
  const endMatch = END_LINE_RE.exec(content);
  const endIndex = endMatch ? endMatch.index : -1;
  const beginIndex =
    endIndex === -1
      ? (BEGIN_LINE_RE.exec(content)?.index ?? -1)
      : lastBeginIndexBefore(content, endIndex);

  if (beginIndex === -1 || endIndex === -1 || endIndex < beginIndex) {
    const separator = /\r?\n$/.test(content) ? eol : eol + eol;
    writeFileSync(claudeMdPath, `${content}${separator}${block}${eol}`, "utf8");
    return { path: claudeMdPath, action: "appended" };
  }

  const before = content.slice(0, beginIndex);
  const after = content.slice(endIndex + END_MARKER.length);
  const replacement = `${before}${block}${after}`;
  const action = replacement === content ? "unchanged" : "updated";
  writeFileSync(claudeMdPath, replacement, "utf8");
  return { path: claudeMdPath, action };
}
