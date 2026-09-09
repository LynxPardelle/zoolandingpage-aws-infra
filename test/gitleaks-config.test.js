"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const root = path.join(__dirname, "..");
const configPath = path.join(root, ".gitleaks.toml");
const exactNonSecretHashes = [
  "c85e674c60e540ca8f1ea7029f8a0cae0fa843881ade918242355601ce3f87da",
  "21af44b105a8f395e7c997c70342ad3222c7f3f1592f3b2d67381eda3e610091",
  "eca48ab275d9eec59f46235a548858df944263d1f7e6e25d68316ad530b17ca4",
];

test("Gitleaks keeps all defaults without value, path, rule or comment bypasses", () => {
  assert.ok(existsSync(configPath), "default-only Gitleaks configuration is required");
  const config = readFileSync(configPath, "utf8").replace(/^\s*#.*$/gm, "");
  assert.deepEqual([...config.matchAll(/^\s*(\[.*\])\s*$/gm)].map(match => match[1]), ["[extend]"]);
  assert.deepEqual([...config.matchAll(/^\s*(\w+)\s*=/gm)].map(match => match[1]).sort(),
    ["title", "useDefault"]);
  assert.match(config, /^useDefault\s*=\s*true\s*$/m);
  assert.doesNotMatch(config, /allowlist|disabledRules|stopwords|commits|paths|gitleaks:allow/);
  const workflow = readFileSync(path.join(root, ".github/workflows/validate-thn-candidate.yml"), "utf8");
  assert.match(workflow, /gitleaks.* git --log-opts="--all --full-history" --redact=100 --no-banner --ignore-gitleaks-allow \./);
});

const binary = process.env.GITLEAKS_BINARY || (process.env.RUNNER_TEMP
  ? path.join(process.env.RUNNER_TEMP, process.platform === "win32" ? "gitleaks.exe" : "gitleaks") : undefined);

test("native pinned scanner detects all three non-secret hashes plus changed and distinct fixtures; stdin has no fingerprint exception", {
  skip: !binary || !existsSync(binary) ? "Provide GITLEAKS_BINARY for pinned native scanner verification; CI supplies RUNNER_TEMP/gitleaks." : false,
}, () => {
  assert.ok(existsSync(configPath), "reviewed exact-value Gitleaks configuration is required");
  const version = spawnSync(binary, ["version"], { encoding: "utf8", timeout: 10000 });
  assert.equal(version.status, 0);
  assert.equal(version.stdout.trim(), "8.30.1");
  const lines = ["lib/stacks/frontend-stack.js", "tools/thn-test-prerequisites.js"]
    .flatMap(file => readFileSync(path.join(root, file), "utf8").split(/\r?\n/))
    .filter(line => exactNonSecretHashes.some(value => line.includes(value)));
  assert.equal(lines.length, 3, "do not rename or alter the source hashes to evade detection");
  const scan = input => {
    const result = spawnSync(binary, ["stdin", "--config", configPath, "--redact=100", "--no-banner", "--ignore-gitleaks-allow",
      "--report-format", "json", "--report-path", "-"], { input, encoding: "utf8", timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
    assert.ok([0, 1].includes(result.status), "scanner execution must succeed or return its finding exit code");
    const findings = JSON.parse(result.stdout);
    assert.ok(findings.every(item => item.Secret === "REDACTED"), "findings must not expose input values");
    return { exitCode: result.status, rules: findings.map(item => item.RuleID) };
  };
  assert.deepEqual(scan(lines.join("\n")), { exitCode: 1, rules: Array(3).fill("generic-api-key") });
  const changed = lines.map(line => {
    const value = exactNonSecretHashes.find(item => line.includes(item));
    return line.replace(value, `${value[0] === "a" ? "b" : "a"}${value.slice(1)}`);
  });
  const distinct = createHash("sha256").update("synthetic-gitleaks-regression-fixture-not-a-credential").digest("hex");
  assert.ok(!exactNonSecretHashes.includes(distinct));
  const detected = scan([...changed, `api_key = "${distinct}"`].join("\n"));
  assert.equal(detected.exitCode, 1);
  assert.deepEqual(detected.rules, Array(4).fill("generic-api-key"));
  const extended = scan(`api_key = "${exactNonSecretHashes[0]}ab"`);
  assert.deepEqual(extended, { exitCode: 1, rules: ["generic-api-key"] });
});

test("committed ignore entries resolve only to reviewed public seals or synthetic idempotency identifiers", () => {
  const file = path.join(root, ".gitleaksignore");
  assert.ok(existsSync(file), "preserve the existing reviewed historical fingerprints");
  const entries = readFileSync(file, "utf8").split(/\r?\n/).filter(line => line && !line.startsWith("#"));
  assert.equal(entries.length, 6);
  assert.equal(new Set(entries).size, entries.length);
  assert.deepEqual(entries.slice(0, 2), [
    "f0e164190d931fce84e0065e5a7e73db705782f1:lib/stacks/frontend-stack.js:generic-api-key:452",
    "f0e164190d931fce84e0065e5a7e73db705782f1:lib/stacks/frontend-stack.js:generic-api-key:453",
  ]);
  const verified = [];
  for (const entry of entries) {
    const match = /^([a-f0-9]{40}):(lib\/stacks\/frontend-stack\.js|tools\/thn-test-prerequisites\.js|test\/thn-test-permissions\.test\.js):generic-api-key:([1-9][0-9]*)$/.exec(entry);
    assert.ok(match, "only exact commit/path/rule/line fingerprints are permitted");
    const result = spawnSync("git", ["-c", `safe.directory=${root.replaceAll("\\", "/")}`, "show", `${match[1]}:${match[2]}`], { cwd: root, encoding: "utf8", timeout: 10000 });
    assert.equal(result.status, 0);
    const sourceLine = result.stdout.split(/\r?\n/)[Number(match[3]) - 1];
    const expected = match[2] === "test/thn-test-permissions.test.js"
      ? (/^\s*Client(?:Request)?Token: "thn-permissions-1234-1"/.test(sourceLine) ? "fixed-idempotency-fixture" : null)
      : exactNonSecretHashes.find(hash => sourceLine?.includes(hash));
    assert.ok(expected, "fingerprint must target a reviewed non-secret source line");
    verified.push(expected);
  }
  assert.ok(exactNonSecretHashes.every(hash => verified.includes(hash)));
  assert.equal(verified.filter(value => value === "fixed-idempotency-fixture").length, 3);
});
