"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const cdk = require("aws-cdk-lib");
const { fixture: adminReleaseFixture } = require("./fixtures/thn-admin-selection");
const { Template } = require("aws-cdk-lib/assertions");

const { FrontendStack } = require("../lib/stacks/frontend-stack");
const {
  buildThnAdminTestFrontDoor,
  environments,
} = require("../config/environments");

const root = path.join(__dirname, "..");
const deployPath = path.join(root, ".github", "workflows", "deploy-test.yml");
const rollbackPath = path.join(root, ".github", "workflows", "rollback-test.yml");
const reviewerPath = path.join(root, "tools", "review-test-infra-change-set.js");
const runnerPath = path.join(root, "tools", "run-test-infra-change-set.sh");
const deploy = readFileSync(deployPath, "utf8");
const runner = readFileSync(runnerPath, "utf8");

test("generated CDK proof assemblies cannot enter source delivery", () => {
  for (const output of ["cdk.out/manifest.json", "cdk.out-thn-origin-proof/manifest.json", "logs/local-check.log"]) {
    const result = spawnSync("git", ["check-ignore", "--no-index", "--", output], { cwd: root, encoding: "utf8" });
    assert.equal(result.status, 0, `Generated output must be ignored: ${output}`);
  }
});

function count(haystack, needle) {
  return haystack.split(needle).length - 1;
}

test("TEST transports safe selection before credentials and verifies published bytes before each mutation", () => {
  const validate = deploy.slice(deploy.indexOf("  validate:"), deploy.indexOf("  deploy:"));
  assert.match(validate, /FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: \$\{\{ vars\.FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64 \}\}/);
  assert.match(validate, /FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: \$\{\{ vars\.FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON \}\}/);
  assert.match(validate, /thn-admin-release\.js prepare .release\/thn-admin-selection\.json/);
  assert.ok(validate.indexOf("thn-admin-release.js prepare .release/thn-admin-selection.json") < validate.indexOf("cdk synth"));
  assert.match(validate, /cp tools\/thn-admin-release\.js .release\/release-tools\//);
  const deployJob = deploy.slice(deploy.indexOf("  deploy:"));
  assert.match(deployJob, /thn-admin-release\.js compare .transport\/.release\/thn-admin-selection\.json/);
  assert.ok(deployJob.indexOf("thn-admin-release.js compare .transport/.release/thn-admin-selection.json") < deployJob.indexOf("aws-actions/configure-aws-credentials"));
  const preflight = 'node "$RELEASE_ROOT/release-tools/thn-admin-release.js" verify "$RELEASE_ROOT/thn-admin-selection.json"';
  assert.equal(count(runner, preflight), 2);
  assert.ok(runner.indexOf(preflight) < runner.indexOf("npx --no-install cdk deploy"));
  assert.ok(runner.lastIndexOf(preflight) < runner.indexOf('infra-test-aws.js" execute-change-set'));
  assert.ok(runner.lastIndexOf(preflight) > runner.indexOf('test "$decision" = "execute"'));
  const rollback = readFileSync(rollbackPath, "utf8");
  assert.match(rollback, /test -f .transport\/\.release\/thn-admin-selection\.json/);
  assert.match(rollback, /test -f .transport\/\.release\/release-tools\/thn-admin-release\.js/);
  assert.doesNotMatch(validate, /id-token: write|configure-aws-credentials|secrets\.|aws s3|curl/);
});

function changeSet(changes) {
  return {
    StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
    StackId:
      "arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingTest-Zoolandingpage-test-Frontend/00000000-0000-0000-0000-000000000001",
    ChangeSetName: "release-123-1",
    ChangeSetId:
      "arn:aws:cloudformation:us-east-1:765932874577:changeSet/release-123-1/00000000-0000-0000-0000-000000000001",
    Status: "CREATE_COMPLETE",
    ExecutionStatus: "AVAILABLE",
    Changes: changes.map((resource) => ({ Type: "Resource", ResourceChange: resource })),
  };
}

const reviewOptions = {
  expectedStackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
  expectedChangeSetName: "release-123-1",
  expectedChangeSetArn:
    "arn:aws:cloudformation:us-east-1:765932874577:changeSet/release-123-1/00000000-0000-0000-0000-000000000001",
  expectedChangeSetType: "UPDATE",
  expectedAccountId: "765932874577",
  expectedRegion: "us-east-1",
  adminInfrastructureApproved: true,
  adminRouteAssociationApproved: true,
};

function metadataOnlyFixture() {
  const lambda = {
    Properties: { Runtime: "nodejs22.x", Handler: "index.handler", Code: { S3Key: "unchanged.zip" } },
    Metadata: { "aws:asset:path": "../asset-before", "aws:asset:property": "Code", "aws:cdk:path": "fixture/provider" },
  };
  const analytics = { Properties: { Analytics: "v2:deflate64:before" }, Metadata: { "aws:cdk:path": "fixture/CDKMetadata" } };
  return [
    {
      Action: "Modify", LogicalResourceId: "FixtureProviderAABBCCDD", ResourceType: "AWS::Lambda::Function", Replacement: "False", Scope: ["Metadata"],
      BeforeContext: JSON.stringify(lambda), AfterContext: JSON.stringify({ ...lambda, Metadata: { ...lambda.Metadata, "aws:asset:path": "asset-after" } }),
      Details: [{ Evaluation: "Static", ChangeSource: "DirectModification", Target: { Attribute: "Metadata", Path: "/Metadata/aws:asset:path", RequiresRecreation: "Never", AttributeChangeType: "Modify", BeforeValue: "../asset-before", AfterValue: "asset-after" } }],
    },
    {
      Action: "Modify", LogicalResourceId: "CDKMetadata", ResourceType: "AWS::CDK::Metadata", Replacement: "Conditional", Scope: ["Properties"],
      BeforeContext: JSON.stringify(analytics), AfterContext: JSON.stringify({ ...analytics, Properties: { Analytics: "v2:deflate64:after" } }),
      Details: [{ Evaluation: "Static", ChangeSource: "DirectModification", Target: { Attribute: "Properties", Name: "Analytics", Path: "/Properties/Analytics", RequiresRecreation: "Conditionally", AttributeChangeType: "Modify", BeforeValue: "v2:deflate64:before", AfterValue: "v2:deflate64:after" } }],
    },
  ];
}

const ordinaryReview = { ...reviewOptions, adminInfrastructureApproved: false, adminRouteAssociationApproved: false };

test("native CDK-only metadata drift is a non-executing ordinary TEST no-op", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const fixture = metadataOnlyFixture();
  for (const resources of [fixture, [fixture[0]], [fixture[1]]]) {
    assert.equal(reviewChangeSet(changeSet(resources), ordinaryReview), "noop");
  }
});

