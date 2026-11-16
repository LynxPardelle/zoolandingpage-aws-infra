"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=()=>require("../tools/thn-production-frontend-projection");
const cert={Type:"AWS::CertificateManager::Certificate",DeletionPolicy:"Retain",UpdateReplacePolicy:"Retain",Properties:{DomainName:"admin.thehairnarrative.com",ValidationMethod:"DNS",CertificateExport:"DISABLED",DomainValidationOptions:[{DomainName:"admin.thehairnarrative.com",HostedZoneId:"Z08032292DKYZ4QGCIZDR"}]}};
const old=()=>({Resources:{ThnAdminProductionCertificate:cert,FrontendSsrFunctionABCDEF01:{Type:"AWS::Lambda::Function",Properties:{FunctionName:"zoolandingpage-production-frontend-ssr",Code:{S3Bucket:"zoolandingpage-production-frontend-artifacts-765932874577",S3Key:"frontend/angular-ssr/production/releases/old/server/ssr-handler.zip"},Environment:{Variables:{ZLP_RELEASE_ID:"old",ZLP_DEPLOY_ENV:"production",ZLP_RUNTIME_ENV:"production"}}}},Public:{Type:"AWS::CloudFront::Distribution",Properties:{DistributionConfig:{Aliases:["thehairnarrative.com"],Origins:[{Id:"static",DomainName:"assets.zoolandingpage.com.mx",OriginPath:"/frontend/angular-ssr/production/releases/old/browser"}]}}},Untouched:{Type:"AWS::S3::Bucket",Properties:{BucketName:"retained-other"}}}});
test("production public visual projection updates sealed code/release/static origins while retaining aliases and all identities",()=>{
 const before=old(),desired=structuredClone(before);desired.Resources.FrontendSsrFunctionABCDEF01.Properties.Code.S3Key="frontend/angular-ssr/production/releases/new/server/ssr-handler.zip";desired.Resources.FrontendSsrFunctionABCDEF01.Properties.Environment.Variables.ZLP_RELEASE_ID="new";desired.Resources.Public.Properties.DistributionConfig.Origins[0].OriginPath="/frontend/angular-ssr/production/releases/new/browser";desired.Resources.Untouched.Properties.BucketName="unexpected-desired";
 const c=api().projectPublicVisual(before,desired,"new");assert.equal(c.Resources.Untouched.Properties.BucketName,"retained-other");assert.deepEqual(c.Resources.Public.Properties.DistributionConfig.Aliases,["thehairnarrative.com"]);
 const native={Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",Changes:[{Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:"FrontendSsrFunctionABCDEF01",ResourceType:"AWS::Lambda::Function",Replacement:"False",Scope:["Properties"],Details:[{Target:{Attribute:"Properties",Name:"Code"}}]}},{Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:"Public",ResourceType:"AWS::CloudFront::Distribution",Replacement:"False",Scope:["Properties"]}}]};
 assert.equal(api().reviewFrontendChanges(before,c,native).length,2);
 assert.throws(()=>api().reviewFrontendChanges(before,c,{...native,Changes:[...native.Changes,{Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:"Untouched",ResourceType:"AWS::S3::Bucket",Replacement:"False"}}]}),/production_frontend_inventory_invalid/);
 desired.Resources.Public.Properties.DistributionConfig.Aliases=["other.com"];assert.throws(()=>api().projectPublicVisual(before,desired,"new"),/production_public_projection_invalid/);
});
test("private initial projection accepts only scoped new resources and preserved retained certificate",()=>{
 const b=old(),d=structuredClone(b);d.Resources.FrontendThnAdminSsrFunction874373CC={Type:"AWS::Lambda::Function",Properties:{FunctionName:"zoolandingpage-production-frontend-thn-admin-ssr",Environment:{Variables:{THN_DEPLOYMENT_ENVIRONMENT:"production"}},Code:{S3Bucket:"zoolandingpage-production-frontend-artifacts-765932874577",S3Key:"frontend/angular-ssr/production/releases/new/server/ssr-handler.zip"}}};d.Resources.FrontendDistributionThehairnarrativeAdminProductionF99395A3={Type:"AWS::CloudFront::Distribution",Properties:{DistributionConfig:{Aliases:["admin.thehairnarrative.com"],ViewerCertificate:{AcmCertificateArn:"arn:aws:acm:us-east-1:765932874577:certificate/11111111-1111-1111-1111-111111111111"},Origins:[]}}};d.Resources.UnexpectedNew={Type:"AWS::DynamoDB::Table"};
 const p=api().projectPrivateFrontdoor(b,d,"new");assert.equal(p.Resources.UnexpectedNew,undefined);assert.deepEqual(p.Resources.Untouched,b.Resources.Untouched);
 const wrong=structuredClone(d);wrong.Resources.FrontendThnAdminSsrFunction874373CC.Properties.Environment.Variables.THN_DEPLOYMENT_ENVIRONMENT="test";assert.throws(()=>api().projectPrivateFrontdoor(b,wrong,"new"),/production_private_projection_invalid/);
});

