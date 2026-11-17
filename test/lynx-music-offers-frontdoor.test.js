"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const cdk = require("aws-cdk-lib");
const { Template } = require("aws-cdk-lib/assertions");
const { buildLynxMusicOffersProductionFrontDoor, environments, expectedAccount, defaultRegion } = require("../config/environments");
const hosts = require("../config/lynx-music-offer-hosts.json");
const { FrontendStack } = require("../lib/stacks/frontend-stack");

const certificateArn = `arn:aws:acm:${defaultRegion}:${expectedAccount}:certificate/00000000-0000-4000-8000-000000000000`;
const production = environments.find(({ name }) => name === "production");

function synthesize(frontDoor) {
  const app = new cdk.App();
  const existingFrontDoors = production.frontendHosting.frontDoors.map((door) => ({
    ...door,
    route53RecordsEnabled: false,
    ...(door.id === "lynx-draft-aliases" ? { customDomainNamesEnabled: true, auditHostHint: undefined } : {}),
  }));
  const stack = new FrontendStack(app, "MusicOffersFixture", {
    env: { account: expectedAccount, region: defaultRegion },
    environment: {
      ...production,
      frontendHosting: {
        ...production.frontendHosting,
        releaseId: "music-offers-fixture",
        staticPrefix: "frontend/angular-ssr/production/releases/music-offers-fixture/browser",
        serverBundleKey: "frontend/angular-ssr/production/releases/music-offers-fixture/server/ssr-handler.zip",
        frontDoors: frontDoor ? [...existingFrontDoors, frontDoor] : existingFrontDoors,
      },
    },
  });
  return Template.fromStack(stack).toJSON();
}

test("the music offer distribution is opt-in and aliases phase requires a certificate", () => {
  assert.equal(buildLynxMusicOffersProductionFrontDoor({}), null);
  assert.throws(() => buildLynxMusicOffersProductionFrontDoor({
    FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_PHASE: "other",
  }), /phase/);
  assert.throws(() => buildLynxMusicOffersProductionFrontDoor({
    FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_PHASE: "aliases",
  }), /certificate/);
  assert.throws(() => buildLynxMusicOffersProductionFrontDoor({
    FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_PHASE: "aliases",
    FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_CERTIFICATE_ARN: certificateArn.replace(defaultRegion, "us-west-2"),
  }), /certificate/);
});

test("both rollout phases add only new CloudFront and exact SSR invocation resources", () => {
  const baseline = synthesize();
  const originalMusicConfig = Object.values(baseline.Resources)
    .filter((resource) => resource.Type === "AWS::CloudFront::Distribution")
    .map((resource) => resource.Properties.DistributionConfig)
    .find((config) => config.Aliases?.includes("music.lynxpardelle.com"));
  assert.deepEqual(originalMusicConfig?.Aliases, ["music.lynxpardelle.com", "alecfest-voliii.lynxpardelle.com"]);
  assert.notEqual(originalMusicConfig.ViewerCertificate.AcmCertificateArn, certificateArn);
  const changes = ["generated", "aliases"].map((phase) => {
    const frontDoor = buildLynxMusicOffersProductionFrontDoor({
      FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_PHASE: phase,
      FRONTEND_PRODUCTION_LYNX_MUSIC_OFFERS_CERTIFICATE_ARN: certificateArn,
    });
    const candidate = synthesize(frontDoor);
    for (const [id, resource] of Object.entries(baseline.Resources)) {
      assert.deepEqual(candidate.Resources[id], resource, `Existing resource differs: ${id}`);
    }
    for (const [id, output] of Object.entries(baseline.Outputs)) {
      assert.deepEqual(candidate.Outputs[id], output, `Existing output differs: ${id}`);
    }

    const additions = Object.entries(candidate.Resources).filter(([id]) => !baseline.Resources[id]);
    assert.deepEqual(additions.map(([, resource]) => resource.Type).sort(), [
      "AWS::CloudFront::Distribution",
      "AWS::CloudFront::Function",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Permission",
      "AWS::Lambda::Permission",
      "AWS::SSM::Parameter",
    ]);
    const [distributionId, distribution] = additions.find(([, resource]) => resource.Type === "AWS::CloudFront::Distribution");
    const cfg = distribution.Properties.DistributionConfig;
    assert.equal(cfg.DefaultCacheBehavior.ViewerProtocolPolicy, "redirect-to-https");
    assert.deepEqual(cfg.Aliases ?? [], phase === "aliases" ? hosts : []);
    assert.equal(cfg.ViewerCertificate?.AcmCertificateArn, phase === "aliases" ? certificateArn : undefined);
    const permissions = additions.filter(([, resource]) => resource.Type === "AWS::Lambda::Permission");
    assert.deepEqual(permissions.map(([, resource]) => resource.Properties.Action).sort(), [
      "lambda:InvokeFunction",
      "lambda:InvokeFunctionUrl",
      "lambda:InvokeFunctionUrl",
    ]);
    for (const [, permission] of permissions) {
      assert.equal(permission.Properties.Principal, "cloudfront.amazonaws.com");
      assert.match(JSON.stringify(permission.Properties.SourceArn), new RegExp(distributionId));
    }
    return { candidate, additions };
  });

  assert.equal(hosts.length, 47);
  assert.equal(new Set(hosts).size, hosts.length);
  const [generated, aliases] = changes;
  assert.deepEqual(
    generated.additions.filter(([id, resource]) => JSON.stringify(resource) !== JSON.stringify(aliases.candidate.Resources[id]))
      .map(([, resource]) => resource.Type).sort(),
    ["AWS::CloudFront::Distribution", "AWS::CloudFront::Function"],
  );
});