test("metadata review preserves object contexts across repeated reviews", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const resources = metadataOnlyFixture().map(value => ({ ...value,
    BeforeContext: JSON.parse(value.BeforeContext), AfterContext: JSON.parse(value.AfterContext) }));
  const payload = changeSet(resources), snapshot = JSON.stringify(payload);
  assert.equal(reviewChangeSet(payload, ordinaryReview), "noop");
  assert.equal(JSON.stringify(payload), snapshot);
  assert.equal(reviewChangeSet(payload, ordinaryReview), "noop");
});

test("metadata is not evidence of an approved admin activation", () => {
  const { reviewChangeSet } = require(reviewerPath);
  assert.throws(() => reviewChangeSet(changeSet(metadataOnlyFixture()), reviewOptions), /admin_change_evidence_missing/);
});

test("native metadata may accompany a genuine separately approved admin addition", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const addition = { Action: "Add", LogicalResourceId: "FrontendDistributionThehairnarrativeAdminTestAABBCCDD", ResourceType: "AWS::CloudFront::Distribution", AfterContext: JSON.stringify({ Aliases: ["admin-test.thehairnarrative.com"] }) };
  assert.equal(reviewChangeSet(changeSet([...metadataOnlyFixture(), addition]), reviewOptions), "execute");
  assert.throws(() => reviewChangeSet(changeSet([...metadataOnlyFixture(), addition]), ordinaryReview), /admin_change_requires_approvals/);
});

test("metadata classification cannot hide runtime, unknown-context or extra-property changes", () => {
  const { reviewChangeSet } = require(reviewerPath);
  for (const [index, mutate] of [
    [0, value => { value.Properties.Code.S3Key = "changed.zip"; }],
    [0, value => { value.Metadata["aws:asset:property"] = "Role"; }],
    [0, value => { value.Extra = "unexpected"; }],
    [1, value => { value.Properties.Unexpected = true; }],
    [1, value => { value.Metadata["aws:cdk:path"] = "changed"; }],
  ]) {
    const resources = metadataOnlyFixture();
    const after = JSON.parse(resources[index].AfterContext); mutate(after);
    resources[index].AfterContext = JSON.stringify(after);
    assert.throws(() => reviewChangeSet(changeSet(resources), ordinaryReview), /metadata_change_forbidden/);
  }
});