const lynxId = "FrontendDistributionLynxMusicOffers3ABF6E6E";
const lynxHosts = require("../config/lynx-music-offer-hosts.json");

function publicReleaseFixture(phase) {
 const before = old(), desired = structuredClone(before);
 const nextFn = desired.Resources.FrontendSsrFunctionABCDEF01.Properties;
 nextFn.Code.S3Key = "frontend/angular-ssr/production/releases/new/server/ssr-handler.zip";
 nextFn.Environment.Variables.ZLP_RELEASE_ID = "new";
 desired.Resources.Public.Properties.DistributionConfig.Origins[0].OriginPath = "/frontend/angular-ssr/production/releases/new/browser";
 const lynxConfig = {
  Comment: "Zoolandingpage Angular SSR frontend (production/lynx-music-offers)",
  Origins: [{ Id: "static", DomainName: "assets.zoolandingpage.com.mx", OriginPath: "/frontend/angular-ssr/production/releases/old/browser" }],
  ...(phase === "aliases" ? {
   Aliases: lynxHosts,
   ViewerCertificate: { AcmCertificateArn: "arn:aws:acm:us-east-1:765932874577:certificate/11111111-1111-4111-8111-111111111111" },
  } : {}),
 };
 before.Resources[lynxId] = { Type: "AWS::CloudFront::Distribution", Properties: { DistributionConfig: lynxConfig } };
 return { before, desired };
}

test("public SSR rotations preserve the exact live Lynx phases and only rotate their static prefix", () => {
 for (const phase of ["generated", "aliases"]) {
  const { before, desired } = publicReleaseFixture(phase);
  const candidate = api().projectPublicVisual(before, desired, "new");
  const expected = structuredClone(before.Resources[lynxId]);
  expected.Properties.DistributionConfig.Origins[0].OriginPath = "/frontend/angular-ssr/production/releases/new/browser";
  assert.deepEqual(candidate.Resources[lynxId], expected);
  const rollback = api().projectPublicVisual(candidate, before, "old");
  assert.deepEqual(rollback.Resources[lynxId], before.Resources[lynxId]);
 }
});

test("public SSR rotation rejects any Lynx alias drift or unmatched distribution", () => {
 for (const drift of [
  (resources) => { resources[lynxId].Properties.DistributionConfig.Aliases = ["other.example.com"]; },
  (resources) => { resources[lynxId].Properties.DistributionConfig.Origins[0].OriginPath = "/unreviewed/browser"; },
  (resources) => { resources.Unknown = resources[lynxId]; delete resources[lynxId]; },
 ]) {
  const { before, desired } = publicReleaseFixture("aliases");
  drift(before.Resources);
  assert.throws(() => api().projectPublicVisual(before, desired, "new"), /production_public_projection_invalid/);
 }
});
