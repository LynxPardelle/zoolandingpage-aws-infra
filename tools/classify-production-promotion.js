"use strict";

// A closed, flat JSON document, never AWS configuration or an instruction to deploy.
const fields = ["schemaVersion", "mode", "sourceSha", "sourceTree", "targetBaseSha", "mergeTree"];
const gitObject = value => typeof value === "string" && /^[a-f0-9]{40}$/.test(value) && value !== "0".repeat(40);
class PromotionSelectionError extends Error {}
const invalid = () => { throw new PromotionSelectionError("production_promotion_selection_invalid"); };

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
      || value.mode !== "thn-source-only" || ![value.sourceSha, value.sourceTree, value.targetBaseSha, value.mergeTree].every(gitObject)) invalid();
  return value;
}

function classifySelection(raw, context) {
  const names = ["sourceSha", "sourceTree", "targetBaseSha", "mergeTree"];
  if (!context || Object.keys(context).length !== names.length
      || !names.every(name => gitObject(context[name]))) throw new PromotionSelectionError("production_promotion_context_invalid");
  const value = parseSelection(raw);
  if (names.some(name => value[name] !== context[name])) throw new PromotionSelectionError("production_promotion_selection_stale");
  return "thn-source-only";
}

function main(args = process.argv.slice(2), env = process.env) {
  try {
    if (args.length) throw new PromotionSelectionError("production_promotion_arguments_invalid");
    process.stdout.write(classifySelection(env.INFRA_PRODUCTION_PROMOTION_SELECTION_JSON, {sourceSha: env.PROMOTED_SOURCE_SHA,
      sourceTree: env.PROMOTED_SOURCE_TREE, targetBaseSha: env.PROMOTED_TARGET_BASE_SHA, mergeTree: env.PROMOTED_MERGE_TREE}) + "\n");
    return 0;
  } catch (error) {
    process.stderr.write((error instanceof PromotionSelectionError ? error.message : "production_promotion_selection_invalid") + "\n");
    return 2;
  }
}
module.exports = { classifySelection, main };
if (require.main === module) process.exitCode = main();
