"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const profile=()=>require("../tools/thn-production-profile");
test("closed profiles preserve TEST identity and approved production identity",()=>{
 const {deploymentProfile}=profile();
 assert.deepEqual(deploymentProfile("production"),{environment:"production",account:"765932874577",region:"us-east-1",branch:"main",adminHost:"admin.thehairnarrative.com",publicHost:"thehairnarrative.com",bindingId:"thn-journal-production-v2",stackName:"ZoolandingProduction-Zoolandingpage-production-Frontend",securityProfile:"thn-admin-production"});
 assert.equal(deploymentProfile("test").adminHost,"admin-test.thehairnarrative.com");
 for(const input of ["prod","dev","Production",null,{},"production "])assert.throws(()=>deploymentProfile(input),/thn_deployment_profile_invalid/);
});
test("profile values are immutable and production cannot consume TEST private release metadata",()=>{
 const {deploymentProfile,validateEnvironmentSelection}=profile();
 const p=deploymentProfile("production"); assert.equal(Object.isFrozen(p),true);
 assert.throws(()=>validateEnvironmentSelection("production",{metadata:{environment:"test"}}),/thn_private_environment_mismatch/);
});
test("production cannot be enabled with unknown future backend origins",()=>{
 const {buildThnAdminProductionFrontDoor}=require("../config/environments");
 assert.equal(buildThnAdminProductionFrontDoor({}),null);
 assert.throws(()=>buildThnAdminProductionFrontDoor({FRONTEND_PRODUCTION_THN_ADMIN_ORIGIN_ENABLED:"true"}),/production.*coordinates.*unavailable/);
});
test("production private selection uses production metadata and a distinct immutable prefix",()=>{
 const {fixture,bytes,digest}=require("./fixtures/thn-admin-selection");
 const f=fixture(); const manifest={...f.manifest,environment:"production"};
 const metadata={...f.metadata,environment:"production",manifestSha256:digest(bytes(manifest))};
 const source={FRONTEND_PRODUCTION_THN_ADMIN_ORIGIN_ENABLED:"true",FRONTEND_PRODUCTION_THN_ADMIN_MANIFEST_BASE64:bytes(manifest).toString("base64"),FRONTEND_PRODUCTION_THN_ADMIN_RELEASE_METADATA_JSON:JSON.stringify(metadata)};
 const {selectThnAdminRelease,validateSelection}=require("../tools/thn-admin-release");
 const selected=selectThnAdminRelease(source,"production");
 assert.equal(selected.metadata.environment,"production");
 assert.equal(selected.originPrefix,`frontend/angular-ssr/production/releases/${f.metadata.releaseId}`);
 assert.deepEqual(validateSelection(selected,"production"),selected);
 assert.throws(()=>validateSelection(selected,"test"),/thn_admin_release_invalid/);
 assert.throws(()=>selectThnAdminRelease({...source,FRONTEND_PRODUCTION_THN_ADMIN_RELEASE_METADATA_JSON:JSON.stringify(f.metadata)},"production"),/thn_admin_release_invalid/);
 assert.throws(()=>selectThnAdminRelease(source,"prod"),/thn_deployment_profile_invalid/);
});
test("production private host cannot silently become an ordinary public distribution",()=>{
 const cdk=require("aws-cdk-lib");
 const {FrontendStack}=require("../lib/stacks/frontend-stack");
 const {environments}=require("../config/environments");
 const base=environments.find(item=>item.name==="production");
 const environment={...base,frontendHosting:{...base.frontendHosting,releaseId:"fixture-production",serverBundleKey:"fixture/server/ssr-handler.zip",staticPrefix:"fixture/browser",frontDoors:[{id:"unprotected-admin",domainName:"admin.thehairnarrative.com"}]}};
 assert.throws(()=>new FrontendStack(new cdk.App(),"ProductionUnprotectedAdmin",{env:{account:base.account,region:base.region},environment}),/security profile/);
});

