"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const fs=require("node:fs"),os=require("node:os"),path=require("node:path");
const api=require("../tools/thn-production-identities");
const manifest=require("../tools/production/thn-deployment-identities.json");
const cert=require("../tools/thn-production-certificate-release");

const ID="ApiCfnNativePolicy0",POLICY_ARN="arn:aws:iam::765932874577:policy/ThnProductionApiNative0";
const TAG_ARN="arn:aws:apigateway:us-east-1::/tags/arn%3Aaws%3Aapigateway%3Aus-east-1%3A%3A%2Frestapis%2F*";
const TAG_STATEMENT={Action:["apigateway:GET","apigateway:PUT","apigateway:DELETE"],
 Condition:{StringEquals:{"aws:RequestedRegion":"us-east-1"}},Effect:"Allow",Resource:[TAG_ARN]};
function before(){const old=api.compose(null,manifest);old.Resources[ID].Properties.PolicyDocument.Statement.pop();return old;}
function preview(change={}){return {Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",
 Parameters:[{ParameterKey:"ThnProductionOwnerPoolArn",ParameterValue:"BLOCKED"}],
 Changes:[{Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:ID,
 ResourceType:"AWS::IAM::ManagedPolicy",PhysicalResourceId:POLICY_ARN,Replacement:"False",
 Scope:["Properties"],Details:[{Target:{Attribute:"Properties",Name:"PolicyDocument",
 RequiresRecreation:"Never"},ChangeSource:"DirectModification",Evaluation:"Static"}],...change}}]};}
const existing=[{LogicalResourceId:ID,PhysicalResourceId:POLICY_ARN,ResourceType:"AWS::IAM::ManagedPolicy"}];

test("candidate adds exactly the encoded production REST API tag permission",()=>{
 const desired=manifest.template.Resources[ID].Properties.PolicyDocument.Statement;
 assert.deepEqual(desired.at(-1),TAG_STATEMENT);
 const old=before(),candidate=api.composeApiTagPatch(old,manifest);
 assert.equal(cert.canonical(candidate),cert.canonical(api.compose(null,manifest)));
 const altered=structuredClone(old);altered.Resources.ApiGithubReleasePolicy.Properties.PolicyName="wrong";
 assert.throws(()=>api.composeApiTagPatch(altered,manifest),/production_identities_api_tag_baseline_invalid/);
});

test("change set must modify only the existing managed policy document",()=>{
 const old=before(),candidate=api.composeApiTagPatch(old,manifest);
 assert.equal(api.reviewApiTagInventory(old,candidate,preview(),existing,"BLOCKED").length,1);
 for(const change of [{Replacement:"Conditional"},{Action:"Add"},{PhysicalResourceId:"different"},
     {Scope:["Properties","Tags"]},{Details:[]}]){
  assert.throws(()=>api.reviewApiTagInventory(old,candidate,preview(change),existing,"BLOCKED"),
   /production_identities_api_tag_inventory_invalid/);
 }
 const extra=preview();extra.Changes.push({...extra.Changes[0]});
 assert.throws(()=>api.reviewApiTagInventory(old,candidate,extra,existing,"BLOCKED"),
  /production_identities_api_tag_inventory_invalid/);
});

test("protected IAM simulation accepts only the encoded tag path",()=>{
 const actions=["apigateway:get","apigateway:put","apigateway:delete"];
 const role="arn:aws:iam::765932874577:role/zoolanding-deployer-thn-auth-runtime-production-cfn-exec";
 const valid={PolicySourceArn:role,ActionNames:actions,ResourceArns:[TAG_ARN],
  ContextEntries:[{ContextKeyName:"aws:RequestedRegion",ContextKeyValues:["us-east-1"],ContextKeyType:"string"}]};
 assert.doesNotThrow(()=>cert.assertProductionOperation("lookup","iam","simulate-principal-policy",valid));
 assert.throws(()=>cert.assertProductionOperation("lookup","iam","simulate-principal-policy",
  {...valid,ResourceArns:["arn:aws:apigateway:us-east-1::/tags/*"]}),/production_operation_out_of_scope/);
});

