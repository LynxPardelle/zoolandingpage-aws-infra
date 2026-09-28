"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const api=require("../tools/thn-production-frontend-release"),cert=require("../tools/thn-production-certificate-release");
test("versioned production package reader rejects invalid coordinates and absent VersionId without fabricating public versions",()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-reader-test-")),key="frontend/angular-ssr/production/releases/release/browser/main-12345678.js";
 const call=(kind,service,operation,input,file)=>{if(operation==="head-object")return {ETag:"etag"};fs.writeFileSync(file,"image");return {ETag:"etag"};};
 try{assert.throws(()=>api.getObject(call,"zoolandingpage-production-frontend-artifacts-765932874577",key,dir),/production_release_object_unversioned/);const read=api.getObject(call,"zoolandingpage-public-files",key,dir);assert.equal(read.versionId,undefined);assert.equal(read.bytes.toString(),"image");assert.throws(()=>api.getObject(call,"zoolandingpage-public-files",key+"/../secret",dir),/production_release_object_invalid/);}finally{fs.rmSync(dir,{recursive:true});}
});
test("frontend driver retains one native preview, seals recovery bytes and blocks source or baseline drift before applying",async()=>{
 const f=require("./fixtures/thn-production-selection").productionFixture(),project=require("../tools/thn-production-frontend-projection"),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-driver-test-"));
 try{
  api.prepareFrontend(f.input,dir);const desired=JSON.parse(fs.readFileSync(path.join(dir,"desired-template.json"))),original=structuredClone(desired);
  for(const [id,r] of Object.entries(original.Resources))if(project.privateResource(id,r))delete original.Resources[id];
  delete original.Parameters.ThnAdminAuthAdminOriginVerifySecret;
  const [publicId,publicFn]=Object.entries(original.Resources).find(([,r])=>r.Type==="AWS::Lambda::Function"&&r.Properties.FunctionName==="zoolandingpage-production-frontend-ssr");
  const oldZip=Buffer.from("old active production zip"),oldKey=publicFn.Properties.Code.S3Key;f.objects.set(oldKey,oldZip);
  const before={stackId:`arn:aws:cloudformation:us-east-1:765932874577:stack/${cert.STACK}/11111111-1111-1111-1111-111111111111`,templates:{Original:original,Processed:original},parameters:[],resources:[],trust:{policy:"sealed"},lambdas:{[publicId]:{CodeSha256:Buffer.from(cert.sha(oldZip),"hex").toString("base64")}},authorizerEvidence:{currentOriginSha256:cert.sha("x".repeat(43))}};
  let preview,candidate,drift=false,executions=0,sourceStale=false;const writes=[];
  const call=(kind,service,operation,input,file)=>{
   const key=service+":"+operation;
   if(key==="s3api:list-objects-v2")return {Contents:[]};
   if(key==="s3api:put-object"){assert.equal(input.IfNoneMatch,"*");writes.push(key);f.objects.set(input.Key,fs.readFileSync(input.Body));return {VersionId:"v1"};}
   if(key==="s3api:head-object")return {VersionId:input.Bucket==="zoolandingpage-public-files"?undefined:"v1",ETag:"sealed"};
   if(key==="s3api:get-object"){assert(f.objects.has(input.Key),input.Key);fs.writeFileSync(file,f.objects.get(input.Key));return {VersionId:input.Bucket==="zoolandingpage-public-files"?undefined:"v1",ETag:"sealed"};}
   if(key==="cloudformation:create-change-set"){
    writes.push(key);assert.equal(input.ChangeSetType,"UPDATE");const objectKey=new URL(input.TemplateURL).pathname.slice(1);candidate=JSON.parse(f.objects.get(objectKey));
    const changes=Object.entries(candidate.Resources).filter(([id,r])=>cert.canonical(original.Resources[id])!==cert.canonical(r)).map(([id,r])=>({Type:"Resource",ResourceChange:{Action:original.Resources[id]?"Modify":"Add",LogicalResourceId:id,ResourceType:r.Type,Replacement:"False",Scope:["Properties"]}}));
    preview={StackId:before.stackId,ChangeSetId:`arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",CreationTime:new Date().toISOString(),Parameters:[],Changes:changes};return {Id:preview.ChangeSetId};
   }
   if(key==="cloudformation:describe-change-set")return preview;
   if(key==="cloudformation:get-template")return {TemplateBody:candidate};
   if(key==="cloudformation:execute-change-set"){assert.equal(input.ChangeSetName,preview.ChangeSetId);executions++;throw Error("test_apply_boundary");}
   throw Error("unexpected_call:"+key);
  };
  const options={call,input:f.input,desired,runId:"123-1",fingerprint:"c".repeat(64),originSecret:"x".repeat(43),outputPath:path.join(dir,"review.json"),captureBaseline:()=>({...structuredClone(before),...(drift?{unreviewedChange:true}:{})}),verifySource:()=>{if(sourceStale)throw Error("production_source_changed");}};
  const record=await api.runFrontendOperation({...options,execution:"review"});assert.equal(executions,0);assert.equal(record.recoveryCoordinates.length,2);
  const recovery=JSON.parse(f.objects.get(record.recoveryCoordinates[0].key));assert.equal(recovery.Resources[publicId].Properties.Code.S3ObjectVersion,"v1");
  drift=true;await assert.rejects(()=>api.runFrontendOperation({...options,execution:"execute",record,approvedDigest:record.digest}),/retained_review_stale/);assert.equal(executions,0);
  drift=false;sourceStale=true;await assert.rejects(()=>api.runFrontendOperation({...options,execution:"execute",record,approvedDigest:record.digest}),/production_source_changed/);assert.equal(executions,0);
  sourceStale=false;await assert.rejects(()=>api.runFrontendOperation({...options,execution:"execute",record,approvedDigest:record.digest}),/test_apply_boundary/);assert.equal(executions,1);
  assert.equal(writes.filter(x=>x==="cloudformation:create-change-set").length,1);assert.equal(writes.filter(x=>x==="s3api:put-object").length,3);
 }finally{fs.rmSync(dir,{recursive:true});}
});
test("production compiler generates a scoped private candidate from closed source contracts",()=>{
 const {productionFixture}=require("./fixtures/thn-production-selection"),f=productionFixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-production-compile-"));
 try{const result=api.prepareFrontend(f.input,dir),desired=JSON.parse(fs.readFileSync(path.join(dir,"desired-template.json")));assert.match(result.desiredTemplateSha256,/^[a-f0-9]{64}$/);
 const project=require("../tools/thn-production-frontend-projection"),before=structuredClone(desired);for(const [id,r] of Object.entries(before.Resources))if(project.privateResource(id,r))delete before.Resources[id];
 const projected=project.projectPrivateFrontdoor(before,desired,f.input.selection.metadata.releaseId);assert.ok(projected.Resources.FrontendThnAdminSsrFunction874373CC);assert.equal(desired.Resources.FrontendThnAdminSsrFunction874373CC.Properties.Environment.Variables.THN_DEPLOYMENT_ENVIRONMENT,"production");assert.deepEqual(desired.Resources.FrontendDistributionThehairnarrativeAdminProductionF99395A3.Properties.DistributionConfig.Aliases,["admin.thehairnarrative.com"]);assert.throws(()=>api.validateInput({...f.input,purpose:"production-all"}),/production_frontend_input_invalid/);}finally{fs.rmSync(dir,{recursive:true});}
});
test("published proof reads exact versioned production package plus public bytes and rejects a mismatched browser asset",async()=>{
 const f=require("./fixtures/thn-production-selection").productionFixture(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-published-test-"));let corrupt=false;
 const call=(kind,service,operation,input,file)=>{const publicBucket=input.Bucket==="zoolandingpage-public-files",version=publicBucket?undefined:"version1";if(operation==="head-object")return {ETag:"etag",VersionId:version};const data=f.objects.get(input.Key);assert.ok(data,"unexpected object");fs.writeFileSync(file,corrupt&&publicBucket?Buffer.from("broken"):data);return {ETag:"etag",VersionId:version};};
 try{const p=await api.publishedProof(call,f.input,dir);assert.equal(p.codeVersionId,"version1");assert.equal(p.assets.length,5);assert.match(p.browserSha256,/^[a-f0-9]{64}$/);corrupt=true;await assert.rejects(()=>api.publishedProof(call,f.input,dir),/production_release_browser_mismatch/);}finally{fs.rmSync(dir,{recursive:true});}
});
