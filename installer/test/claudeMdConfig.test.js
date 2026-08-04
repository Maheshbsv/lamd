import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { registerDecisionInstruction } from "../src/claudeMdConfig.js";

const BEGIN_MARKER = "<!-- LAMD:BEGIN -->";
const END_MARKER = "<!-- LAMD:END -->";

test("registerDecisionInstruction creates CLAUDE.md with the LAMD block when none exists", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));

  const claudeMdPath = registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.includes(BEGIN_MARKER));
  assert.ok(content.includes(END_MARKER));
  assert.ok(content.includes("lamd_save_decision"));
});

test("registerDecisionInstruction appends the block to an existing CLAUDE.md without touching prior content", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(claudeMdPath, "# My Project\n\nSome existing instructions.\n", "utf8");

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.startsWith("# My Project\n\nSome existing instructions.\n"));
  assert.ok(content.includes(BEGIN_MARKER));
});

test("registerDecisionInstruction is idempotent when re-run with unchanged content", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));

  registerDecisionInstruction(projectRoot);
  const claudeMdPath = registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  const occurrences = content.split(BEGIN_MARKER).length - 1;
  assert.equal(occurrences, 1);
});

test("registerDecisionInstruction replaces only the marked block, leaving surrounding content untouched", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(
    claudeMdPath,
    `# My Project\n\n${BEGIN_MARKER}\n## Project Memory (LAMD)\nOld outdated instruction text.\n${END_MARKER}\n\n## Other section\nKeep me.\n`,
    "utf8"
  );

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.includes("# My Project"));
  assert.ok(content.includes("## Other section\nKeep me."));
  assert.ok(!content.includes("Old outdated instruction text."));
  assert.ok(content.includes("lamd_save_decision"));
});

test("registerDecisionInstruction appends a fresh block when the LAMD markers are malformed (BEGIN with no matching END)", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(
    claudeMdPath,
    `# My Project\n\n${BEGIN_MARKER}\nHand-edited, marker never closed.\n`,
    "utf8"
  );

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  const occurrences = content.split(BEGIN_MARKER).length - 1;
  assert.equal(occurrences, 2, "expected the original malformed marker plus one freshly appended block");
  assert.ok(content.includes(END_MARKER));
});

test("registerDecisionInstruction does not clobber user content when lamd init is run twice after a malformed marker", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(
    claudeMdPath,
    `# My Project\n\n${BEGIN_MARKER}\nHand-edited, marker never closed.\n`,
    "utf8"
  );

  registerDecisionInstruction(projectRoot); // run 1: appends a fresh, well-formed block
  registerDecisionInstruction(projectRoot); // run 2: must not touch the orphaned content

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(
    content.includes("Hand-edited, marker never closed."),
    "second run must not delete the user's hand-edited orphaned content"
  );
  const occurrences = content.split(BEGIN_MARKER).length - 1;
  assert.equal(occurrences, 2, "orphaned BEGIN plus the one well-formed block's BEGIN");
});

test("registerDecisionInstruction does not treat a mid-sentence mention of the markers as a real block", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(
    claudeMdPath,
    `# My Project\n\nWe use ${BEGIN_MARKER} ... ${END_MARKER} sentinels.\n`,
    "utf8"
  );

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(
    content.includes(`We use ${BEGIN_MARKER} ... ${END_MARKER} sentinels.`),
    "a mid-line mention of the markers must be left untouched, not rewritten as a real block"
  );
  assert.ok(content.includes("lamd_save_decision"));
});

test("registerDecisionInstruction matches the existing file's CRLF line endings when appending", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(claudeMdPath, "# My Project\r\n\r\nSome existing instructions.\r\n", "utf8");

  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  assert.ok(content.startsWith("# My Project\r\n\r\nSome existing instructions.\r\n"));
  const blockStart = content.indexOf(BEGIN_MARKER);
  assert.ok(blockStart !== -1);
  assert.ok(
    !content.slice(blockStart).includes("-->\n## Project"),
    "block body must use CRLF, not a bare LF, on a CRLF file"
  );
});

test("registerDecisionInstruction re-run on a CRLF file still replaces only the marked block", () => {
  const projectRoot = mkdtempSync(join(tmpdir(), "lamd-claudemd-"));
  const claudeMdPath = join(projectRoot, "CLAUDE.md");
  writeFileSync(claudeMdPath, "# My Project\r\n\r\nSome existing instructions.\r\n", "utf8");

  registerDecisionInstruction(projectRoot);
  registerDecisionInstruction(projectRoot);

  const content = readFileSync(claudeMdPath, "utf8");
  const occurrences = content.split(BEGIN_MARKER).length - 1;
  assert.equal(occurrences, 1, "re-running on a CRLF file must still be idempotent");
  assert.ok(content.startsWith("# My Project\r\n\r\nSome existing instructions.\r\n"));
});