function baseline(){
 const old=before(),name="zoolanding-deployer-thn-auth-runtime-production-cfn-exec";
 return {stackId:`arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`,
  templates:{Original:old,Processed:old},parameters:preview().Parameters,terminationProtection:false,
  resources:existing,ownerPool:{arn:"BLOCKED"},externalRoles:{},packageBucket:{exists:true},
  newRoles:{[name]:{roleId:"ROLEID",trust:old.Resources.ApiCfnExecutionRole.Properties.AssumeRolePolicyDocument,
   boundary:null,policies:{[POLICY_ARN]:cert.sha(cert.canonical(old.Resources[ID].Properties.PolicyDocument))}}}};
}
function proofCall(denyCandidate=false){
 const old=before().Resources[ID].Properties.PolicyDocument;
 return (kind,service,operation,input)=>{
  cert.assertProductionOperation(kind,service,operation,input);
  if(operation==="get-policy")return {Policy:{Arn:POLICY_ARN,PolicyName:"ThnProductionApiNative0",DefaultVersionId:"v2",AttachmentCount:1,PermissionsBoundaryUsageCount:0}};
  if(operation==="get-policy-version")return {PolicyVersion:{VersionId:"v2",IsDefaultVersion:true,Document:old}};
  if(operation==="list-policy-versions")return {Versions:[{VersionId:"v2",IsDefaultVersion:true},{VersionId:"v1",IsDefaultVersion:false}]};
  if(operation==="list-entities-for-policy")return {PolicyRoles:[{RoleName:"zoolanding-deployer-thn-auth-runtime-production-cfn-exec"}],PolicyUsers:[],PolicyGroups:[]};
  if(operation==="describe-type")return {Schema:JSON.stringify({handlers:{read:{permissions:["iam:GetPolicy","iam:ListEntitiesForPolicy","iam:GetPolicyVersion"]},
   update:{permissions:["iam:GetPolicy","iam:ListPolicyVersions","iam:CreatePolicyVersion","iam:DeletePolicyVersion","iam:AttachRolePolicy","iam:DetachRolePolicy"]}}})};
  if(operation.startsWith("simulate-"))return {EvaluationResults:input.ActionNames.map(a=>({EvalActionName:a,EvalResourceName:input.ResourceArns[0],
   EvalDecision:denyCandidate&&input.PolicyInputList?.length?"explicitDeny":"allowed",MissingContextValues:[]}))};
  throw Error("unexpected_call");
 };
}

test("review refuses a denied tag candidate before any AWS write",async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-api-tag-test-"));let writes=0;
 const call=(...args)=>{if(args[0]!=="lookup"){writes++;throw Error("unexpected_write");}return proofCall(true)(...args);};
 try{await assert.rejects(api.runIdentities({call,manifest,sourceSha:"a".repeat(40),fingerprint:"b".repeat(64),
  execution:"review",scope:"api-tag-path-patch",runId:"123-1",outputPath:path.join(dir,"review.json"),
  captureBaseline:()=>structuredClone(baseline())}),/production_identities_api_tag_candidate_denied/);
  assert.equal(writes,0);
 }finally{fs.rmSync(dir,{recursive:true});}
});

test("live preflight proves the exact policy writer and proposed tag permission",()=>{
 const beforeState=baseline(),candidate=api.composeApiTagPatch(beforeState.templates.Original,manifest);
 const proof=api.apiTagPermissionProof(proofCall(),beforeState,candidate);
 assert.equal(proof.policy.versionId,"v2");
 assert.equal(proof.tagResource,TAG_ARN);
 assert.equal(proof.writerActions.length,6);
 const detached=(...args)=>{const result=proofCall()(...args);
  if(args[2]==="list-entities-for-policy")result.PolicyRoles=[];
  return result;};
 assert.throws(()=>api.apiTagPermissionProof(detached,beforeState,candidate),
  /production_identities_api_tag_attachment_invalid/);
});

test("postcheck rejects a changed unrelated identity",()=>{
 const beforeState=baseline(),candidate=api.composeApiTagPatch(beforeState.templates.Original,manifest),after=structuredClone(beforeState);
 after.templates={Original:candidate,Processed:candidate};
 delete after.apiTagPermissionProof;
 after.newRoles["zoolanding-deployer-thn-auth-runtime-production-cfn-exec"].policies[POLICY_ARN]=
  cert.sha(cert.canonical(candidate.Resources[ID].Properties.PolicyDocument));
 assert.equal(api.verifyApiTagPost(beforeState,after,candidate),true);
 after.newRoles["zoolanding-deployer-thn-auth-runtime-production-cfn-exec"].roleId="different";
 assert.throws(()=>api.verifyApiTagPost(beforeState,after,candidate),/production_identities_api_tag_post_mismatch/);
});
