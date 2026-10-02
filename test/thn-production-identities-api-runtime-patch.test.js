"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../tools/thn-production-identities");
const manifest=require("../tools/production/thn-deployment-identities.json");
const prior=require("./fixtures/thn-api-identities-before.json");
const cert=require("../tools/thn-production-certificate-release");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const POOL="arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_synthetic";
function baseline(){
 const before=api.compose(null,manifest);
 for(const [id,resource] of Object.entries(prior))before.Resources[id]=structuredClone(resource);
 delete before.Resources.ApiRuntimeRole;
 return before;
}
function native(){
 return {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",Parameters:[{ParameterKey:"ThnProductionOwnerPoolArn",ParameterValue:POOL}],Changes:[
  {Type:"Resource",ResourceChange:{Action:"Add",LogicalResourceId:"ApiRuntimeRole",ResourceType:"AWS::IAM::Role"}},
  ...["ApiCfnNativePolicy0","ApiGithubReleasePolicy"].map(id=>({Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:id,ResourceType:manifest.template.Resources[id].Type,Replacement:"False",PhysicalResourceId:id,Scope:["Properties"],Details:[{Target:{Attribute:"Properties",Name:"PolicyDocument",RequiresRecreation:"Never"},ChangeSource:"DirectModification",Evaluation:"Static"}]}}))
 ]};
}
const existing=["ApiCfnNativePolicy0","ApiGithubReleasePolicy"].map(id=>({LogicalResourceId:id,PhysicalResourceId:id,ResourceType:manifest.template.Resources[id].Type}));
function allowIam(input){return {EvaluationResults:input.ActionNames.map(action=>({EvalActionName:action,EvalResourceName:input.ResourceArns[0],EvalDecision:"allowed",MissingContextValues:[]}))};}
test("API runtime role permission preflight uses exact resources and fails closed",()=>{
 const observed=[],candidate=api.composeApiRuntimeRolePatch(baseline(),manifest);
 const call=(kind,service,operation,input)=>{
  assert.deepEqual([kind,service,operation],["lookup","iam","simulate-principal-policy"]);
  cert.assertProductionOperation(kind,service,operation,input);
  observed.push(input);return allowIam(input);
 };
 const proof=api.apiRuntimeRolePermissionProof(call,candidate);
 assert.equal(proof.requests.length,3);
 assert.deepEqual(new Set(observed.map(x=>x.ResourceArns[0])),new Set([
  "arn:aws:iam::765932874577:role/zlp-thn-auth-runtime-prod-role",
  "arn:aws:iam::765932874577:policy/ThnProductionApiNative0",
  "arn:aws:iam::765932874577:role/zoolanding-deployer-thn-auth-runtime-production-github-deploy",
 ]));
 for(const input of observed){
  const wrongAction={...input,ActionNames:[...input.ActionNames,"iam:DeleteRole"]};
  const wrongRole={...input,PolicySourceArn:"arn:aws:iam::765932874577:role/other"};
  const wrongResource={...input,ResourceArns:[input.ResourceArns[0]+"-other"]};
  for(const changed of [wrongAction,wrongRole,wrongResource]){
   assert.throws(()=>cert.assertProductionOperation("lookup","iam","simulate-principal-policy",changed),/production_operation_out_of_scope/);
  }
 }
 const denied=(kind,service,operation,input)=>{
  const result=allowIam(input);result.EvaluationResults[0].EvalDecision="implicitDeny";return result;
 };
 assert.throws(()=>api.apiRuntimeRolePermissionProof(denied,candidate),/production_identities_api_runtime_permissions_invalid/);
});
test("API identity patch changes only one retained runtime role and two exact policies",()=>{
 assert.equal(typeof api.composeApiRuntimeRolePatch,"function");
 assert.equal(typeof api.reviewApiRuntimeRoleInventory,"function");
 const old=baseline(),candidate=api.composeApiRuntimeRolePatch(old,manifest),expected=api.compose(null,manifest);
 assert.equal(cert.canonical(candidate),cert.canonical(expected));
 assert.equal(api.reviewApiRuntimeRoleInventory(old,candidate,native(),manifest,POOL,existing).length,3);
 const explicitFalse=native();explicitFalse.Changes[0].ResourceChange.Replacement="False";
 assert.equal(api.reviewApiRuntimeRoleInventory(old,candidate,explicitFalse,manifest,POOL,existing).length,3);
 const emptyDetails=native();emptyDetails.Changes[0].ResourceChange.Scope=[];emptyDetails.Changes[0].ResourceChange.Details=[];
 assert.equal(api.reviewApiRuntimeRoleInventory(old,candidate,emptyDetails,manifest,POOL,existing).length,3);
 const unrelated=structuredClone(old);unrelated.Resources.HubCfnNativePolicy2.Properties.ManagedPolicyName="changed";
 assert.throws(()=>api.composeApiRuntimeRolePatch(unrelated,manifest),/production_identities_api_runtime_baseline_invalid/);
 for(const mutation of [
  changes=>changes.pop(),
  changes=>changes[0].ResourceChange.Replacement="Conditional",
  changes=>changes[0].ResourceChange.Scope=["Properties"],
  changes=>changes[1].ResourceChange.Details[0].Target.Name="ManagedPolicyName",
 ]){
  const changed=native();mutation(changed.Changes);
  assert.throws(()=>api.reviewApiRuntimeRoleInventory(old,candidate,changed,manifest,POOL,existing),/production_identities_api_runtime_inventory_invalid/);
 }
});
test("API identity review creates only a retained three-resource preview",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-api-identity-review-"));
 const old=baseline(),changes=native().Changes,stackId=`arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`;
 const state={stackId,templates:{Original:old,Processed:old},resources:existing,parameters:[{ParameterKey:"ThnProductionOwnerPoolArn",ParameterValue:POOL}],terminationProtection:false,ownerPool:{arn:POOL},externalRoles:{},newRoles:{},packageBucket:{exists:true}};
 let candidate,preview,uploads=0,denyIam=true;const objects=new Map();
 const call=(kind,service,operation,input,file)=>{
  cert.assertProductionOperation(kind,service,operation,input);
  const key=service+":"+operation;
  if(key==="s3api:list-objects-v2")return {Contents:[]};
  if(key==="iam:simulate-principal-policy"){
   const result=allowIam(input);if(denyIam)result.EvaluationResults[0].EvalDecision="implicitDeny";
   return result;
  }
  if(key==="s3api:put-object"){const bytes=fs.readFileSync(input.Body);objects.set(input.Key,bytes);if(input.Body.endsWith("candidate.json"))candidate=JSON.parse(bytes);uploads++;return {VersionId:"v1"};}
  if(key==="s3api:get-object"){fs.writeFileSync(file,objects.get(input.Key));return {VersionId:"v1"};}
  if(key==="cloudformation:create-change-set"){
   assert.equal(input.ChangeSetType,"UPDATE");assert.deepEqual(input.Parameters,state.parameters);
   preview={...native(),StackId:stackId,ChangeSetId:`arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,CreationTime:new Date().toISOString()};
   return {Id:preview.ChangeSetId};
  }
  if(key==="cloudformation:describe-change-set")return preview;
  if(key==="cloudformation:get-template")return {TemplateBody:candidate};
  throw Error("unexpected_call:"+key);
 };
 try{
  const options={call,manifest,sourceSha:"a".repeat(40),fingerprint:"b".repeat(64),execution:"review",scope:"api-runtime-role-patch",runId:"123-1",outputPath:path.join(dir,"review.json"),captureBaseline:()=>structuredClone(state)};
  await assert.rejects(api.runIdentities(options),/production_identities_api_runtime_permissions_invalid/);
  assert.equal(uploads,0);
  denyIam=false;
  const record=await api.runIdentities(options);
  assert.equal(record.changes.length,3);assert.equal(uploads,3);
 }finally{fs.rmSync(dir,{recursive:true});}
});
test("API identity postcheck requires exact role and policy hashes",()=>{
 assert.equal(typeof api.verifyApiRuntimeRolePost,"function");
 const candidate=api.compose(null,manifest),old=baseline();
 const github="zoolanding-deployer-thn-auth-runtime-production-github-deploy",cfn="zoolanding-deployer-thn-auth-runtime-production-cfn-exec",runtime="zlp-thn-auth-runtime-prod-role";
 const policyArn="arn:aws:iam::765932874577:policy/ThnProductionApiNative0";
 const inline="inline:ThnRetainedProductionReleaseV1";
 const oldSize=Buffer.byteLength(cert.canonical(old.Resources.ApiGithubReleasePolicy.Properties.PolicyDocument));
 const newSize=Buffer.byteLength(cert.canonical(candidate.Resources.ApiGithubReleasePolicy.Properties.PolicyDocument));
 assert.notEqual(oldSize,newSize);
 const before={templates:{Original:old,Processed:old},resources:existing,terminationProtection:false,parameters:[{ParameterKey:"ThnProductionOwnerPoolArn",ParameterValue:POOL}],newRoles:{[github]:{roleId:"github-id",boundary:null,trust:{sealed:true},policies:{[inline]:"old"},policySizes:{[inline]:oldSize}},[cfn]:{roleId:"cfn-id",boundary:null,trust:{sealed:true},policies:{[policyArn]:"old"},policySizes:{}},[runtime]:null}};
 const after=structuredClone(before);after.templates={Original:candidate,Processed:candidate};
 after.resources.push({LogicalResourceId:"ApiRuntimeRole",PhysicalResourceId:runtime,ResourceType:"AWS::IAM::Role"});
 after.newRoles[github].policies[inline]=cert.sha(cert.canonical(candidate.Resources.ApiGithubReleasePolicy.Properties.PolicyDocument));
 after.newRoles[github].policySizes[inline]=newSize;
 after.newRoles[cfn].policies[policyArn]=cert.sha(cert.canonical(candidate.Resources.ApiCfnNativePolicy0.Properties.PolicyDocument));
 after.newRoles[runtime]={roleId:"runtime-id",boundary:null,trust:candidate.Resources.ApiRuntimeRole.Properties.AssumeRolePolicyDocument,policies:{"inline:ThnExactProductionRegistryRuntimeRead":cert.sha(cert.canonical(candidate.Resources.ApiRuntimeRole.Properties.Policies[0].PolicyDocument))},policySizes:{"inline:ThnExactProductionRegistryRuntimeRead":Buffer.byteLength(cert.canonical(candidate.Resources.ApiRuntimeRole.Properties.Policies[0].PolicyDocument))}};
 assert.equal(api.verifyApiRuntimeRolePost(before,after,candidate),true);
 const widened=structuredClone(after);widened.newRoles[runtime].policies["inline:Unexpected"]="extra";
 assert.throws(()=>api.verifyApiRuntimeRolePost(before,widened,candidate),/production_identities_api_runtime_post_mismatch/);
});