test("native metadata requires matching complete static detail and scope", () => {
  const { reviewChangeSet } = require(reviewerPath);
  for (const index of [0, 1]) for (const mutate of [
    value => { delete value.BeforeContext; },
    value => { delete value.Details; },
    value => { value.Details[0].Evaluation = "Dynamic"; },
    value => { value.Details[0].Target.AfterValue = "mismatch"; },
    value => { value.Details[0].Target.Path = "/Properties/Code"; },
    value => { value.Details[0].Target.RequiresRecreation = "Always"; },
    value => { value.Scope.push("Properties", "Metadata"); },
  ]) {
    const resources = metadataOnlyFixture(); mutate(resources[index]);
    assert.throws(() => reviewChangeSet(changeSet(resources), ordinaryReview), /metadata_change_forbidden|context_invalid/);
  }
});

test("metadata no-op never skips stateful, production, deletion, replacement or unknown entries", () => {
  const { reviewChangeSet } = require(reviewerPath);
  for (const resource of [
    { LogicalResourceId: "RetainedTable", ResourceType: "AWS::DynamoDB::Table", Action: "Modify", Replacement: "Conditional" },
    { LogicalResourceId: "RetainedBucket", ResourceType: "AWS::S3::Bucket", Action: "Remove" },
    { LogicalResourceId: "OtherFunction", ResourceType: "AWS::Lambda::Function", Action: "Modify", Replacement: "True" },
    { ...metadataOnlyFixture()[0], LogicalResourceId: "ProductionProvider" },
    { ...metadataOnlyFixture()[1], LogicalResourceId: "OtherMetadata" },
    { ...metadataOnlyFixture()[1], Action: "Add" },
    { ...metadataOnlyFixture()[1], Replacement: "True" },
  ]) assert.throws(() => reviewChangeSet(changeSet([...metadataOnlyFixture(), resource]), ordinaryReview));
  const payload = changeSet(metadataOnlyFixture());
  payload.Changes.push({ Type: "Unknown" });
  assert.throws(() => reviewChangeSet(payload, ordinaryReview), /change_set_entry_invalid/);
});

test("functional ordinary changes never become metadata no-ops", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const functionChange = { Action: "Modify", LogicalResourceId: "FrontendSsrFunction47B61DD8", ResourceType: "AWS::Lambda::Function", Replacement: "False", Scope: ["Properties"], BeforeContext: JSON.stringify({ Code: { S3Key: "before.zip" }, Environment: { Variables: { NG_ALLOWED_HOSTS: "test.zoolandingpage.com.mx" } } }), AfterContext: JSON.stringify({ Code: { S3Key: "after.zip" }, Environment: { Variables: { NG_ALLOWED_HOSTS: "test.zoolandingpage.com.mx" } } }) };
  assert.equal(reviewChangeSet(changeSet([...metadataOnlyFixture(), functionChange]), ordinaryReview), "execute");
  assert.throws(() => reviewChangeSet(changeSet([...metadataOnlyFixture(), functionChange]), reviewOptions), /shared_ssr_change_forbidden/);
});

test("normal deploy and rollback never add, modify, replace or remove the retained prerequisite certificate", () => {
  const { reviewChangeSet } = require(reviewerPath);
  for (const approved of [false, true]) for (const action of ["Add", "Modify", "Remove"]) {
    const options = { ...reviewOptions, adminInfrastructureApproved: approved, adminRouteAssociationApproved: approved };
    assert.throws(() => reviewChangeSet(changeSet([{ LogicalResourceId: "ThnAdminTestCertificate", ResourceType: "AWS::CertificateManager::Certificate",
      Action: action, Replacement: "False" }]), options), /certificate_prerequisite|stateful_resource_change/);
    assert.throws(() => reviewChangeSet(changeSet([{ LogicalResourceId: "ThnAdminTestCertificate", ResourceType: "AWS::CertificateManager::Certificate",
      Action: "Modify", Replacement: "True" }]), options), /stateful_resource_change/);
  }
});

