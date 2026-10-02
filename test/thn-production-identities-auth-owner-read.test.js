"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=require("../tools/thn-production-identities");
const manifest=require("../tools/production/thn-deployment-identities.json");
const cert=require("../tools/thn-production-certificate-release");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");

const ID="AuthGithubReleasePolicy",ROLE="zoolanding-auth-admin-production-deploy";
const AUTH_STACK="arn:aws:cloudformation:us-east-1:765932874577:stack/zoolanding-auth-admin-prod/11111111-1111-1111-1111-111111111111";
const functionArn="arn:aws:lambda:us-east-1:765932874577:function:zoolanding-auth-admin-prod-ThnProductionOwnerOperatorV2";
const additions=[
 {Action:["iam:ListMFADevices"],Effect:"Allow",Resource:["arn:aws:iam::765932874577:user/Hector-admin"]},
 {Action:["cognito-idp:ListUsersInGroup"],Effect:"Allow",Resource:["arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_c1QxYjOiI"]},
 {Action:["iam:GetRole","iam:GetRolePolicy","iam:ListAttachedRolePolicies","iam:ListRolePolicies"],Effect:"Allow",Resource:["arn:aws:iam::765932874577:role/zoolanding-thn-owner-production-operator","arn:aws:iam::765932874577:role/zoolanding-auth-admin-prod-ThnProductionOwnerOperatorV2Role"]},
 {Action:["lambda:GetAlias","lambda:GetFunctionUrlConfig"],Effect:"Allow",Resource:[functionArn,`${functionArn}:production`]},
 {Action:["cloudformation:ListChangeSets"],Effect:"Allow",Resource:["arn:aws:cloudformation:us-east-1:765932874577:stack/zoolanding-auth-admin-prod/*"]},
];
function oldTemplate(){const old=api.compose(null,manifest);old.Resources[ID].Properties.PolicyDocument.Statement.splice(-additions.length);return old;}
function native(change={}){return {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",Parameters:[{ParameterKey:"ThnProductionOwnerPoolArn",ParameterValue:"arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_c1QxYjOiI"}],Changes:[{Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:ID,ResourceType:"AWS::IAM::Policy",PhysicalResourceId:"ThnRetainedProductionReleaseV1",Replacement:"False",Scope:["Properties"],Details:[{Target:{Attribute:"Properties",Name:"PolicyDocument",RequiresRecreation:"Never"},ChangeSource:"DirectModification",Evaluation:"Static"}],...change}}]};}

test("owner reader candidate adds only five exact read statements",()=>{
 const target=manifest.template.Resources[ID].Properties.PolicyDocument.Statement;
 assert.deepEqual(target.slice(-additions.length),additions);
 assert.equal(manifest.template.Resources[ID].Properties.Roles[0],ROLE);
 const old=oldTemplate(),candidate=api.composeAuthOwnerReadPatch(old,manifest);
 assert.equal(cert.canonical(candidate),cert.canonical(api.compose(null,manifest)));
 const altered=structuredClone(old);altered.Resources.ApiCfnNativePolicy0.Properties.ManagedPolicyName="changed";
 assert.throws(()=>api.composeAuthOwnerReadPatch(altered,manifest),/production_identities_auth_owner_read_baseline_invalid/);
});

test("owner reader inventory permits only the existing policy document change",()=>{
 const old=oldTemplate(),candidate=api.composeAuthOwnerReadPatch(old,manifest);
 const existing=[{LogicalResourceId:ID,PhysicalResourceId:"ThnRetainedProductionReleaseV1",ResourceType:"AWS::IAM::Policy"}];
 const pool=native().Parameters[0].ParameterValue;
 assert.equal(api.reviewAuthOwnerReadInventory(old,candidate,native(),existing,pool).length,1);
 for(const changed of [{Replacement:"Conditional"},{Action:"Add"},{Scope:["Properties","Metadata"]},{Details:[]}]){
  assert.throws(()=>api.reviewAuthOwnerReadInventory(old,candidate,native(changed),existing,pool),/production_identities_auth_owner_read_inventory_invalid/);
 }
});

test("shared simulator rejects widened owner read probes",()=>{
 const input={PolicySourceArn:"arn:aws:iam::765932874577:role/zoolanding-auth-admin-production-deploy",ActionNames:["iam:ListMFADevices"],ResourceArns:["arn:aws:iam::765932874577:user/Hector-admin"]};
 assert.doesNotThrow(()=>cert.assertProductionOperation("lookup","iam","simulate-principal-policy",input));
 assert.throws(()=>cert.assertProductionOperation("lookup","iam","simulate-principal-policy",{...input,ResourceArns:["*"]}),/production_operation_out_of_scope/);
 assert.throws(()=>cert.assertProductionOperation("lookup","iam","simulate-principal-policy",{...input,ActionNames:["iam:DeleteUser"]}),/production_operation_out_of_scope/);
});

test("owner read preflight checks the candidate and the CloudFormation writer before upload",()=>{
 const candidate=api.composeAuthOwnerReadPatch(oldTemplate(),manifest),seen=[];
 const call=(kind,service,operation,input)=>{
  cert.assertProductionOperation(kind,service,operation,input);
  seen.push([service,operation,input.ResourceArns?.[0]]);
  if(service==="cloudformation")return {Schema:JSON.stringify({handlers:{update:{permissions:["iam:GetRolePolicy","iam:PutRolePolicy","iam:DeleteRolePolicy"]}}})};
  return {EvaluationResults:input.ActionNames.map(a=>({EvalActionName:a,EvalResourceName:input.ResourceArns[0],EvalDecision:"allowed",MissingContextValues:[]}))};
 };
 const proof=api.authOwnerReadPermissionProof(call,candidate,AUTH_STACK);
 assert.equal(proof.requests.length,cert.ownerReadMatrix.length);
 assert.equal(seen.filter(x=>x[1]==="simulate-custom-policy").length,cert.ownerReadMatrix.length);
 assert.equal(seen.filter(x=>x[1]==="simulate-principal-policy").length,1);
 const denied=(...args)=>{const result=call(...args);if(args[2]==="simulate-custom-policy")result.EvaluationResults[0].EvalDecision="implicitDeny";return result;};
 assert.throws(()=>api.authOwnerReadPermissionProof(denied,candidate,AUTH_STACK),/production_identities_auth_owner_read_permissions_invalid/);
});

test("owned Auth policy is excluded from external role baselines using the deployed version",()=>{
 const old=oldTemplate(),next=api.composeAuthOwnerReadPatch(old,manifest);
 const owned=[{LogicalResourceId:ID,ResourceType:"AWS::IAM::Policy"}];
 const name="inline:ThnRetainedProductionReleaseV1";
 const before=api.ownedInlinePolicyHashes(old,owned,ROLE,"BLOCKED");
 const after=api.ownedInlinePolicyHashes(next,owned,ROLE,"BLOCKED");
 assert.equal(before[name],cert.sha(cert.canonical(old.Resources[ID].Properties.PolicyDocument)));
 assert.equal(after[name],cert.sha(cert.canonical(next.Resources[ID].Properties.PolicyDocument)));
 assert.notEqual(before[name],after[name]);
});

test("owner read review rejects denied IAM proof before S3 upload",async()=>{
 const old=oldTemplate(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-owner-read-"));
 const baseline={stackId:`arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`,templates:{Original:old,Processed:old},resources:[{LogicalResourceId:ID,PhysicalResourceId:"ThnRetainedProductionReleaseV1",ResourceType:"AWS::IAM::Policy"}],parameters:native().Parameters,terminationProtection:false,ownerPool:{arn:native().Parameters[0].ParameterValue},externalRoles:{},newRoles:{},packageBucket:{exists:true}};
 let writes=0;
 const call=(kind,service,operation,input)=>{
  cert.assertProductionOperation(kind,service,operation,input);
  if(operation==="describe-stacks")return {Stacks:[{StackName:"zoolanding-auth-admin-prod",StackId:AUTH_STACK,StackStatus:"UPDATE_COMPLETE",EnableTerminationProtection:true}]};
  if(kind!=="lookup"){writes++;throw Error("unexpected_write");}
  if(operation==="describe-type")return {Schema:JSON.stringify({handlers:{update:{permissions:["iam:GetRolePolicy","iam:PutRolePolicy","iam:DeleteRolePolicy"]}}})};
  if(operation.startsWith("simulate-"))return {EvaluationResults:input.ActionNames.map(a=>({EvalActionName:a,EvalResourceName:input.ResourceArns[0],EvalDecision:operation==="simulate-custom-policy"?"implicitDeny":"allowed"}))};
  throw Error("unexpected_lookup");
 };
 try{
  await assert.rejects(api.runIdentities({call,manifest,sourceSha:"a".repeat(40),fingerprint:"b".repeat(64),execution:"review",scope:"auth-owner-read-patch",runId:"123-1",outputPath:path.join(dir,"review.json"),captureBaseline:()=>structuredClone(baseline)}),/production_identities_auth_owner_read_permissions_invalid/);
  assert.equal(writes,0);
 }finally{fs.rmSync(dir,{recursive:true});}
});

test("postcheck requires all effective reads on the exact Auth role",()=>{
 const seen=[];
 const allowed=(kind,service,operation,input)=>{
  cert.assertProductionOperation(kind,service,operation,input);
  seen.push(input.ResourceArns[0]);
  return {EvaluationResults:input.ActionNames.map(a=>({EvalActionName:a,EvalResourceName:input.ResourceArns[0],EvalDecision:"allowed"}))};
 };
 assert.equal(api.authOwnerEffectivePermissionProof(allowed,AUTH_STACK).length,cert.ownerReadMatrix.length);
 assert.deepEqual(seen,cert.ownerReadResources(AUTH_STACK).map(x=>x.resource));
 const denied=(...args)=>{const r=allowed(...args);r.EvaluationResults[0].EvalDecision="implicitDeny";return r;};
 assert.throws(()=>api.authOwnerEffectivePermissionProof(denied,AUTH_STACK),/production_identities_auth_owner_read_effective_denied/);
});

test("postcheck preserves every snapshot field except the reviewed policy",()=>{
 const old=oldTemplate(),candidate=api.composeAuthOwnerReadPatch(old,manifest),name="ThnRetainedProductionReleaseV1";
 const before={templates:{Original:old,Processed:old},resources:[{LogicalResourceId:ID,PhysicalResourceId:name,ResourceType:"AWS::IAM::Policy"}],externalRoles:{[ROLE]:{roleId:"role-id",trustSha256:"trust",policySha256:"external",boundarySha256:"null",policies:[{type:"inline",name,sha256:cert.sha(cert.canonical(old.Resources[ID].Properties.PolicyDocument))}]}},parameters:native().Parameters,stackId:"stack",terminationProtection:false,packageBucket:{exists:true},newRoles:{}};
 const after=structuredClone(before);after.templates={Original:candidate,Processed:candidate};
 after.externalRoles[ROLE].policies[0].sha256=cert.sha(cert.canonical(candidate.Resources[ID].Properties.PolicyDocument));
 assert.equal(api.verifyAuthOwnerReadPost(before,after,candidate),true);
 const drift=structuredClone(after);drift.resources[0].PhysicalResourceId="replacement";
 assert.throws(()=>api.verifyAuthOwnerReadPost(before,drift,candidate),/production_identities_auth_owner_read_post_mismatch/);
});

test("candidate stays below the aggregate inline-role policy limit",()=>{
 const current={"inline:DeployAuthAdminSamStack":2514,"inline:ThnRetainedProductionReleaseV1":2827,"inline:ThnVerifiedProductionOwnerMetadataV1":219};
 const bytes=api.authOwnerCandidateInlineBytes(current,manifest.template.Resources[ID]);
 assert.equal(bytes,2514+219+Buffer.byteLength(cert.canonical(manifest.template.Resources[ID].Properties.PolicyDocument)));
 assert.ok(bytes<10240);
 assert.throws(()=>api.authOwnerCandidateInlineBytes({...current,"inline:Unexpected":9000},manifest.template.Resources[ID]),/production_identities_policy_size_invalid/);
});

test("protected owner-read review seals one policy change and stops without execution",async()=>{
 const old=oldTemplate(),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-owner-read-review-"));
 const stackId=`arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`;
 const state={stackId,templates:{Original:old,Processed:old},resources:[{LogicalResourceId:ID,PhysicalResourceId:"ThnRetainedProductionReleaseV1",ResourceType:"AWS::IAM::Policy"}],parameters:native().Parameters,terminationProtection:false,ownerPool:{arn:native().Parameters[0].ParameterValue},externalRoles:{},newRoles:{},packageBucket:{exists:true}};
 const objects=new Map();let candidate,preview,writes=[];
 const call=(kind,service,operation,input,file)=>{
  cert.assertProductionOperation(kind,service,operation,input);
  const key=service+":"+operation;
  if(key==="cloudformation:describe-stacks")return {Stacks:[{StackName:"zoolanding-auth-admin-prod",StackId:AUTH_STACK,StackStatus:"UPDATE_COMPLETE",EnableTerminationProtection:true}]};
  if(key==="cloudformation:describe-type")return {Schema:JSON.stringify({handlers:{create:{permissions:["iam:GetRolePolicy"]},update:{permissions:["iam:PutRolePolicy"]},delete:{permissions:["iam:DeleteRolePolicy"]}}})};
  if(key.startsWith("iam:simulate-"))return {EvaluationResults:input.ActionNames.map(a=>({EvalActionName:a,EvalResourceName:input.ResourceArns[0],EvalDecision:"allowed"}))};
  if(key==="s3api:list-objects-v2")return {Contents:[]};
  if(key==="s3api:put-object"){writes.push(key);const bytes=fs.readFileSync(input.Body);objects.set(input.Key,bytes);if(input.Body.endsWith("candidate.json"))candidate=JSON.parse(bytes);return {VersionId:"v1"};}
  if(key==="s3api:get-object"){fs.writeFileSync(file,objects.get(input.Key));return {VersionId:"v1"};}
  if(key==="cloudformation:create-change-set"){
   writes.push(key);assert.deepEqual(input.Parameters,state.parameters);
   preview={...native(),StackId:stackId,ChangeSetId:`arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,CreationTime:new Date().toISOString()};
   return {Id:preview.ChangeSetId};
  }
  if(key==="cloudformation:describe-change-set")return preview;
  if(key==="cloudformation:get-template")return {TemplateBody:candidate};
  throw Error("unexpected_call:"+key);
 };
 try{
  const record=await api.runIdentities({call,manifest,sourceSha:"a".repeat(40),fingerprint:"b".repeat(64),execution:"review",scope:"auth-owner-read-patch",runId:"123-1",outputPath:path.join(dir,"review.json"),captureBaseline:()=>structuredClone(state)});
  assert.equal(record.purpose,"deployment-identities-auth-owner-read-patch");
  assert.equal(record.changes.length,1);
  assert.deepEqual(writes,["s3api:put-object","s3api:put-object","s3api:put-object","cloudformation:create-change-set"]);
 }finally{fs.rmSync(dir,{recursive:true});}
});
