"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),api=require("../tools/thn-production-identities");
function fixture(){
 const Resources={};let i=0;for(const name of api.NEW_ROLES){const github=name.endsWith("github-deploy"),repo=name.includes("image-upload")?"zoolanding-image-upload":"zoolanding-api-proxy";Resources["Role"+(i++)]={Type:"AWS::IAM::Role",DeletionPolicy:"Retain",UpdateReplacePolicy:"Retain",Properties:{RoleName:name,AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:github?"sts:AssumeRoleWithWebIdentity":"sts:AssumeRole",Principal:github?{Federated:"arn:aws:iam::765932874577:oidc-provider/token.actions.githubusercontent.com"}:{Service:"cloudformation.amazonaws.com"},...(github?{Condition:{StringEquals:{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com","token.actions.githubusercontent.com:sub":`repo:LynxPardelle/${repo}:environment:production`}}}:{})}]}}};}
 return {schemaVersion:1,environment:"production",account:"765932874577",region:"us-east-1",template:{Resources},externalRolePolicyBaselines:{},providerSchemaHashes:{},proofMatrix:[],sourceCandidateHashes:{}};
}
test("bootstrap keeps deployment identities in a separate add-only stack and rejects broadening or replacement",()=>{
 const f=fixture();assert.equal(api.validateManifest(f),f);const candidate=api.compose(null,f),Changes=Object.entries(candidate.Resources).map(([id,r])=>({Type:"Resource",ResourceChange:{Action:"Add",LogicalResourceId:id,ResourceType:r.Type,Replacement:"False"}})),native={Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",Changes};assert.equal(api.reviewInventory(null,candidate,native),Changes);
 assert.throws(()=>api.reviewInventory(null,candidate,{...native,Changes:[{...Changes[0],ResourceChange:{...Changes[0].ResourceChange,Action:"Modify"}},...Changes.slice(1)]}),/inventory_invalid/);
 const before=structuredClone(candidate);before.Resources.Role0.Properties.MaxSessionDuration=1234;assert.throws(()=>api.compose(before,f),/existing_change_forbidden/);
});
test("a GitHub deployment role cannot acquire private data-plane permissions from inline or attached policies",()=>{
 const f=fixture(),role=Object.values(f.template.Resources).find(r=>r.Properties.RoleName.endsWith("github-deploy"));role.Properties.Policies=[{PolicyName:"UnapprovedDataAccess",PolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"dynamodb:GetItem",Resource:"arn:aws:dynamodb:us-east-1:765932874577:table/private"}]}}];assert.throws(()=>api.validateManifest(f),/deployment_data_plane_forbidden/);
});
module.exports.fixture=fixture;
test("CREATE bootstrap retains its exact reviewed native ARN and refuses a stale grant inventory before execute",async()=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-identities-test-")),manifest=fixture();
 let preview,candidate,bytes,drift=false,executes=0;const writes=[];
 const stackId=`arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`;
 const baseline={stackId:null,templates:null,resources:[],newRoles:{},externalRoles:{},ownerPool:{arn:"BLOCKED",nativeIdentitySha256:"a".repeat(64)}};
 const call=(kind,service,operation,input,file)=>{
  const key=service+":"+operation;
  if(key==="s3api:list-objects-v2")return {Contents:[]};
  if(key==="s3api:put-object"){writes.push(key);bytes=fs.readFileSync(input.Body);candidate=JSON.parse(bytes);return {VersionId:"v1"};}
  if(key==="s3api:get-object"){fs.writeFileSync(file,bytes);return {VersionId:"v1"};}
  if(key==="cloudformation:create-change-set"){
   assert.equal(input.ChangeSetType,"CREATE");assert.equal(input.StackName,api.STACK);writes.push(key);
   preview={StackId:stackId,ChangeSetId:`arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",CreationTime:new Date().toISOString(),Parameters:[],Changes:Object.entries(candidate.Resources).map(([id,r])=>({Type:"Resource",ResourceChange:{Action:"Add",LogicalResourceId:id,ResourceType:r.Type,Replacement:"False"}}))};return {Id:preview.ChangeSetId,StackId:stackId};
  }
  if(key==="cloudformation:describe-change-set")return preview;
  if(key==="cloudformation:get-template")return {TemplateBody:candidate};
  if(key==="cloudformation:execute-change-set"){assert.equal(input.ChangeSetName,preview.ChangeSetId);executes++;throw Error("test_apply_boundary");}
  throw Error("unexpected_call:"+key);
 };
 try{
  const options={call,manifest,sourceSha:"a".repeat(40),fingerprint:"b".repeat(64),runId:"123-1",outputPath:path.join(dir,"record.json"),captureBaseline:(c,m,id)=>({...structuredClone(baseline),stackId:id||null,...(drift?{unreviewedGrant:true}:{})})};
  const record=await api.runIdentities({...options,execution:"review"});assert.equal(executes,0);assert.equal(record.stackId,stackId);
  drift=true;await assert.rejects(()=>api.runIdentities({...options,execution:"execute",record,approvedDigest:record.digest}),/retained_review_stale/);assert.equal(executes,0);
  drift=false;await assert.rejects(()=>api.runIdentities({...options,execution:"execute",record,approvedDigest:record.digest}),/test_apply_boundary/);assert.equal(executes,1);assert.equal(writes.filter(k=>k==="cloudformation:create-change-set").length,1);assert.equal(writes.filter(k=>k==="s3api:put-object").length,1);
 }finally{fs.rmSync(dir,{recursive:true});}
});