function synthesizeDeliveryTemplate(adminEnabled) {
  const environment = structuredClone(
    environments.find((candidate) => candidate.name === "test")
  );
  const releaseId = "task027-fixture-release";
  environment.frontendHosting.releaseId = releaseId;
  environment.frontendHosting.manifestKey =
    `frontend/angular-ssr/test/releases/${releaseId}/manifest.json`;
  environment.frontendHosting.staticPrefix =
    `frontend/angular-ssr/test/releases/${releaseId}/browser`;
  environment.frontendHosting.serverBundleKey =
    `frontend/angular-ssr/test/releases/${releaseId}/server/ssr-handler.zip`;
  environment.frontendHosting.frontDoors = environment.frontendHosting.frontDoors.filter(
    (frontDoor) => frontDoor.id !== "thehairnarrative-admin-test"
  );
  if (adminEnabled) {
    environment.frontendHosting.frontDoors.push(buildThnAdminTestFrontDoor({
      ...adminReleaseFixture().inputs,
      FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "true",
      FRONTEND_TEST_THN_ADMIN_CERTIFICATE_ARN:
        `arn:aws:acm:us-east-1:${environment.account}:certificate/task027-fixture`,
      FRONTEND_TEST_THN_ADMIN_HOSTED_ZONE_ID: "ZTHNTASK027",
      FRONTEND_TEST_THN_ADMIN_ROUTE53_RECORDS_ENABLED: "true",
    }, environment.account));
  }
  const app = new cdk.App();
  const stack = new FrontendStack(app, "Task027DeliveryFixture", {
    env: { account: environment.account, region: environment.region },
    environment,
  });
  return Template.fromStack(stack).toJSON();
}

test("TEST deploy exposes two distinct, default-off THN admin approvals", () => {
  assert.match(deploy, /approve_thn_admin_dns_tls_distribution:/);
  assert.match(deploy, /approve_thn_admin_route_association:/);
  assert.match(
    deploy,
    /ADMIN_INFRASTRUCTURE_APPROVED:.*inputs\.approve_thn_admin_dns_tls_distribution/
  );
  assert.match(
    deploy,
    /ADMIN_ROUTE_ASSOCIATION_APPROVED:.*inputs\.approve_thn_admin_route_association/
  );
  assert.match(deploy, /admin_approval_pair_invalid/);
});

test("TEST deploy requires the exact non-forced dev merge tree", () => {
  assert.match(deploy, /git fetch --no-tags origin refs\/heads\/dev:refs\/remotes\/origin\/dev/);
  assert.match(deploy, /test "\$parent_count" = "2"/);
  assert.match(deploy, /test "\$first_parent" = "\$BEFORE_SHA"/);
  assert.match(deploy, /test "\$second_parent" = "\$\(git rev-parse refs\/remotes\/origin\/dev\)"/);
  assert.match(
    deploy,
    /test "\$\(git rev-parse 'HEAD\^\{tree\}'\)" = "\$\(git rev-parse 'refs\/remotes\/origin\/dev\^\{tree\}'\)"/
  );
});

test("TEST deploy transports and re-verifies one immutable CDK assembly", () => {
  assert.match(deploy, /actions\/upload-artifact@[a-f0-9]{40}/);
  assert.match(deploy, /actions\/download-artifact@[a-f0-9]{40}/);
  assert.match(deploy, /artifact-ids:/);
  assert.match(deploy, /source_sha/);
  assert.match(deploy, /source_manifest_sha256/);
  assert.match(deploy, /recomputed-release-manifest\.sha256/);
  assert.match(deploy, /cmp --silent .*release-manifest\.sha256/);
  assert.match(deploy, /retention-days: 30/);
});

test("TEST validation reads TEST Environment variables without credentials or secrets", () => {
  const validate = deploy.replace(/\r\n/g, "\n").split("  validate:\n")[1]?.split("\n  deploy:")[0];
  assert.ok(validate, "validate job must exist");
  assert.match(validate, /\n    environment: test\n/);
  assert.match(validate, /\n    permissions:\n      contents: read\n/);
  assert.doesNotMatch(validate, /id-token:|secrets\.|configure-aws-credentials|role-to-assume/);
});

