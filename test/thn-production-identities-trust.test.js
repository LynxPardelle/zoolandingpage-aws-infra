"use strict";
const test=require('node:test'),assert=require('node:assert/strict');
const api=require('../tools/thn-production-identities');
const {fixture}=require('./thn-production-identities.test');
function pair(){
 const manifest=fixture();
 manifest.template.Parameters={ThnProductionOwnerPoolArn:{Type:'String',Default:'BLOCKED',AllowedPattern:'^(BLOCKED|arn:aws:cognito-idp:us-east-1:765932874577:userpool/us-east-1_[A-Za-z0-9]+)$'}};
 manifest.template.Conditions={HasVerifiedProductionOwnerPool:{'Fn::Not':[{'Fn::Equals':[{Ref:'ThnProductionOwnerPoolArn'},'BLOCKED']} ]}};
 for(const r of Object.values(manifest.template.Resources))if(r.Properties.RoleName.endsWith('github-deploy'))delete r.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:ref'];
 const before=structuredClone(manifest.template);Object.assign(before.Resources,api.compose(null,manifest).Resources);
 for(const r of Object.values(before.Resources))if(r.Type==='AWS::IAM::Role'&&r.Properties.RoleName.endsWith('github-deploy'))r.Properties.AssumeRolePolicyDocument.Statement[0].Condition.StringEquals['token.actions.githubusercontent.com:ref']='refs/heads/main';
 return {before,manifest};
}
test('supported OIDC claims only, with subject bound to each exact role repository',()=>{
 const {manifest}=pair();api.validateManifest(manifest);
 for(const mutation of ['ref','aud','sub','principal','condition']){
  const bad=structuredClone(manifest),role=Object.values(bad.template.Resources).find(r=>r.Properties.RoleName.includes('image-upload')&&r.Properties.RoleName.endsWith('github-deploy')),s=role.Properties.AssumeRolePolicyDocument.Statement[0];
  if(mutation==='ref')s.Condition.StringEquals['token.actions.githubusercontent.com:ref']='refs/heads/main';
  else if(mutation==='aud')s.Condition.StringEquals['token.actions.githubusercontent.com:aud']='*';
  else if(mutation==='sub')s.Condition.StringEquals['token.actions.githubusercontent.com:sub']='repo:LynxPardelle/zoolanding-api-proxy:environment:production';
  else if(mutation==='principal')s.Principal.AWS='*';else s.Condition.StringEqualsIfExists=s.Condition.StringEquals;
  assert.throws(()=>api.validateManifest(bad),/manifest_invalid/);
 }
});
test('trust patch requires exactly three non-replacing native role modifications and no other template changes',()=>{
 const {before,manifest}=pair(),candidate=api.composeTrustPatch(before,manifest);
 const Changes=Object.entries(candidate.Resources).filter(([id,r])=>JSON.stringify(r)!==JSON.stringify(before.Resources[id])).map(([id,r])=>({Type:'Resource',ResourceChange:{Action:'Modify',LogicalResourceId:id,ResourceType:r.Type,PhysicalResourceId:r.Properties.RoleName,Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'},ChangeSource:'DirectModification',Evaluation:'Static'}]}}));
 const native={Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',Changes};
 assert.equal(Changes.length,3);api.reviewTrustInventory(before,candidate,native);
 for(const mutation of ['missing','duplicate','add','physical','replacement','conditional','property','scope','template','noop','extra']){
  const n=structuredClone(native),c=structuredClone(candidate);
  if(mutation==='missing')n.Changes.pop();else if(mutation==='duplicate')n.Changes[1]=n.Changes[0];
  else if(mutation==='add')n.Changes[0].ResourceChange.Action='Add';
  else if(mutation==='physical')n.Changes[0].ResourceChange.PhysicalResourceId='other';
  else if(mutation==='replacement')n.Changes[0].ResourceChange.Replacement='True';
  else if(mutation==='conditional')n.Changes[0].ResourceChange.Replacement='Conditional';
  else if(mutation==='property')n.Changes[0].ResourceChange.Details[0].Target.Name='Policies';
  else if(mutation==='scope')n.Changes[0].ResourceChange.Scope.push('Tags');
  else if(mutation==='template')c.Description='unapproved';
  else if(mutation==='noop')Object.assign(c,structuredClone(before));
  else n.Changes.push({Type:'Resource',ResourceChange:{Action:'Remove',LogicalResourceId:'Bucket',ResourceType:'AWS::S3::Bucket'}});
  assert.throws(()=>api.reviewTrustInventory(before,c,n));
 }
 const drift=structuredClone(manifest);Object.values(drift.template.Resources)[0].Properties.MaxSessionDuration=7200;
 assert.throws(()=>api.composeTrustPatch(before,drift));
 assert.throws(()=>api.composeTrustPatch(null,manifest));
});
module.exports.pair=pair;
test('trust-patch retains recovery bytes and the exact review; drift fails before execute',async()=>{
 const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'thn-trust-roundtrip-')),{before,manifest}=pair();
 const cert=require('../tools/thn-production-certificate-release'),objects=new Map(),newRoles={};
 for(const r of Object.values(before.Resources))if(r.Type==='AWS::IAM::Role')newRoles[r.Properties.RoleName]={arn:`arn:aws:iam::765932874577:role/${r.Properties.RoleName}`,roleId:'ID-'+r.Properties.RoleName,trust:r.Properties.AssumeRolePolicyDocument,policies:{},policySizes:{},boundary:null};
 const stackId=`arn:aws:cloudformation:us-east-1:765932874577:stack/${api.STACK}/11111111-1111-1111-1111-111111111111`;
 const baseline={stackId,templates:{Original:before,Processed:before},parameters:[{ParameterKey:'ThnProductionOwnerPoolArn',ParameterValue:'BLOCKED'}],terminationProtection:false,resources:Object.entries(before.Resources).map(([id,r])=>({LogicalResourceId:id,ResourceType:r.Type,PhysicalResourceId:r.Properties.RoleName||id})),newRoles,externalRoles:{},ownerPool:{arn:'BLOCKED'},packageBucket:{exists:true}};
 let native,candidate,executes=0,previews=0,drift=false,tamper=false,simMutation='';
 const call=(kind,service,op,input,out)=>{
  const key=service+':'+op;
  if(key==='cloudformation:describe-type')return {Schema:JSON.stringify({handlers:{read:{permissions:['iam:GetRole']},update:{permissions:['iam:UpdateAssumeRolePolicy']}}})};
  if(key==='iam:simulate-principal-policy'){
   assert.equal(input.PolicySourceArn,cert.roles['cfn-exec']);assert.equal(input.ResourceArns.length,1);
   const response={EvaluationResults:input.ActionNames.map(a=>({EvalActionName:a,EvalResourceName:input.ResourceArns[0],EvalDecision:'allowed'}))};
   if(simMutation==='deny')response.EvaluationResults[0].EvalDecision='implicitDeny';
   else if(simMutation==='truncated')response.IsTruncated=true;
   else if(simMutation==='context')response.EvaluationResults[0].MissingContextValues=['missing'];
   else if(simMutation==='duplicate')response.EvaluationResults[1]=response.EvaluationResults[0];
   else if(simMutation==='wrong-resource')response.EvaluationResults[0].EvalResourceName='*';
   else if(simMutation==='nested-deny')response.EvaluationResults[0].ResourceSpecificResults=[{EvalResourceName:input.ResourceArns[0],EvalResourceDecision:'explicitDeny'}];
   return response;
  }
  if(key==='iam:get-role')return {Role:{Arn:cert.roles['cfn-exec'],RoleId:'CFN-ID',AssumeRolePolicyDocument:{Version:'2012-10-17',Statement:[{Effect:'Allow',Action:'sts:AssumeRole',Principal:{Service:'cloudformation.amazonaws.com'}}]}}};
  if(key==='iam:list-role-policies')return {PolicyNames:[]};if(key==='iam:list-attached-role-policies')return {AttachedPolicies:[]};
  if(key==='s3api:list-objects-v2')return {Contents:[]};
  if(key==='s3api:put-object'){objects.set(input.Key,fs.readFileSync(input.Body));return {VersionId:'v1'};}
  if(key==='s3api:get-object'){fs.writeFileSync(out,tamper&&input.Key===native?.recoveryKey?Buffer.from('tampered'):objects.get(input.Key));return {VersionId:'v1'};}
  if(key==='cloudformation:create-change-set'){
   previews++;assert.equal(input.ChangeSetType,'UPDATE');assert.equal(input.StackName,stackId);assert.equal(input.RoleARN,cert.roles['cfn-exec']);
   const url=new URL(input.TemplateURL);candidate=JSON.parse(objects.get(decodeURIComponent(url.pathname.slice(1))));
   native={StackId:stackId,ChangeSetId:`arn:aws:cloudformation:us-east-1:765932874577:changeSet/${input.ChangeSetName}/11111111-1111-1111-1111-111111111111`,Status:'CREATE_COMPLETE',ExecutionStatus:'AVAILABLE',CreationTime:new Date().toISOString(),Parameters:input.Parameters,Changes:Object.entries(candidate.Resources).filter(([id,r])=>cert.canonical(r)!==cert.canonical(before.Resources[id])).map(([id,r])=>({Type:'Resource',ResourceChange:{Action:'Modify',LogicalResourceId:id,ResourceType:r.Type,PhysicalResourceId:r.Properties.RoleName,Replacement:'False',Scope:['Properties'],Details:[{Target:{Attribute:'Properties',Name:'AssumeRolePolicyDocument',RequiresRecreation:'Never'},ChangeSource:'DirectModification',Evaluation:'Static'}]}}))};return {Id:native.ChangeSetId,StackId:stackId};
  }
  if(key==='cloudformation:describe-change-set')return native;
  if(key==='cloudformation:get-template')return {TemplateBody:candidate};
  if(key==='cloudformation:execute-change-set'){executes++;assert.equal(input.ChangeSetName,native.ChangeSetId);throw Error('test_apply_boundary');}
  throw Error('unexpected:'+key);
 };
 try{
  for(const mutation of ['deny','truncated','context','duplicate','wrong-resource','nested-deny']){simMutation=mutation;assert.throws(()=>api.trustPermissionProof(call),/permissions_invalid/);}simMutation='';
  const options={call,manifest,scope:'trust-patch',sourceSha:'a'.repeat(40),fingerprint:'b'.repeat(64),runId:'123-1',outputPath:path.join(dir,'review.json'),captureBaseline:()=>({...structuredClone(baseline),...(drift?{unexpected:true}:{})})};
  const record=await api.runIdentities({...options,execution:'review'});assert.equal(executes,0);assert.equal(previews,1);assert.equal(record.purpose,'deployment-identities-trust-patch');assert.equal(record.recoveryCoordinates.length,2);assert.equal(objects.size,3);
  drift=true;await assert.rejects(()=>api.runIdentities({...options,execution:'execute',record,approvedDigest:record.digest}),/package_invalid|retained_review_stale/);assert.equal(executes,0);drift=false;
  native.recoveryKey=record.recoveryCoordinates[0].key;tamper=true;await assert.rejects(()=>api.runIdentities({...options,execution:'execute',record,approvedDigest:record.digest}),/package_invalid/);assert.equal(executes,0);tamper=false;
  await assert.rejects(()=>api.runIdentities({...options,execution:'execute',record,approvedDigest:record.digest}),/test_apply_boundary/);assert.equal(executes,1);assert.equal(previews,1);
  await assert.rejects(()=>api.runIdentities({...options,scope:'bootstrap',execution:'execute',record,approvedDigest:record.digest}),/review_invalid/);
  const after=structuredClone(baseline);after.templates={Original:candidate,Processed:candidate};for(const name of api.TRUST_ROLES.keys())after.newRoles[name].trust=Object.values(candidate.Resources).find(r=>r.Properties.RoleName===name).Properties.AssumeRolePolicyDocument;
  api.verifyTrustPost(baseline,after,candidate);
  for(const key of ['roleId','policies','boundary','trust']){const bad=structuredClone(after);bad.newRoles[[...api.TRUST_ROLES.keys()][0]][key]={changed:true};assert.throws(()=>api.verifyTrustPost(baseline,bad,candidate),/post_mismatch/);}
 }finally{fs.rmSync(dir,{recursive:true});}
});
