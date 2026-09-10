"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { awsCli } = require("../tools/thn-test-prerequisites");

test("AWS CLI receives a real shell pipe without interpolating private JSON or argument data", () => {
  const input = { Example: "fixture $(printf unexpected) ' \" ; & | \\ end" };
  const outputFile = "/tmp/fixture with spaces/readback.json";
  let observed;
  const result = awsCli("s3api", "get-object", input, {}, outputFile, (command, args, options) => {
    observed = { command, args, options };
    return { status: 0, stdout: Buffer.from("{}") };
  });
  assert.deepEqual(result, {});
  assert.equal(observed.command, "bash");
  assert.deepEqual(observed.args.slice(0, 4), ["--noprofile", "--norc", "-p", "-c"]);
  assert.equal(observed.args[4], 'exec 3<&0; exec aws "$@" < <(cat <&3) 3<&-');
  assert.equal(observed.args[5], "thn-aws-cli");
  assert.deepEqual(observed.args.slice(6, 9), ["s3api", "get-object", outputFile]);
  assert.ok(!JSON.stringify(observed.args).includes(input.Example));
  assert.deepEqual(JSON.parse(observed.options.input), input);
  assert.ok(!observed.options.shell);
});

test("AWS CLI transport failure keeps child stderr and private parameters out of the public error", () => {
  const marker = "fixture-confidential-value";
  assert.throws(() => awsCli("sts", "get-caller-identity", { Example: marker }, {}, undefined,
    () => ({ status: 2, stdout: Buffer.from(marker), stderr: Buffer.from(marker) })),
  error => error.message === "thn_prerequisite_guard_failed" && !error.stack.includes(marker));
});

// The deployed workflow is Linux-only. Exercise the actual installed AWS CLI,
// with skeleton generation and no credentials/network, in both Linux CI jobs.
if (process.platform === "linux") {
  test("native Linux AWS CLI reproduces the Node descriptor failure and accepts the real-pipe transport offline", () => {
    const env = { PATH: process.env.PATH, HOME: "/nonexistent", AWS_CONFIG_FILE: "/dev/null",
      AWS_SHARED_CREDENTIALS_FILE: "/dev/null", AWS_EC2_METADATA_DISABLED: "true", AWS_PAGER: "",
      AWS_REGION: "us-east-1", AWS_MAX_ATTEMPTS: "1", SHELLOPTS: "xtrace",
      "BASH_FUNC_aws%%": "() { printf unexpected; }", "BASH_FUNC_cat%%": "() { printf unexpected; }" };
    const legacy = spawnSync("aws", ["sts", "get-caller-identity", "--cli-input-json", "file:///dev/stdin",
      "--generate-cli-skeleton", "input", "--no-sign-request", "--no-cli-pager"], {
      input: "{}", env, encoding: "utf8", timeout: 30000,
    });
    assert.equal(legacy.error, undefined, "the CI runner must provide AWS CLI");
    assert.notEqual(legacy.status, 0, "the original direct Node pipe must reproduce the defect");
    assert.match(legacy.stderr, /No such device or address|Errno 6/, "fail specifically when reopening the Node descriptor");
    // Check the byte boundary independently of AWS parsing, including a payload
    // larger than a typical pipe buffer. Only synthetic data enters this probe.
    const fixture = { Example: "synthetic á $(printf unexpected) ' \" \\ end".repeat(4096) };
    awsCli("sts", "get-caller-identity", fixture, env, undefined, (command, args, options) => {
      const probeArgs = args.slice(0, 6);
      probeArgs[4] = probeArgs[4].replace('exec aws "$@"', 'exec cat "$@"');
      const probe = spawnSync(command, [...probeArgs, "/dev/stdin"], options);
      assert.equal(probe.status, 0, probe.stderr?.toString());
      assert.deepEqual(probe.stdout, Buffer.from(JSON.stringify(fixture)), "stdin bytes must survive shell redirection");
      assert.equal(probe.stderr.toString(), "");
      return { status: 0, stdout: Buffer.from("{}") };
    });
    let transported;
    const skeleton = awsCli("sts", "get-caller-identity", {}, env, undefined, (command, args, options) => {
      transported = spawnSync(command, [...args, "--generate-cli-skeleton", "input", "--no-sign-request"], options);
      // This subprocess has only synthetic input, no credentials and no network.
      // Keep its native error visible here; deployment errors stay sanitized.
      assert.equal(transported.status, 0, transported.stderr?.toString());
      return transported;
    });
    assert.deepEqual(skeleton, {});
    assert.equal(transported.stderr.toString(), "", "inherited shell functions and tracing must be ignored");
  });
}