test("AWS-shaped descriptions allow no type field but reject any explicit mismatch", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const payload = changeSet([{
    Action: "Add",
    LogicalResourceId: "FrontendDistributionThehairnarrativeAdminTest5B029562",
    ResourceType: "AWS::CloudFront::Distribution",
    Replacement: null,
    AfterContext: JSON.stringify({ Aliases: ["admin-test.thehairnarrative.com"] }),
  }]);
  assert.equal(reviewChangeSet(payload, reviewOptions), "execute");
  assert.equal(reviewChangeSet({ ...payload, ChangeSetType: "UPDATE" }, reviewOptions), "execute");
  for (const responseType of [null, "", "CREATE", "IMPORT"]) {
    assert.throws(
      () => reviewChangeSet({ ...payload, ChangeSetType: responseType }, reviewOptions),
      /change_set_identity_invalid/
    );
  }
  assert.throws(
    () => reviewChangeSet(payload, { ...reviewOptions, expectedChangeSetType: "IMPORT" }),
    /change_set_type_invalid/
  );
});

test("AWS-shaped no-op descriptions still require exact status and identity", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const payload = {
    ...changeSet([]), Status: "FAILED", ExecutionStatus: "UNAVAILABLE",
    StatusReason: "The submitted information didn't contain changes. Submit different information to create a change set.",
  };
  assert.equal(reviewChangeSet(payload, reviewOptions), "noop");
  assert.throws(() => reviewChangeSet({ ...payload, StatusReason: "unexpected" }, reviewOptions), /change_set_not_available/);
  for (const key of ["StackName", "ChangeSetName", "ChangeSetId"]) {
    assert.throws(() => reviewChangeSet({ ...payload, [key]: "unexpected" }, reviewOptions), /change_set_identity_invalid/);
  }
});

test("TEST deploy reviews the prepared change set before exact execution", () => {
  const prepare = runner.indexOf("--method prepare-change-set");
  const review = runner.lastIndexOf("review-test-infra-change-set.js");
  const execute = runner.indexOf('infra-test-aws.js" execute-change-set');
  assert.ok(prepare >= 0, "prepare-change-set step missing");
  assert.ok(review > prepare, "review must follow change-set preparation");
  assert.ok(execute > review, "execution must follow review");
  assert.match(readFileSync(path.join(root, "tools", "infra-test-aws.js"), "utf8"), /--include-property-values/);
  assert.match(runner, /npx --no-install cdk deploy/);
  assert.match(deploy, /npx --no-install cdk synth/);
  assert.doesNotMatch(`${deploy}\n${runner}`, /npx cdk/);
  assert.match(runner, /--expected-host "\$EXPECTED_HOST"/);
  assert.match(deploy, /run-test-infra-change-set\.sh/);
  assert.match(deploy, /Post-deploy TEST stack smoke/);
  assert.match(runner, /if \[ "\$prepare_exit" -eq 0 \]; then/);
  assert.ok(
    runner.indexOf('test "$prepare_exit" -eq 0') > review,
    "a non-noop execution must require successful CDK preparation"
  );
  assert.equal(count(deploy, "id-token: write"), 1);
});

