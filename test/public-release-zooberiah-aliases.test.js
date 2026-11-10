"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const api=require("../tools/thn-production-frontend-release"),cert=require("../tools/thn-production-certificate-release");
test("public release keeps the complete native baseline without reading private backend owners",()=>{
 const f=require("./fixtures/thn-production-selection").productionFixture();
 const legacy=structuredClone(f.input);
 f.input.purpose="public-visual";f.input.ownerSnapshot=null;f.input.certificateArn=null;
 api.validateInput(f.input);
 assert.throws(()=>api.validateInput({...f.input,ownerSnapshot:legacy.ownerSnapshot}),/production_frontend_input_invalid/);
 assert.throws(()=>api.validateInput({...legacy,ownerSnapshot:null}),/production_owner_snapshot_invalid/);
 const prior=cert.readProductionBaseline;
 const baseline={terminationProtection:true,templates:{Original:{Resources:{Retained:{Type:"AWS::S3::Bucket"}}}},resources:[{LogicalResourceId:"Shared",ResourceType:"AWS::Lambda::Function",PhysicalResourceId:"zoolandingpage-production-frontend-ssr"}]};
 try{
  cert.readProductionBaseline=()=>structuredClone(baseline);
  const actual=api.selectedBaseline((kind,service,operation)=>{
   assert.equal(service,"lambda");assert.equal(operation,"get-function-configuration");
   return {FunctionName:"zoolandingpage-production-frontend-ssr",State:"Active",LastUpdateStatus:"Successful",Environment:{Variables:{ZLP_RELEASE_ID:f.input.publicReleaseId}}};
  },f.input);
  assert.deepEqual(actual.templates,baseline.templates);assert.deepEqual(actual.resources,baseline.resources);
 }finally{cert.readProductionBaseline=prior;}
});
test("public release compiler preserves the active Zooberiah aliases in the scoped projection",()=>{
 const f=require("./fixtures/thn-production-selection").productionFixture();
 f.input.purpose="public-visual";
 f.input.ownerSnapshot=null;
 f.input.certificateArn=null;
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"public-alias-release-"));
 try{
  api.prepareFrontend(f.input,dir);
  const desired=JSON.parse(fs.readFileSync(path.join(dir,"desired-template.json")));
  const entries=Object.entries(desired.Resources).filter(([,r])=>r.Type==="AWS::CloudFront::Distribution"&&r.Properties.DistributionConfig.Aliases?.includes("zooberiahsystems.com"));
  assert.equal(entries.length,1,"the release candidate must retain the active ZooBeriah alias phase");
  assert.equal(Object.values(desired.Resources).some(r=>r.Type==="AWS::Lambda::Function"&&r.Properties.FunctionName==="zoolandingpage-production-frontend-thn-admin-ssr"),false);
  const [id,distribution]=entries[0];
  assert.deepEqual(distribution.Properties.DistributionConfig.Aliases,["zooberiahsystems.com","www.zooberiahsystems.com"]);
  const before=structuredClone(desired);
  const fn=Object.values(before.Resources).find(r=>r.Type==="AWS::Lambda::Function"&&r.Properties.FunctionName==="zoolandingpage-production-frontend-ssr");
  fn.Properties.Code.S3Key="frontend/angular-ssr/production/releases/old/server/ssr-handler.zip";
  fn.Properties.Environment.Variables.ZLP_RELEASE_ID="old";
  for(const r of Object.values(before.Resources))if(r.Type==="AWS::CloudFront::Distribution")for(const origin of r.Properties.DistributionConfig.Origins||[])if(origin.DomainName==="assets.zoolandingpage.com.mx")origin.OriginPath="/frontend/angular-ssr/production/releases/old/browser";
  const projected=require("../tools/thn-production-frontend-projection").projectPublicVisual(before,desired,f.input.selection.metadata.releaseId);
  const expected=structuredClone(before);
  for(const [key,r] of Object.entries(expected.Resources)){
   if(r.Type==="AWS::Lambda::Function"&&r.Properties.FunctionName==="zoolandingpage-production-frontend-ssr"){
    r.Properties.Code=structuredClone(desired.Resources[key].Properties.Code);
    r.Properties.Environment.Variables.ZLP_RELEASE_ID=f.input.selection.metadata.releaseId;
   }
   if(r.Type==="AWS::CloudFront::Distribution"&&!r.Properties.DistributionConfig.Aliases?.includes("admin.thehairnarrative.com"))for(const o of r.Properties.DistributionConfig.Origins)if(o.DomainName==="assets.zoolandingpage.com.mx")o.OriginPath=`/frontend/angular-ssr/production/releases/${f.input.selection.metadata.releaseId}/browser`;
   if(r.Type==="AWS::SSM::Parameter"&&["release-id","static-prefix","server-bundle-key"].some(s=>r.Properties.Name==="/zoolandingpage/production/frontend/"+s))r.Properties.Value=desired.Resources[key].Properties.Value;
  }
  if(expected.Outputs?.FrontendReleaseId)expected.Outputs.FrontendReleaseId.Value=f.input.selection.metadata.releaseId;
  assert.deepEqual(projected,expected);
  assert.deepEqual(projected.Resources[id].Properties.DistributionConfig.Aliases,before.Resources[id].Properties.DistributionConfig.Aliases);
 }finally{fs.rmSync(dir,{recursive:true});}
});