function originsFixture(){
 const specs={thnAuthAdmin:["zoolanding-auth-admin-prod","ThnAuthAdminV2Api","AWS::ApiGatewayV2::Api","prod","padmin0001"],thnAuthRuntime:["zoolanding-thn-auth-runtime-production","ThnRuntimeApi","AWS::ApiGateway::RestApi","Prod","pruntime01"],contentHub:["zoolanding-content-hub-prod","ContentHubApi","AWS::ApiGatewayV2::Api","prod","phubapi001"]};
 return {schemaVersion:1,environment:"production",account:"765932874577",region:"us-east-1",owners:Object.fromEntries(Object.entries(specs).map(([k,[stackName,logicalId,type,stage,apiId]])=>[k,{stackId:`arn:aws:cloudformation:us-east-1:765932874577:stack/${stackName}/12345678-abcd-1234-abcd-123456789abc`,stackStatus:"UPDATE_COMPLETE",processedTemplateSha256:"a".repeat(64),resourceInventorySha256:"b".repeat(64),stageParameters:{},resources:[{LogicalResourceId:logicalId,ResourceType:type,PhysicalResourceId:apiId}],processedTemplate:{Resources:{[logicalId]:{Type:type},Stage:{Type:type==="AWS::ApiGateway::RestApi"?"AWS::ApiGateway::Stage":"AWS::ApiGatewayV2::Stage",Properties:{[type==="AWS::ApiGateway::RestApi"?"RestApiId":"ApiId"]:{Ref:logicalId},StageName:stage}}}}}]))};
}
test("production origins derive from exact native owning stacks and API stage resources",()=>{
 const {validateProductionOrigins}=require("../tools/thn-production-origins");
 const f=originsFixture(),v=validateProductionOrigins(f);
 assert.equal(v.thnAuthAdmin.originPath,"/prod");assert.equal(v.thnAuthRuntime.originPath,"/Prod");
 for(const mutate of [x=>x.environment="test",x=>x.owners.thnAuthAdmin.resources[0].PhysicalResourceId="d6h2nzsn0i",x=>x.owners.thnAuthAdmin.stackId=x.owners.contentHub.stackId,x=>x.owners.thnAuthRuntime.processedTemplate.Resources.Stage.Properties.StageName="prod",x=>x.owners.contentHub.extra=true]){const bad=structuredClone(f);mutate(bad);assert.throws(()=>validateProductionOrigins(bad),/production_owner_snapshot_invalid/);}
});
test("production admin positive synth keeps exact production origins and server-owned environment",()=>{
 const {fixture,bytes,digest}=require("./fixtures/thn-admin-selection");const f=fixture();const manifest={...f.manifest,environment:"production"},metadata={...f.metadata,environment:"production",manifestSha256:digest(bytes(manifest))};
 const source={FRONTEND_PRODUCTION_THN_ADMIN_ORIGIN_ENABLED:"true",FRONTEND_PRODUCTION_THN_ADMIN_MANIFEST_BASE64:bytes(manifest).toString("base64"),FRONTEND_PRODUCTION_THN_ADMIN_RELEASE_METADATA_JSON:JSON.stringify(metadata),FRONTEND_PRODUCTION_THN_ADMIN_CERTIFICATE_ARN:"arn:aws:acm:us-east-1:765932874577:certificate/11111111-1111-1111-1111-111111111111",FRONTEND_PRODUCTION_THN_ADMIN_HOSTED_ZONE_ID:"Z08032292DKYZ4QGCIZDR",FRONTEND_PRODUCTION_THN_ADMIN_ROUTE53_RECORDS_ENABLED:"true",FRONTEND_PRODUCTION_THN_ADMIN_OWNER_SNAPSHOT_JSON:JSON.stringify(originsFixture())};
 const {buildThnAdminProductionFrontDoor,environments}=require("../config/environments"),door=buildThnAdminProductionFrontDoor(source);
 assert.equal(door.domainName,"admin.thehairnarrative.com");assert.equal(door.backendRoutes[0].domainName,"pruntime01.execute-api.us-east-1.amazonaws.com");
 const cdk=require("aws-cdk-lib"),{Template}=require("aws-cdk-lib/assertions"),{FrontendStack}=require("../lib/stacks/frontend-stack");
 const base=environments.find(x=>x.name==="production"),environment={...base,frontendHosting:{...base.frontendHosting,releaseId:"current-production",serverBundleKey:"current/server.zip",staticPrefix:"current/browser",thnAdminCertificate:{certificateArn:source.FRONTEND_PRODUCTION_THN_ADMIN_CERTIFICATE_ARN,hostedZoneId:"Z08032292DKYZ4QGCIZDR"},frontDoors:[door]}};
 const t=Template.fromStack(new FrontendStack(new cdk.App(),"ProductionAdminProfile",{env:{account:base.account,region:base.region},environment})).toJSON();
 const fn=Object.values(t.Resources).find(x=>x.Type==="AWS::Lambda::Function"&&x.Properties.FunctionName==="zoolandingpage-production-frontend-thn-admin-ssr");
 if(process.env.THN_SYNTH_FIXTURE_OUTPUT) require("node:fs").writeFileSync(process.env.THN_SYNTH_FIXTURE_OUTPUT,JSON.stringify(t,null,2));
 assert.equal(fn.Properties.Environment.Variables.THN_DEPLOYMENT_ENVIRONMENT,"production");assert.equal(fn.Properties.Environment.Variables.ZLP_RUNTIME_ENV,"production");assert.ok(t.Resources.ThnAdminProductionCertificate);
 assert.equal(t.Resources.ThnAdminProductionCertificate.DeletionPolicy,"Retain");
 const records=Object.values(t.Resources).filter(r=>r.Type==="AWS::Route53::RecordSet");assert.equal(records.length,2);assert.ok(records.every(r=>r.DeletionPolicy==="Retain"&&r.Properties.Name==="admin.thehairnarrative.com."));
});
