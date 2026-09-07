"use strict";

const assert = require("node:assert/strict");
const { existsSync, readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");
const cdk = require("aws-cdk-lib");
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

function changeSet(changes) {
  return {
    StackName: "ZoolandingTest-Zoolandingpage-test-Frontend",
    StackId:
      "arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingTest-Zoolandingpage-test-Frontend/00000000-0000-0000-0000-000000000001",
    ChangeSetName: "release-123-1",
    ChangeSetId:
      "arn:aws:cloudformation:us-east-1:765932874577:changeSet/release-123-1/00000000-0000-0000-0000-000000000001",
    ChangeSetType: "UPDATE",
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

test("TEST deploy reviews the prepared change set before exact execution", () => {
  const prepare = runner.indexOf("--method prepare-change-set");
  const review = runner.lastIndexOf("review-test-infra-change-set.js");
  const execute = runner.indexOf("aws cloudformation execute-change-set");
  assert.ok(prepare >= 0, "prepare-change-set step missing");
  assert.ok(review > prepare, "review must follow change-set preparation");
  assert.ok(execute > review, "execution must follow review");
  assert.match(runner, /--include-property-values/);
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
