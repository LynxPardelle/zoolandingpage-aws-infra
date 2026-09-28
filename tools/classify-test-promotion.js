"use strict";

// A closed, flat JSON document, never AWS configuration or an instruction to deploy.
const fields = ["schemaVersion", "mode", "devSha", "devTree", "testBaseSha"];
const gitObject = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && value !== "0".repeat(40);
class PromotionSelectionError extends Error {}
const invalid = () => { throw new PromotionSelectionError("promotion_selection_invalid"); };

function parseSelection(raw) {
  if (typeof raw !== "string" || Buffer.byteLength(raw, "utf8") > 4096) invalid();
  // Reject duplicate keys (including escaped aliases) before JSON.parse can discard them.
  // The schema is deliberately flat: string fields and the integer schemaVersion only.
  const string = '"(?:[^"\\\\\x00-\x1f]|\\\\(?:["\\\\/bfnrt]|u[0-9a-fA-F]{4}))*"';
  const pair = new RegExp(`(${string})[ \\t\\r\\n]*:[ \\t\\r\\n]*(${string}|1)(?=[ \\t\\r\\n]*[,}])`, "y");
  let offset = 0;
  const whitespace = () => { while (/[ \t\r\n]/.test(raw[offset] || "x")) offset++; };
  whitespace(); if (raw[offset++] !== "{") invalid();
  const seen = new Set();
  for (;;) {
    whitespace(); pair.lastIndex = offset;
    const match = pair.exec(raw); if (!match) invalid();
    const key = JSON.parse(match[1]);
    if (seen.has(key)) invalid(); seen.add(key); offset = pair.lastIndex;
    whitespace(); const delimiter = raw[offset++];
    if (delimiter === "}") break;
    if (delimiter !== ",") invalid();
  }
  whitespace(); if (offset !== raw.length) invalid();
  const value = JSON.parse(raw);
  if (seen.size !== fields.length || fields.some(key => !seen.has(key)) || value.schemaVersion !== 1
      || value.mode !== "thn-source-only" || ![value.devSha, value.devTree, value.testBaseSha].every(gitObject)) invalid();
  return value;
}

function classifySelection(raw, devSha, devTree, testBaseSha) {
  if (![devSha, devTree, testBaseSha].every(gitObject)) throw new PromotionSelectionError("promotion_context_invalid");
  if (raw === undefined || raw === null || raw === "") return "legacy";
  let value;
  try { value = parseSelection(raw); } catch { invalid(); }
  if (value.devSha !== devSha || value.devTree !== devTree || value.testBaseSha !== testBaseSha) {
    throw new PromotionSelectionError("promotion_selection_stale");
  }
  return "thn-source-only";
}

function main(args = process.argv.slice(2), env = process.env) {
  try {
    if (args.length) throw new PromotionSelectionError("promotion_arguments_invalid");
    process.stdout.write(classifySelection(env.INFRA_TEST_PROMOTION_SELECTION_JSON,
      env.PROMOTED_DEV_SHA, env.PROMOTED_DEV_TREE, env.PROMOTED_TEST_BASE_SHA) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write((error instanceof PromotionSelectionError ? error.message : "promotion_selection_invalid") + "\n");
    return 2;
  }
}
module.exports = { classifySelection, main };
if (require.main === module) process.exitCode = main();