test("TEST helpers use only sealed artifact-derived CDK roles and preserve the parent CDK identity", () => {
  const rollback = readFileSync(rollbackPath, "utf8");
  for (const workflow of [deploy, rollback]) {
    assert.match(workflow, /EXPECTED_RELEASE_MANIFEST_SHA256:/);
    assert.match(workflow, /EXPECTED_RELEASE_SOURCE_SHA:/);
    assert.match(workflow, /EXPECTED_RELEASE_RUN_ID:/);
    assert.match(workflow, /infra-test-aws\.js verify-public-release/);
    assert.doesNotMatch(workflow, /aws cloudformation describe-stacks/);
  }
  assert.match(deploy, /cp tools\/infra-test-aws\.js .release\/release-tools\//);
  assert.match(runner, /infra-test-aws\.js" describe-change-set/);
  assert.match(runner, /infra-test-aws\.js" execute-change-set/);
  assert.match(runner, /infra-test-aws\.js" wait-stack/);
  assert.doesNotMatch(runner, /aws cloudformation|export AWS_ACCESS_KEY_ID|GITHUB_ENV/);
  const smoke = readFileSync(path.join(root, "tools", "smoke-test-infra-stack.sh"), "utf8");
  assert.match(smoke, /infra-test-aws\.js" smoke/);
  assert.doesNotMatch(smoke, /aws cloudformation|aws cloudfront/);
});

test("TEST deploy and rollback bind credentials and change sets to the exact AWS target", () => {
  const rollback = readFileSync(rollbackPath, "utf8");
  for (const workflow of [deploy, rollback]) {
    assert.match(workflow, /EXPECTED_AWS_ACCOUNT_ID: ['"]?765932874577['"]?/);
    assert.match(workflow, /EXPECTED_AWS_REGION: us-east-1/);
    assert.match(workflow, /aws sts get-caller-identity/);
    assert.match(workflow, /test "\$caller_account" = "\$EXPECTED_AWS_ACCOUNT_ID"/);
    assert.match(workflow, /test "\$AWS_REGION" = "\$EXPECTED_AWS_REGION"/);
    assert.match(workflow, /aws-region: us-east-1/);
    assert.match(workflow, /arn:aws:iam::765932874577:role\//);
    assert.doesNotMatch(workflow, /vars\.AWS_REGION/);
  }
  assert.match(runner, /--expected-account-id "\$EXPECTED_AWS_ACCOUNT_ID"/);
  assert.match(runner, /--expected-region "\$EXPECTED_AWS_REGION"/);
});

test("TEST rollback selects a recorded immutable Deploy Test artifact", () => {
  assert.ok(existsSync(rollbackPath), "rollback-test.yml must exist");
  const rollback = readFileSync(rollbackPath, "utf8");
  for (const input of [
    "source_run_id",
    "source_artifact_id",
    "source_sha",
    "source_manifest_sha256",
    "approve_thn_admin_dns_tls_distribution",
    "approve_thn_admin_route_association",
  ]) {
    assert.match(rollback, new RegExp(`${input}:`));
  }
  assert.match(rollback, /run\.path !== '\.github\/workflows\/deploy-test\.yml'/);
  assert.match(rollback, /listWorkflowRunArtifacts/);
  assert.match(rollback, /artifact\.id !== artifactId/);
  assert.match(rollback, /artifact\.expired/);
  assert.match(rollback, /expectedArtifactName/);
  assert.match(rollback, /artifact-ids:/);
  assert.match(rollback, /run-id:/);
  assert.match(rollback, /run-test-infra-change-set\.sh/);
  assert.equal(count(rollback, "id-token: write"), 1);
});

test("change-set reviewer accepts only the exact approved THN admin surface", () => {
  assert.ok(existsSync(reviewerPath), "change-set reviewer must exist");
  const { reviewChangeSet } = require(reviewerPath);
  const result = reviewChangeSet(
    changeSet([
      {
        Action: "Modify",
        LogicalResourceId: "CDKMetadata",
        ResourceType: "AWS::CDK::Metadata",
        Replacement: "False",
        BeforeContext: JSON.stringify({ Analytics: "v2:deflate64:before" }),
        AfterContext: JSON.stringify({ Analytics: "v2:deflate64:after" }),
      },
      {
        Action: "Add",
        LogicalResourceId: "FrontendDistributionThehairnarrativeAdminTest5B029562",
        ResourceType: "AWS::CloudFront::Distribution",
        Replacement: null,
        AfterContext: JSON.stringify({ Aliases: ["admin-test.thehairnarrative.com"] }),
      },
      {
        Action: "Modify",
        LogicalResourceId: "FrontendSsrFunction47B61DD8",
        ResourceType: "AWS::Lambda::Function",
        Replacement: "False",
        BeforeContext: JSON.stringify({
          Environment: {
            Variables: {
              NG_ALLOWED_HOSTS: "test.zoolandingpage.com.mx",
            },
          },
        }),
        AfterContext: JSON.stringify({
          Environment: {
            Variables: {
              NG_ALLOWED_HOSTS:
                "test.zoolandingpage.com.mx,admin-test.thehairnarrative.com",
            },
          },
        }),
      },
    ]),
    reviewOptions
  );
  assert.equal(result, "execute");
});

test("actual synthesized THN activation inventory passes the exact reviewer", () => {
  const { reviewChangeSet } = require(reviewerPath);
  const before = synthesizeDeliveryTemplate(false);
  const after = synthesizeDeliveryTemplate(true);
  const logicalIds = [...new Set([
    ...Object.keys(before.Resources),
    ...Object.keys(after.Resources),
  ])].sort();
  const resourceChanges = [];
  for (const logicalId of logicalIds) {
    const oldResource = before.Resources[logicalId];
    const newResource = after.Resources[logicalId];
    if (!oldResource && newResource) {
      resourceChanges.push({
        Action: "Add",
        LogicalResourceId: logicalId,
        ResourceType: newResource.Type,
        Replacement: null,
        AfterContext: JSON.stringify(newResource.Properties || {}),
      });
    } else if (
      oldResource
      && newResource
      && JSON.stringify(oldResource) !== JSON.stringify(newResource)
    ) {
      resourceChanges.push({
        Action: "Modify",
        LogicalResourceId: logicalId,
        ResourceType: newResource.Type,
        Replacement: "False",
        BeforeContext: JSON.stringify(oldResource.Properties || {}),
        AfterContext: JSON.stringify(newResource.Properties || {}),
      });
    }
  }
  assert.ok(resourceChanges.length > 0);
  assert.equal(resourceChanges.some((change) => change.Action === "Remove"), false);
  assert.equal(
    resourceChanges.some((change) => change.LogicalResourceId.startsWith("FrontendSsrFunction")),
    true
  );
  assert.equal(reviewChangeSet(changeSet(resourceChanges), reviewOptions), "execute");
});

test("change-set reviewer allows ordinary SSR drift when the admin host membership is unchanged", () => {
  assert.ok(existsSync(reviewerPath), "change-set reviewer must exist");
  const { reviewChangeSet } = require(reviewerPath);
  const before = {
    Code: { S3Key: "before.zip" },
    Environment: {
      Variables: {
        NG_ALLOWED_HOSTS: "test.zoolandingpage.com.mx,admin-test.thehairnarrative.com",
      },
    },
  };
  const after = {
    ...before,
    Code: { S3Key: "after.zip" },
  };
  const result = reviewChangeSet(
    changeSet([{
      Action: "Modify",
      LogicalResourceId: "FrontendSsrFunction47B61DD8",
      ResourceType: "AWS::Lambda::Function",
      Replacement: "False",
      BeforeContext: JSON.stringify(before),
      AfterContext: JSON.stringify(after),
    }]),
    {
      ...reviewOptions,
      adminInfrastructureApproved: false,
      adminRouteAssociationApproved: false,
    }
  );
  assert.equal(result, "execute");
});

test("change-set reviewer rejects collateral SSR changes during admin activation", () => {
  assert.ok(existsSync(reviewerPath), "change-set reviewer must exist");
  const { reviewChangeSet } = require(reviewerPath);
  assert.throws(
    () => reviewChangeSet(
      changeSet([{
        Action: "Modify",
        LogicalResourceId: "FrontendSsrFunction47B61DD8",
        ResourceType: "AWS::Lambda::Function",
        Replacement: "False",
        BeforeContext: JSON.stringify({
          MemorySize: 512,
          Environment: { Variables: { NG_ALLOWED_HOSTS: "test.zoolandingpage.com.mx" } },
        }),
        AfterContext: JSON.stringify({
          MemorySize: 1024,
          Environment: {
            Variables: {
              NG_ALLOWED_HOSTS:
                "test.zoolandingpage.com.mx,admin-test.thehairnarrative.com",
            },
          },
        }),
      }]),
      reviewOptions
    ),
    /shared_ssr_change_forbidden/
  );
});

test("change-set reviewer requires approvals only when admin host membership changes", () => {
  assert.ok(existsSync(reviewerPath), "change-set reviewer must exist");
  const { reviewChangeSet } = require(reviewerPath);
  assert.throws(
    () => reviewChangeSet(
      changeSet([{
        Action: "Modify",
        LogicalResourceId: "FrontendSsrFunction47B61DD8",
        ResourceType: "AWS::Lambda::Function",
        Replacement: "False",
        BeforeContext: JSON.stringify({
          Environment: { Variables: { NG_ALLOWED_HOSTS: "test.zoolandingpage.com.mx" } },
        }),
        AfterContext: JSON.stringify({
          Environment: {
            Variables: {
              NG_ALLOWED_HOSTS:
                "test.zoolandingpage.com.mx,admin-test.thehairnarrative.com",
            },
          },
        }),
      }]),
      {
        ...reviewOptions,
        adminInfrastructureApproved: false,
        adminRouteAssociationApproved: false,
      }
    ),
    /admin_change_requires_approvals/
  );
});

test("change-set reviewer requires both approvals and rejects unrelated drift", () => {
  assert.ok(existsSync(reviewerPath), "change-set reviewer must exist");
  const { reviewChangeSet } = require(reviewerPath);
  const payload = changeSet([
    {
      Action: "Add",
      LogicalResourceId: "FrontendDistributionThehairnarrativeAdminTest5B029562",
      ResourceType: "AWS::CloudFront::Distribution",
      Replacement: null,
      AfterContext: JSON.stringify({ Aliases: ["admin-test.thehairnarrative.com"] }),
    },
  ]);
  assert.throws(
    () => reviewChangeSet(payload, { ...reviewOptions, adminRouteAssociationApproved: false }),
    /admin_approval_pair_invalid/
  );
  assert.throws(
    () =>
      reviewChangeSet(
        changeSet([
          {
            Action: "Modify",
            LogicalResourceId: "FrontendDistributionTest9CFE0000",
            ResourceType: "AWS::CloudFront::Distribution",
            Replacement: "False",
            AfterContext: "{}",
          },
        ]),
        reviewOptions
      ),
    /non_admin_resource_change_forbidden/
  );
});

test("change-set reviewer rejects production aliases, deletion, and replacement", () => {
  assert.ok(existsSync(reviewerPath), "change-set reviewer must exist");
  const { reviewChangeSet } = require(reviewerPath);
  const adminBase = {
    LogicalResourceId: "FrontendDistributionThehairnarrativeAdminTest5B029562",
    ResourceType: "AWS::CloudFront::Distribution",
    Replacement: null,
  };
  assert.throws(
    () =>
      reviewChangeSet(
        changeSet([
          {
            ...adminBase,
            Action: "Add",
            AfterContext: JSON.stringify({ Aliases: ["thehairnarrative.com"] }),
          },
        ]),
        reviewOptions
      ),
    /production_alias_forbidden/
  );
  assert.throws(
    () =>
      reviewChangeSet(
        changeSet([
          {
            Action: "Remove",
            LogicalResourceId: "FrontendArtifactBucket",
            ResourceType: "AWS::S3::Bucket",
            Replacement: null,
          },
        ]),
        { ...reviewOptions, adminInfrastructureApproved: false, adminRouteAssociationApproved: false }
      ),
    /stateful_resource_change_forbidden/
  );
  assert.throws(
    () =>
      reviewChangeSet(
        changeSet([{ ...adminBase, Action: "Modify", Replacement: "True" }]),
        reviewOptions
      ),
    /stateful_resource_change_forbidden/
  );
  assert.throws(
    () =>
      reviewChangeSet(
        changeSet([{
          Action: "Modify",
          LogicalResourceId: "CDKMetadata",
          ResourceType: "AWS::CDK::Metadata",
          Replacement: "False",
          BeforeContext: JSON.stringify({ Analytics: "before" }),
          AfterContext: JSON.stringify({ Analytics: "after", Unexpected: true }),
        }]),
        reviewOptions
      ),
    /cdk_metadata_change_forbidden/
  );
  assert.throws(
    () => reviewChangeSet(
      {
        ...changeSet([{ ...adminBase, Action: "Add", AfterContext: "{}" }]),
        ChangeSetId:
          "arn:aws:cloudformation:us-east-1:999999999999:changeSet/release-123-1/00000000-0000-0000-0000-000000000001",
      },
      {
        ...reviewOptions,
        expectedChangeSetArn:
          "arn:aws:cloudformation:us-east-1:999999999999:changeSet/release-123-1/00000000-0000-0000-0000-000000000001",
      }
    ),
    /change_set_arn_invalid/
  );
  assert.throws(
    () => reviewChangeSet(
      {
        ...changeSet([{ ...adminBase, Action: "Add", AfterContext: "{}" }]),
        StackId:
          "arn:aws:cloudformation:us-east-1:999999999999:stack/ZoolandingTest-Zoolandingpage-test-Frontend/00000000-0000-0000-0000-000000000001",
      },
      reviewOptions
    ),
    /stack_arn_invalid/
  );
  assert.throws(
    () => reviewChangeSet(
      changeSet([{ ...adminBase, Action: "Add", AfterContext: "{}" }]),
      { ...reviewOptions, expectedRegion: "us-west-2" }
    ),
    /test_target_invalid/
  );
});
