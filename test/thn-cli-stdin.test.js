"use strict";
const assert = require("node:assert/strict");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const { awsCli } = require("../tools/thn-test-prerequisites");

test("AWS CLI receives a replayable anonymous input without interpolating private JSON or argument data", () => {
  const input = { Example: "fixture $(printf unexpected) ' \" ; & | \\ end" };
  let observed;
  const result = awsCli("cloudformation", "get-template", input, {}, undefined, (command, args, options) => {
    observed = { command, args, options };
    return { status: 0, stdout: Buffer.from("{}") };
  });
  assert.deepEqual(result, {});
  assert.equal(observed.command, "python3");
  assert.deepEqual(observed.args.slice(0, 3), ["-I", "-S", "-c"]);
  assert.match(observed.args[3], /os\.memfd_create/);
  assert.match(observed.args[3], /F_SEAL_WRITE/);
  assert.match(observed.args[3], /os\.execvp\("aws", \["aws", \*arguments\]\)/);
  assert.deepEqual(observed.args.slice(4, 6), ["cloudformation", "get-template"]);
  assert.ok(!JSON.stringify(observed.args).includes(input.Example));
  assert.deepEqual(JSON.parse(observed.options.input), input);
  assert.equal(observed.options.env.AWS_CLI_FILE_ENCODING, "UTF-8");
  assert.equal(observed.options.timeout, 30000);
  assert.ok(!observed.options.shell);
});

test("S3 GetObject uses separate in-memory parameter references instead of unsupported cli-input-json", () => {
  const input = { Bucket: "thn-synthetic-bucket", Key: "fixture $(printf unexpected) ' \" end",
    ExpectedBucketOwner: "0".repeat(12), ChecksumMode: "ENABLED" };
  const outputFile = "/tmp/fixture with spaces/readback.json";
  let observed;
  awsCli("s3api", "get-object", input, {}, outputFile, (command, args, options) => {
    observed = { command, args, options };
    return { status: 0, stdout: Buffer.from("{}") };
  });
  assert.deepEqual(observed.args.slice(4, 7), ["s3api", "get-object", outputFile]);
  assert.ok(!observed.args.includes("--cli-input-json"));
  assert.match(observed.args[3], /file:\/\/\/proc\/self\/fd\//);
  for (const value of Object.values(input)) assert.ok(!observed.args.includes(value));
  assert.deepEqual(JSON.parse(observed.options.input), input);
  for (const invalid of [{ ...input, Extra: "unexpected" }, { ...input, Bucket: 1 }]) {
    assert.throws(() => awsCli("s3api", "get-object", invalid, {}, outputFile, () => {
      assert.fail("invalid input must fail before spawning");
    }), /thn_prerequisite_guard_failed/);
  }
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
  test("native Linux AWS CLI accepts sealed replayable stdin and reproduces the original descriptor failure offline", () => {
    const env = { PATH: process.env.PATH, HOME: "/nonexistent", AWS_CONFIG_FILE: "/dev/null",
      AWS_SHARED_CREDENTIALS_FILE: "/dev/null", AWS_EC2_METADATA_DISABLED: "true", AWS_PAGER: "",
      AWS_REGION: "us-east-1", AWS_MAX_ATTEMPTS: "1", PYTHONPATH: "/nonexistent", PYTHONINSPECT: "1", SHELLOPTS: "xtrace",
      "BASH_FUNC_aws%%": "() { printf unexpected; }", "BASH_FUNC_cat%%": "() { printf unexpected; }" };
    const legacy = spawnSync("aws", ["sts", "get-caller-identity", "--cli-input-json", "file:///dev/stdin",
      "--generate-cli-skeleton", "input", "--no-sign-request", "--no-cli-pager"], {
      input: "{}", env, encoding: "utf8", timeout: 30000,
    });
    assert.equal(legacy.error, undefined, "the CI runner must provide AWS CLI");
    assert.notEqual(legacy.status, 0, "the original direct Node pipe must reproduce the defect");
    assert.match(legacy.stderr, /No such device or address|Errno 6/, "fail specifically when reopening the Node descriptor");
    // The CLI's argument loader and JSON loader can each reopen the input.
    // Prove repeated exact reads, no filesystem pathname, and write seals with
    // a payload larger than a pipe buffer. This probe uses only synthetic data.
    const fixture = { Example: "synthetic á $(printf unexpected) ' \" \\ end".repeat(4096) };
    awsCli("sts", "get-caller-identity", fixture, env, undefined, (command, args, options) => {
      const probeArgs = args.slice(0, 4);
      const probeBody = [
        "import errno, stat",
        "assert stat.S_ISREG(os.fstat(0).st_mode)",
        'assert os.readlink("/proc/self/fd/0").startswith("/memfd:thn-cli-input")',
        'with open("/dev/stdin", "rb") as source: first = source.read()',
        'with open("/dev/stdin", "rb") as source: second = source.read()',
        "assert first == second",
        "try:",
        '    os.write(0, b"unexpected")',
        "except OSError as error:",
        "    assert error.errno == errno.EPERM",
        "else:",
        '    raise AssertionError("input must be sealed")',
        "sys.stdout.buffer.write(second)",
      ].join("\n");
      probeArgs[3] = probeArgs[3].replace('os.execvp("aws", ["aws", *arguments])', probeBody);
      const probe = spawnSync(command, probeArgs, options);
      assert.equal(probe.status, 0, probe.stderr?.toString());
      assert.deepEqual(probe.stdout, Buffer.from(JSON.stringify(fixture)), "each input reopen must return identical bytes");
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
    assert.equal(transported.stderr.toString(), "", "inherited shell/Python hooks must not execute");
    const role = awsCli("iam", "get-role", { RoleName: "thn-synthetic-role" }, env, undefined, (command, args, options) => {
      const result = spawnSync(command, [...args, "--generate-cli-skeleton", "output", "--no-sign-request"], options);
      assert.equal(result.status, 0, result.stderr?.toString());
      return result;
    });
    assert.equal(typeof role.Role.RoleName, "string", "native CLI must validate nonempty JSON offline too");
    awsCli("s3api", "get-object", { Bucket: "thn-synthetic-bucket", Key: "fixture",
      ExpectedBucketOwner: "0".repeat(12), ChecksumMode: "ENABLED" }, env, "/dev/null", (command, args, options) => {
      // GetObject has no skeleton mode. A closed loopback endpoint proves native
      // argument parsing without a signed request or any connection to AWS.
      const result = spawnSync(command, [...args, "--no-sign-request", "--endpoint-url", "http://127.0.0.1:1",
        "--cli-connect-timeout", "1", "--cli-read-timeout", "1"], options);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr.toString(), /Could not connect to the endpoint URL/);
      assert.doesNotMatch(result.stderr.toString(), /Unknown options|Invalid JSON|Missing required parameter/);
      return { status: 0, stdout: Buffer.from("{}") };
    });
  });
}
