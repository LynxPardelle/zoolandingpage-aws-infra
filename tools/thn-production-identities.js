"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const cert=require("./thn-production-certificate-release"),retained=require("./thn-production-retained-review"),{canonical,sha,ACCOUNT,REGION,roles,ASSET_BUCKET}=cert;
const STACK="ZoolandingProduction-Zoolandingpage-production-ThnDeploymentIdentities",fail=c=>{throw Error(c);},same=(a,b)=>canonical(a)===canonical(b);
const NEW_ROLES=new Set(["zoolanding-deployer-thn-auth-runtime-production-github-deploy","zoolanding-deployer-image-upload-production-github-deploy","zoolanding-deployer-api-proxy-production-github-deploy",...['auth-admin','thn-auth-runtime','content-hub','image-upload','api-proxy'].map(s=>`zoolanding-deployer-${s}-production-cfn-exec`)]);
const EXISTING_ROLES=new Set(["zoolanding-auth-admin-production-deploy","zoolanding-content-hub-production-deploy","zoolanding-config-authoring-production-deploy","zoolanding-config-runtime-read-production-github-deploy","zoolanding-config-runtime-read-production-cfn-exec"]);
const PACKAGE_BUCKET=`zlp-thn-production-releases-${ACCOUNT}-${REGION}`;
const POOL_PARAMETER="ThnProductionOwnerPoolArn",POOL_CONDITION="HasVerifiedProductionOwnerPool";
const TRUST_ROLES=new Map([
 ["zoolanding-deployer-image-upload-production-github-deploy","zoolanding-image-upload"],
 ["zoolanding-deployer-thn-auth-runtime-production-github-deploy","zoolanding-api-proxy"],
 ["zoolanding-deployer-api-proxy-production-github-deploy","zoolanding-api-proxy"]
]);
function githubStatement(role){return {Effect:"Allow",Action:"sts:AssumeRoleWithWebIdentity",Principal:{Federated:`arn:aws:iam::${ACCOUNT}:oidc-provider/token.actions.githubusercontent.com`},Condition:{StringEquals:{"token.actions.githubusercontent.com:aud":"sts.amazonaws.com","token.actions.githubusercontent.com:sub":`repo:LynxPardelle/${TRUST_ROLES.get(role)}:environment:production`}}};}
function packageResources(){return {ThnProductionReleaseBucket:{Type:"AWS::S3::Bucket",DeletionPolicy:"Retain",UpdateReplacePolicy:"Retain",Properties:{BucketName:PACKAGE_BUCKET,VersioningConfiguration:{Status:"Enabled"},BucketEncryption:{ServerSideEncryptionConfiguration:[{ServerSideEncryptionByDefault:{SSEAlgorithm:"AES256"}}]},PublicAccessBlockConfiguration:{BlockPublicAcls:true,BlockPublicPolicy:true,IgnorePublicAcls:true,RestrictPublicBuckets:true},OwnershipControls:{Rules:[{ObjectOwnership:"BucketOwnerEnforced"}]}}},ThnProductionReleaseBucketPolicy:{Type:"AWS::S3::BucketPolicy",DeletionPolicy:"Retain",UpdateReplacePolicy:"Retain",Properties:{Bucket:{Ref:"ThnProductionReleaseBucket"},PolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Deny",Principal:"*",Action:"s3:*",Resource:[`arn:aws:s3:::${PACKAGE_BUCKET}`,`arn:aws:s3:::${PACKAGE_BUCKET}/*`],Condition:{Bool:{"aws:SecureTransport":"false"}}}]}}}};}
function validateManifest(manifest){
 if(!manifest||manifest.schemaVersion!==1||manifest.environment!=="production"||manifest.account!==ACCOUNT||manifest.region!==REGION||!manifest.template?.Resources||manifest.template.Transform||!manifest.providerSchemaHashes||!manifest.proofMatrix||!manifest.externalRolePolicyBaselines||!manifest.sourceCandidateHashes)fail("production_identities_manifest_invalid");
 if(manifest.template.Parameters){const entries=Object.entries(manifest.template.Parameters),p=manifest.template.Parameters[POOL_PARAMETER];if(entries.length!==1||p?.Type!=="String"||p.Default!=="BLOCKED"||p.NoEcho||typeof p.AllowedPattern!=="string"||!p.AllowedPattern.includes("BLOCKED")||!p.AllowedPattern.includes("765932874577")||!p.AllowedPattern.includes("us-east-1"))fail("production_identities_pool_parameter_invalid");if(!same(manifest.template.Conditions,{[POOL_CONDITION]:{"Fn::Not":[{"Fn::Equals":[{Ref:POOL_PARAMETER},"BLOCKED"]}]}}))fail("production_identities_pool_parameter_invalid");}
 const roleNames=new Set(),policies=new Set();
 for(const resource of Object.values(manifest.template.Resources)){
  const p=resource.Properties;
  if(resource.DeletionPolicy!=="Retain"||resource.UpdateReplacePolicy!=="Retain"||!p)fail("production_identities_manifest_invalid");
  if(resource.Type==="AWS::IAM::Role"){
   if(!NEW_ROLES.has(p.RoleName)||roleNames.has(p.RoleName)||p.PermissionsBoundary||(p.ManagedPolicyArns||[]).some(arn=>typeof arn!=="object"||!arn.Ref||manifest.template.Resources[arn.Ref]?.Type!=="AWS::IAM::ManagedPolicy"))fail("production_identities_manifest_invalid");
   roleNames.add(p.RoleName);const trust=p.AssumeRolePolicyDocument;
   if(trust?.Version!=="2012-10-17"||trust.Statement?.length!==1||trust.Statement[0].Effect!=="Allow")fail("production_identities_manifest_invalid");
   const t=trust.Statement[0];
   if(p.RoleName.endsWith("github-deploy")){
    if(!TRUST_ROLES.has(p.RoleName)||!same(trust,{Version:"2012-10-17",Statement:[githubStatement(p.RoleName)]}))fail("production_identities_manifest_invalid");
   }else if(t.Action!=="sts:AssumeRole"||t.Principal?.Service!=="cloudformation.amazonaws.com"||t.Condition)fail("production_identities_manifest_invalid");
   let inlineBytes=0;for(const policy of p.Policies||[]){validatePolicy(policy.PolicyDocument);inlineBytes+=Buffer.byteLength(canonical(policy.PolicyDocument));if(p.RoleName.endsWith("github-deploy"))validateDeploymentPolicy(policy.PolicyDocument);}if(inlineBytes>10240)fail("production_identities_policy_size_invalid");
  }else if(["AWS::IAM::Policy","AWS::IAM::ManagedPolicy"].includes(resource.Type)){
   const name=resource.Type==="AWS::IAM::ManagedPolicy"?p.ManagedPolicyName:p.PolicyName;
   const attached=p.Roles||[],binding=canonical(attached),policyKey=resource.Type=== "AWS::IAM::ManagedPolicy"?name:name+binding;
   if(!(resource.Type==="AWS::IAM::Policy"?/^Thn(?:RetainedProductionReleaseV1|VerifiedProductionOwnerMetadataV1|Production[A-Za-z0-9]+)$/.test(name||""):/^ThnProduction[A-Za-z0-9-]+$/.test(name||""))||policies.has(policyKey)||!Array.isArray(attached)||resource.Type==="AWS::IAM::Policy"&&!attached.length||p.Users||p.Groups)fail("production_identities_manifest_invalid");
   policies.add(policyKey);
   for(const role of attached)if(typeof role==="string"&&!NEW_ROLES.has(role)&&!EXISTING_ROLES.has(role)||typeof role!=="string"&&!(role&&typeof role.Ref==="string"&&manifest.template.Resources[role.Ref]?.Type==="AWS::IAM::Role"))fail("production_identities_manifest_invalid");
   validatePolicy(p.PolicyDocument);if(resource.Condition&&(resource.Condition!==POOL_CONDITION||!manifest.template.Parameters||p.PolicyDocument.Statement.some(s=>(Array.isArray(s.Action)?s.Action:[s.Action]).some(a=>!["cognito-idp:DescribeUserPool","cognito-idp:GetUserPoolMfaConfig"].includes(a))||(Array.isArray(s.Resource)?s.Resource:[s.Resource]).some(r=>!same(r,{Ref:POOL_PARAMETER})))))fail("production_identities_pool_parameter_invalid");
   if(resource.Type==="AWS::IAM::ManagedPolicy"&&Buffer.byteLength(canonical(p.PolicyDocument))>5800)fail("production_identities_policy_size_invalid");
   if(attached.some(role=>{const name=typeof role==="string"?role:manifest.template.Resources[role.Ref]?.Properties?.RoleName;return name?.endsWith("github-deploy")||EXISTING_ROLES.has(name)&&!name.endsWith("cfn-exec");}))validateDeploymentPolicy(p.PolicyDocument);
  }else fail("production_identities_manifest_invalid");
 }
 if(roleNames.size!==NEW_ROLES.size)fail("production_identities_manifest_invalid");
 for(const role of Object.values(manifest.template.Resources).filter(r=>r.Type==="AWS::IAM::Role"&&r.Properties.RoleName.endsWith("github-deploy")))for(const arn of role.Properties.ManagedPolicyArns||[])validateDeploymentPolicy(manifest.template.Resources[arn.Ref].Properties.PolicyDocument);
 return manifest;
}
function validateDeploymentPolicy(policy){for(const s of policy.Statement){const actions=Array.isArray(s.Action)?s.Action:[s.Action];if(actions.includes("dynamodb:GetItem")&&same(actions,["dynamodb:GetItem"])&&same(s.Resource,["arn:aws:dynamodb:us-east-1:765932874577:table/zoolanding-content-hub-prod-ServiceBindingRegistryV2"])&&same(s.Condition,{"ForAllValues:StringEquals":{"dynamodb:LeadingKeys":["SERVICE_BINDING#production#thn-journal-production-v2"]}}))continue;if(actions.some(a=>/^(?:dynamodb|execute-api|secretsmanager|kms):|^lambda:(?:InvokeFunction|InvokeAsync)/i.test(a)||a.startsWith("cognito-idp:")&&!["cognito-idp:DescribeUserPool","cognito-idp:GetUserPoolMfaConfig"].includes(a)))fail("production_deployment_data_plane_forbidden");}}
function validatePolicy(policy){
 if(policy?.Version!=="2012-10-17"||!Array.isArray(policy.Statement)||!policy.Statement.length)fail("production_identities_policy_invalid");
 for(const s of policy.Statement){if(s.Effect!=="Allow"||s.NotAction||s.NotResource||s.Principal)fail("production_identities_policy_invalid");const actions=Array.isArray(s.Action)?s.Action:[s.Action],resources=Array.isArray(s.Resource)?s.Resource:[s.Resource];if(!actions.length||actions.some(a=>typeof a!=="string"||!/^[a-z0-9-]+:[A-Za-z][A-Za-z0-9*]*$/.test(a)||a.endsWith(":*"))||!resources.length||resources.some(r=>typeof r!=="string"&&!same(r,{Ref:POOL_PARAMETER})))fail("production_identities_policy_invalid");}
}
function compose(before,manifest){validateManifest(manifest);if(before?.Transform||before?.Parameters&&!same(before.Parameters,manifest.template.Parameters)||before?.Conditions&&!same(before.Conditions,manifest.template.Conditions))fail("production_identities_baseline_invalid");const result=structuredClone(before||{AWSTemplateFormatVersion:"2010-09-09",Description:"THN production deployment identities; separate from application state",Resources:{}});for(const key of ["Parameters","Conditions"])if(manifest.template[key])result[key]=structuredClone(manifest.template[key]);for(const [id,r] of Object.entries({...manifest.template.Resources,...packageResources()})){if(result.Resources[id]&&!same(result.Resources[id],r))fail("production_identities_existing_change_forbidden");result.Resources[id]=structuredClone(r);}return result;}
function composeTrustPatch(before,manifest){
 validateManifest(manifest);
 if(!before?.Resources||before.Transform)fail("production_identities_trust_patch_invalid");
 const candidate=structuredClone(before),seen=new Set();
 for(const [id,r] of Object.entries(candidate.Resources)){
  const name=r.Properties?.RoleName;if(!TRUST_ROLES.has(name))continue;
  const statement=githubStatement(name);statement.Condition.StringEquals["token.actions.githubusercontent.com:ref"]="refs/heads/main";
  if(r.Type!=="AWS::IAM::Role"||seen.has(name)||!same(r.Properties.AssumeRolePolicyDocument,{Version:"2012-10-17",Statement:[statement]}))fail("production_identities_trust_patch_invalid");
  seen.add(name);r.Properties.AssumeRolePolicyDocument={Version:"2012-10-17",Statement:[githubStatement(name)]};
 }
 if(seen.size!==3||!same(candidate,compose(candidate,manifest)))fail("production_identities_trust_patch_invalid");
 return candidate;
}
function reviewTrustInventory(before,candidate,native){
 if(!before?.Resources||native.Status!=="CREATE_COMPLETE"||native.ExecutionStatus!=="AVAILABLE"||native.NextToken||native.IncludeNestedStacks||native.Changes?.length!==3)fail("production_identities_trust_inventory_invalid");
 const expected=structuredClone(before),ids=new Set();
 for(const [id,r] of Object.entries(expected.Resources))if(TRUST_ROLES.has(r.Properties?.RoleName)){
  const statement=githubStatement(r.Properties.RoleName);statement.Condition.StringEquals["token.actions.githubusercontent.com:ref"]="refs/heads/main";
  if(r.Type!=="AWS::IAM::Role"||!same(r.Properties.AssumeRolePolicyDocument,{Version:"2012-10-17",Statement:[statement]}))fail("production_identities_trust_inventory_invalid");
  r.Properties.AssumeRolePolicyDocument={Version:"2012-10-17",Statement:[githubStatement(r.Properties.RoleName)]};ids.add(id);
 }
 if(ids.size!==3||!same(expected,candidate))fail("production_identities_trust_inventory_invalid");
 const seen=new Set();for(const c of native.Changes){const r=c.ResourceChange;
  if(c.Type!=="Resource"||r?.Action!=="Modify"||r.ResourceType!=="AWS::IAM::Role"||r.Replacement!=="False"||!ids.has(r.LogicalResourceId)||seen.has(r.LogicalResourceId)||r.PhysicalResourceId!==candidate.Resources[r.LogicalResourceId].Properties.RoleName||!same(r.Scope,["Properties"])||!Array.isArray(r.Details)||!r.Details.length||r.Details.some(d=>d.Target?.Attribute!=="Properties"||d.Target.Name!=="AssumeRolePolicyDocument"||d.Target.RequiresRecreation!=="Never"||d.ChangeSource!=="DirectModification"||d.Evaluation!=="Static"))fail("production_identities_trust_inventory_invalid");
  seen.add(r.LogicalResourceId);
 }return native.Changes;
}
const activeIds=(candidate,pool="BLOCKED")=>Object.entries(candidate.Resources).filter(([,r])=>!r.Condition||r.Condition===POOL_CONDITION&&pool!=="BLOCKED").map(([id])=>id);
function reviewInventory(before,candidate,native,existing,pool="BLOCKED"){
 if(native.Status!=="CREATE_COMPLETE"||native.ExecutionStatus!=="AVAILABLE"||native.NextToken||native.IncludeNestedStacks||!Array.isArray(native.Changes))fail("production_identities_inventory_invalid");
 const present=existing?new Set(existing.map(r=>r.LogicalResourceId)):new Set(Object.keys(before?.Resources||{})),added=activeIds(candidate,pool).filter(id=>!present.has(id));if(!added.length||native.Changes.length!==added.length)fail("production_identities_inventory_invalid");const seen=new Set();for(const c of native.Changes){const r=c.ResourceChange;if(c.Type!=="Resource"||r?.Action!=="Add"||!added.includes(r.LogicalResourceId)||seen.has(r.LogicalResourceId)||candidate.Resources[r.LogicalResourceId].Type!==r.ResourceType||![undefined,"False"].includes(r.Replacement))fail("production_identities_inventory_invalid");seen.add(r.LogicalResourceId);}return native.Changes;
}
function sourcePackageHash(){return sha(canonical(Object.fromEntries(["tools/thn-production-identities.js","tools/production/thn-deployment-identities.json","tools/production/thn-config-production-deltas.json","tools/thn-production-certificate-release.js","tools/thn-production-retained-review.js",".github/workflows/thn-production-identities.yml","package.json","package-lock.json"].map(f=>[f,sha(fs.readFileSync(path.resolve(__dirname,"..",f)))]))));}
module.exports={STACK,PACKAGE_BUCKET,NEW_ROLES,EXISTING_ROLES,TRUST_ROLES,validateManifest,validatePolicy,compose,composeTrustPatch,reviewInventory,reviewTrustInventory,sourcePackageHash};
function captureExternalRoles(call,manifest,ownedResources=[],ownerPool="BLOCKED"){
 const snapshots={};
 for(const roleName of Object.keys(manifest.externalRolePolicyBaselines)){
  if(!EXISTING_ROLES.has(roleName))fail("production_identities_manifest_invalid");
  const snapshot=cert.rolePolicySnapshot((service,op,args)=>call("lookup",service,op,args),`arn:aws:iam::${ACCOUNT}:role/${roleName}`);
  const policies=Object.entries(snapshot.policies).map(([name,sha256])=>name.startsWith("inline:")?{type:"inline",name:name.slice(7),sha256}:{type:"managed",name,sha256}).sort((a,b)=>(a.type+a.name).localeCompare(b.type+b.name));
  const ownedIds=new Set(ownedResources.map(r=>r.LogicalResourceId)),declared=Object.entries(manifest.template.Resources).filter(([id,r])=>ownedIds.has(id)&&r.Type==="AWS::IAM::Policy"&&r.Properties.Roles.includes(roleName));
  const resolve=v=>Array.isArray(v)?v.map(resolve):v&&typeof v==="object"?(same(v,{Ref:POOL_PARAMETER})?ownerPool:Object.fromEntries(Object.entries(v).map(([k,x])=>[k,resolve(x)]))):v;
  const originalPolicies=policies.filter(p=>!declared.some(([,r])=>p.type==="inline"&&p.name===r.Properties.PolicyName&&p.sha256===sha(canonical(resolve(r.Properties.PolicyDocument)))));
  const observed={roleId:snapshot.roleId,trustSha256:sha(canonical(snapshot.trust)),policySha256:sha(canonical(originalPolicies)),boundarySha256:sha(canonical(snapshot.boundary))};
  const expected=manifest.externalRolePolicyBaselines[roleName];
  if(!expected||expected.roleId!==observed.roleId||expected.trustSha256!==observed.trustSha256||(expected.policySha256||expected.policySetSha256)!==observed.policySha256||snapshot.boundary!==null)fail("production_identities_external_role_changed");
  const added=Object.entries(manifest.template.Resources).filter(([id,r])=>!ownedIds.has(id)&&r.Type==="AWS::IAM::Policy"&&r.Properties.Roles.includes(roleName)).map(([,r])=>r);
  if(Object.values(snapshot.policySizes).reduce((n,v)=>n+v,0)+added.reduce((n,r)=>n+Buffer.byteLength(canonical(r.Properties.PolicyDocument)),0)>10240)fail("production_identities_policy_size_invalid");
  snapshots[roleName]={...observed,policies};
 }
 return snapshots;
}
function capturePackageBucket(call,ownedResources){
 let exists=true;try{call("lookup","s3api","head-bucket",{Bucket:PACKAGE_BUCKET,ExpectedBucketOwner:ACCOUNT});}catch(error){if(!["404","NoSuchBucket"].includes(error.causeCode))throw error;exists=false;}
 const owned=ownedResources.filter(r=>r.LogicalResourceId==="ThnProductionReleaseBucket");
 if(!exists){if(owned.length)fail("production_identities_bucket_disappeared");return {exists:false};}
 if(owned.length!==1||owned[0].PhysicalResourceId!==PACKAGE_BUCKET||owned[0].ResourceType!=="AWS::S3::Bucket")fail("production_identities_unowned_bucket_exists");
 const q={Bucket:PACKAGE_BUCKET,ExpectedBucketOwner:ACCOUNT},versioning=call("lookup","s3api","get-bucket-versioning",q),encryption=call("lookup","s3api","get-bucket-encryption",q),block=call("lookup","s3api","get-public-access-block",q),ownership=call("lookup","s3api","get-bucket-ownership-controls",q);
 if(versioning.Status!=="Enabled"||encryption.ServerSideEncryptionConfiguration?.Rules?.length!==1||encryption.ServerSideEncryptionConfiguration.Rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm!=="AES256"||!same(block.PublicAccessBlockConfiguration,packageResources().ThnProductionReleaseBucket.Properties.PublicAccessBlockConfiguration)||!same(ownership.OwnershipControls,packageResources().ThnProductionReleaseBucket.Properties.OwnershipControls))fail("production_identities_bucket_config_invalid");
 const policy=call("lookup","s3api","get-bucket-policy",q).Policy;
 if(!same(typeof policy==="string"?JSON.parse(policy):policy,packageResources().ThnProductionReleaseBucketPolicy.Properties.PolicyDocument))fail("production_identities_bucket_policy_invalid");
 return {exists:true,versioning,encryption,block,ownership,policySha256:sha(canonical(typeof policy==="string"?JSON.parse(policy):policy))};
}
function captureBaseline(call,manifest,ownedStackId){
 const newRoles={};
 const auth=call("lookup","cloudformation","list-stack-resources",{StackName:"zoolanding-auth-admin-prod"});if(auth.NextToken)fail("production_identities_pool_inventory_incomplete");
 const pools=(auth.StackResourceSummaries||[]).filter(r=>r.LogicalResourceId==="ThnAuthAdminV2UserPool");if(pools.length>1||pools.some(r=>r.ResourceType!=="AWS::Cognito::UserPool"||!/^us-east-1_[A-Za-z0-9]+$/.test(r.PhysicalResourceId||"")))fail("production_identities_pool_identity_invalid");
 const ownerPool=pools.length?{arn:`arn:aws:cognito-idp:${REGION}:${ACCOUNT}:userpool/${pools[0].PhysicalResourceId}`,nativeIdentitySha256:sha(canonical(cert.identities(pools)))}:{arn:"BLOCKED",nativeIdentitySha256:sha(canonical([]))};
 let stack;try{stack=call("lookup","cloudformation","describe-stacks",{StackName:ownedStackId||STACK}).Stacks?.[0];}catch(error){if(error.causeCode!=="ValidationError"||ownedStackId)throw error;}
 const nativeResources=stack?call("lookup","cloudformation","list-stack-resources",{StackName:stack.StackId}):{StackResourceSummaries:[]};if(nativeResources.NextToken)fail("production_identities_baseline_incomplete");
 const packageBucket=capturePackageBucket(call,nativeResources.StackResourceSummaries);
 const externalRoles=captureExternalRoles(call,manifest,nativeResources.StackResourceSummaries,ownerPool.arn);
 for(const name of NEW_ROLES){try{newRoles[name]=cert.rolePolicySnapshot((service,op,args)=>call("lookup",service,op,args),`arn:aws:iam::${ACCOUNT}:role/${name}`);}catch(error){if(error.causeCode!=="NoSuchEntity")throw error;newRoles[name]=null;}}
 if(!stack){if(Object.values(newRoles).some(Boolean))fail("production_identities_unowned_role_exists");return {stackId:null,templates:null,resources:[],newRoles,externalRoles,ownerPool,packageBucket};}
 if(stack.StackName!==STACK||!new RegExp(`^arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/[A-Za-z0-9-]+$`).test(stack.StackId||"")||stack.RoleARN!==roles["cfn-exec"]||!["REVIEW_IN_PROGRESS","CREATE_COMPLETE","UPDATE_COMPLETE"].includes(stack.StackStatus))fail("production_identities_stack_invalid");
 const resources=nativeResources;
 if(stack.StackStatus==="REVIEW_IN_PROGRESS"){
  if(!ownedStackId||resources.StackResourceSummaries?.length||Object.values(newRoles).some(Boolean))fail("production_identities_unowned_preview");
  return {stackId:stack.StackId,templates:null,resources:[],newRoles,externalRoles,ownerPool,packageBucket};
 }
 const templates={};for(const stage of ["Original","Processed"]){const raw=call("lookup","cloudformation","get-template",{StackName:stack.StackId,TemplateStage:stage}).TemplateBody;templates[stage]=typeof raw==="string"?JSON.parse(raw):raw;}
 if(Object.entries(templates.Original.Resources||{}).some(([id,r])=>!["AWS::IAM::Role","AWS::IAM::Policy","AWS::IAM::ManagedPolicy"].includes(r.Type)&&!same(packageResources()[id],r)))fail("production_identities_stack_invalid");
 const parameters=(stack.Parameters||[]).map(({ParameterKey,ParameterValue,ResolvedValue})=>({ParameterKey,ParameterValue,...(ResolvedValue===undefined?{}:{ResolvedValue})})).sort((a,b)=>a.ParameterKey.localeCompare(b.ParameterKey));
 return {stackId:stack.StackId,templates,parameters,terminationProtection:stack.EnableTerminationProtection===true,resources:cert.identities(resources.StackResourceSummaries),newRoles,externalRoles,ownerPool,packageBucket};
}
function trustPermissionProof(call){
 const metadata=call("lookup","cloudformation","describe-type",{Type:"RESOURCE",TypeName:"AWS::IAM::Role"}),schema=JSON.parse(metadata.Schema);
 if(!schema.handlers?.update?.permissions?.includes("iam:UpdateAssumeRolePolicy")||!schema.handlers?.read?.permissions?.includes("iam:GetRole"))fail("production_identities_trust_permissions_invalid");
 const actions=["iam:getrole","iam:updateassumerolepolicy"],requests=[];
 for(const name of TRUST_ROLES.keys()){
  const resource=`arn:aws:iam::${ACCOUNT}:role/${name}`,response=call("lookup","iam","simulate-principal-policy",{PolicySourceArn:roles["cfn-exec"],ActionNames:actions,ResourceArns:[resource]});
  if(response.IsTruncated||response.Marker||response.EvaluationResults?.length!==2)fail("production_identities_trust_permissions_invalid");
  const seen=new Set();for(const r of response.EvaluationResults){if(!actions.includes(r.EvalActionName)||seen.has(r.EvalActionName)||r.EvalResourceName!==resource||r.EvalDecision!=="allowed"||r.MissingContextValues?.length||r.ResourceSpecificResults?.some(x=>x.EvalResourceName!==resource||x.EvalResourceDecision!=="allowed"||x.MissingContextValues?.length))fail("production_identities_trust_permissions_invalid");seen.add(r.EvalActionName);}
  requests.push({resource,actions,decision:"allowed"});
 }
 const execution=cert.rolePolicySnapshot((s,o,i)=>call("lookup",s,o,i),roles["cfn-exec"]);
 if(!same(execution.trust.Statement,[{Effect:"Allow",Action:"sts:AssumeRole",Principal:{Service:"cloudformation.amazonaws.com"}}]))fail("production_identities_trust_permissions_invalid");
 return {schemaSha256:sha(canonical(schema)),execution,requests};
}
function trustBaseline(baseline){
 if(!baseline.stackId||!baseline.templates||baseline.ownerPool?.arn!=="BLOCKED"||!baseline.packageBucket?.exists||!same(baseline.templates.Original,baseline.templates.Processed)||!same(baseline.parameters,[{ParameterKey:POOL_PARAMETER,ParameterValue:"BLOCKED"}]))fail("production_identities_trust_baseline_invalid");
 for(const r of Object.values(baseline.templates.Original.Resources))if(r.Type==="AWS::IAM::Role"){
  const fresh=baseline.newRoles[r.Properties.RoleName];if(!fresh?.roleId||!same(fresh.trust,r.Properties.AssumeRolePolicyDocument)||fresh.boundary!==null)fail("production_identities_trust_baseline_invalid");
 }
 return baseline;
}
function verifyTrustPost(before,after,candidate){
 const expected=structuredClone(before);expected.templates={Original:candidate,Processed:candidate};
 for(const name of TRUST_ROLES.keys())expected.newRoles[name].trust={Version:"2012-10-17",Statement:[githubStatement(name)]};
 if(!same(expected,after))fail("production_identities_trust_post_mismatch");return true;
}
function nativeFields(call,baseline,candidate,manifest,fingerprint,sourceSha,native,coordinate,scope="bootstrap"){
 if(baseline.stackId&&native.StackId!==baseline.stackId)fail("production_identities_native_mismatch");
 const templates={};for(const stage of ["Original","Processed"]){const raw=call("deploy","cloudformation","get-template",{StackName:native.StackId,ChangeSetName:native.ChangeSetId,TemplateStage:stage}).TemplateBody;templates[stage]=typeof raw==="string"?JSON.parse(raw):raw;if(!same(templates[stage],candidate))fail("production_identities_native_mismatch");}
 if(scope==="trust-patch"){
  reviewTrustInventory(baseline.templates.Original,candidate,native);
  if(!same(native.Parameters,[{ParameterKey:POOL_PARAMETER,ParameterValue:"BLOCKED"}]))fail("production_identities_trust_parameters_invalid");
 }else reviewInventory(baseline.templates?.Original,candidate,native,baseline.resources,baseline.ownerPool?.arn||"BLOCKED");
 return {sourceSha,sourcePackageSha256:fingerprint,baselineSha256:sha(canonical(baseline)),identitySha256:sha(canonical(baseline.resources)),permissionSha256:sha(canonical({external:baseline.externalRoles,newRoles:baseline.newRoles,proofMatrix:manifest.proofMatrix,providerSchemaHashes:manifest.providerSchemaHashes})),originalTemplateSha256:sha(canonical(templates.Original)),processedTemplateSha256:sha(canonical(templates.Processed)),parametersSha256:sha(canonical(native.Parameters||[])),nativeInventorySha256:retained.hash(native.Changes),changes:retained.inventorySummary(native.Changes),packageManifest:[coordinate]};
}
function sealTemplate(call,dir,bytes,label){
 const key=`thn-production/deployment-identities/${sha(bytes)}.json`,file=path.join(dir,label+".json");fs.writeFileSync(file,bytes,{mode:0o600,flag:"wx"});
 const listed=call("file-publishing","s3api","list-objects-v2",{Bucket:ASSET_BUCKET,Prefix:key,MaxKeys:2,ExpectedBucketOwner:ACCOUNT});if(listed.IsTruncated)fail("production_identities_package_invalid");
 const matches=(listed.Contents||[]).filter(o=>o.Key===key);if(matches.length>1)fail("production_identities_package_invalid");
 const upload=matches.length?call("file-publishing","s3api","head-object",{Bucket:ASSET_BUCKET,Key:key,ExpectedBucketOwner:ACCOUNT}):call("file-publishing","s3api","put-object",{Bucket:ASSET_BUCKET,Key:key,Body:file,ExpectedBucketOwner:ACCOUNT,IfNoneMatch:"*",ServerSideEncryption:"aws:kms",ContentType:"application/json"});
 const coordinate={bucket:ASSET_BUCKET,key,versionId:upload.VersionId,sha256:sha(bytes)};readSealed(call,coordinate,dir,bytes);return coordinate;
}
function readSealed(call,coordinate,dir,bytes){
 if(coordinate.bucket!==ASSET_BUCKET||!/^thn-production\/deployment-identities\/[a-f0-9]{64}\.json$/.test(coordinate.key)||!coordinate.versionId||coordinate.versionId==="null"||coordinate.sha256!==sha(bytes))fail("production_identities_package_invalid");
 const out=path.join(dir,"readback.json"),read=call("file-publishing","s3api","get-object",{Bucket:ASSET_BUCKET,Key:coordinate.key,VersionId:coordinate.versionId,ExpectedBucketOwner:ACCOUNT},out);
 if(read.VersionId!==coordinate.versionId||!fs.readFileSync(out).equals(bytes))fail("production_identities_package_invalid");
}
async function runIdentities(options){
 const {call,manifest,sourceSha,fingerprint,execution,runId}=options,scope=options.scope||"bootstrap",purpose=scope==="trust-patch"?"deployment-identities-trust-patch":"deployment-identities";validateManifest(manifest);
 if(!["bootstrap","trust-patch"].includes(scope)||!["review","execute","cleanup"].includes(execution)||!/^[a-f0-9]{40}$/.test(sourceSha)||!/^[a-f0-9]{64}$/.test(fingerprint)||!/^\d+-\d+$/.test(runId))fail("production_identities_operation_invalid");
 const record=execution==="review"?undefined:retained.validateReview(options.record);
 if(record&&(record.purpose!==purpose||record.sourceSha!==sourceSha||record.sourcePackageSha256!==fingerprint||record.digest!==options.approvedDigest))fail("production_identities_review_invalid");
 if(execution==="cleanup"){
  const native=call("deploy","cloudformation","describe-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});
  if(native.StackId!==record.stackId||native.ChangeSetId!==record.changeSetArn||native.Status!=="CREATE_COMPLETE"||native.ExecutionStatus!=="AVAILABLE"||retained.hash(native.Changes)!==record.nativeInventorySha256)fail("production_identities_review_invalid");
  call("deploy","cloudformation","delete-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn});return {cleanup:true,changeSetArn:record.changeSetArn};
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-production-identities-")),rawCapture=options.captureBaseline||captureBaseline;
 const capture=(...args)=>{const b=rawCapture(...args);if(scope==="trust-patch"){trustBaseline(b);b.trustPermissionProof=trustPermissionProof(call);}return b;};
 try{
  const baseline=capture(call,manifest,record?.stackId),candidate=scope==="trust-patch"?composeTrustPatch(baseline.templates.Original,manifest):compose(baseline.templates?.Original,manifest),bytes=Buffer.from(canonical(candidate)+"\n"),pause=options.pause||((ms)=>new Promise(r=>setTimeout(r,ms)));
  const recoveryBytes=scope==="trust-patch"?[Buffer.from(canonical(baseline.templates.Original)+"\n"),Buffer.from(canonical(baseline)+"\n")]:[];
  if(execution==="review"){
   const coordinate=sealTemplate(call,dir,bytes,"candidate"),key=coordinate.key,recoveryCoordinates=recoveryBytes.map((b,i)=>sealTemplate(call,dir,b,"recovery"+i));
   if(!same(capture(call,manifest),baseline))fail("production_identities_baseline_changed");options.verifySource?.();
   const parameters=candidate.Parameters?[{ParameterKey:POOL_PARAMETER,ParameterValue:baseline.ownerPool.arn}]:[];
   const response=call("deploy","cloudformation","create-change-set",{StackName:baseline.stackId||STACK,ChangeSetName:`thn-production-${purpose}-${runId}`,ChangeSetType:baseline.templates?"UPDATE":"CREATE",TemplateURL:`https://${ASSET_BUCKET}.s3.${REGION}.amazonaws.com/${key}?versionId=${encodeURIComponent(coordinate.versionId)}`,Parameters:parameters,Capabilities:["CAPABILITY_NAMED_IAM"],RoleARN:roles["cfn-exec"],Description:`THN production deployment identities source ${sourceSha}; retained preview expires after24hours`});
   const native=await cert.waitPreview(call,response.StackId||baseline.stackId||STACK,response.Id,pause),owned=capture(call,manifest,native.StackId);
   if(!same({...owned,stackId:baseline.stackId},baseline))fail("production_identities_baseline_changed");
   const fields=nativeFields(call,owned,candidate,manifest,fingerprint,sourceSha,native,coordinate,scope),createdAt=new Date(native.CreationTime).toISOString();
   const reviewed=retained.sealReview({schemaVersion:1,contract:"thn-production-retained-review/v1",environment:"production",service:"infra",purpose,stackId:native.StackId,changeSetArn:native.ChangeSetId,createdAt,expiresAt:new Date(Date.parse(createdAt)+86400000).toISOString(),...fields,recoveryCoordinates});
   fs.writeFileSync(options.outputPath,JSON.stringify(reviewed,null,2)+"\n",{flag:"wx",mode:0o600});return reviewed;
  }
  if(record.packageManifest.length!==1||record.recoveryCoordinates.length!==recoveryBytes.length)fail("production_identities_review_invalid");const coordinate=record.packageManifest[0];readSealed(call,coordinate,dir,bytes);
  recoveryBytes.forEach((b,i)=>readSealed(call,record.recoveryCoordinates[i],dir,b));
  const native=call("deploy","cloudformation","describe-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true}),fields=nativeFields(call,baseline,candidate,manifest,fingerprint,sourceSha,native,coordinate,scope);
  retained.verifyRetainedExecution(record,options.approvedDigest,fields,native);
  if(!same(capture(call,manifest,record.stackId),baseline))fail("production_identities_baseline_changed");options.verifySource?.();
  const last=call("deploy","cloudformation","describe-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});retained.verifyRetainedExecution(record,options.approvedDigest,fields,last);
  call("deploy","cloudformation","execute-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn,ClientRequestToken:`thn-identities-${record.digest}`});
  let stack;for(let i=0;i<120;i++){stack=call("deploy","cloudformation","describe-stacks",{StackName:record.stackId}).Stacks?.[0];if(["CREATE_COMPLETE","UPDATE_COMPLETE"].includes(stack?.StackStatus))break;if(!["CREATE_IN_PROGRESS","UPDATE_IN_PROGRESS","UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"].includes(stack?.StackStatus))fail("production_identities_execution_failed");await pause(5000);}
  if(!["CREATE_COMPLETE","UPDATE_COMPLETE"].includes(stack?.StackStatus))fail("production_identities_execution_timeout");
  for(const stage of ["Original","Processed"]){const raw=call("lookup","cloudformation","get-template",{StackName:record.stackId,TemplateStage:stage}).TemplateBody;if(!same(typeof raw==="string"?JSON.parse(raw):raw,candidate))fail("production_identities_post_template_mismatch");}
  // Existing trusts and every unrelated inline/managed policy must remain intact.
  for(const name of Object.keys(baseline.externalRoles)){const old=baseline.externalRoles[name],fresh=cert.rolePolicySnapshot((s,o,i)=>call("lookup",s,o,i),`arn:aws:iam::${ACCOUNT}:role/${name}`);if(fresh.roleId!==old.roleId||sha(canonical(fresh.trust))!==old.trustSha256||fresh.boundary!==null)fail("production_identities_post_external_changed");for(const p of old.policies){const k=p.type==="inline"?"inline:"+p.name:p.name;if(fresh.policies[k]!==p.sha256)fail("production_identities_post_external_changed");}}
  const inventory=call("lookup","cloudformation","list-stack-resources",{StackName:record.stackId});if(inventory.NextToken||inventory.StackResourceSummaries?.length!==activeIds(candidate,baseline.ownerPool?.arn||"BLOCKED").length)fail("production_identities_post_inventory_mismatch");
  const previous=new Map(baseline.resources.map(r=>[r.LogicalResourceId,r]));for(const r of cert.identities(inventory.StackResourceSummaries)){if(previous.has(r.LogicalResourceId)&&!same(r,previous.get(r.LogicalResourceId)))fail("production_identities_post_identity_mismatch");previous.delete(r.LogicalResourceId);}if(previous.size)fail("production_identities_post_identity_mismatch");
  capturePackageBucket(call,inventory.StackResourceSummaries);
  if(scope==="trust-patch")verifyTrustPost(baseline,capture(call,manifest,record.stackId),candidate);
  return {complete:true,digest:record.digest,stackId:record.stackId,effectivePermissionProof:"required-before-service-activation"};
 }finally{if(path.dirname(dir)!==os.tmpdir())fail("production_cli_cleanup_invalid");fs.rmSync(dir,{recursive:true});}
}
module.exports.captureBaseline=captureBaseline;module.exports.runIdentities=runIdentities;
module.exports.trustPermissionProof=trustPermissionProof;module.exports.trustBaseline=trustBaseline;module.exports.verifyTrustPost=verifyTrustPost;
if(require.main===module){(async()=>{
 const e=process.env;if(e.GITHUB_REPOSITORY!=="LynxPardelle/zoolandingpage-aws-infra"||e.GITHUB_REF!=="refs/heads/main"||e.GITHUB_EVENT_NAME!=="workflow_dispatch"||e.GITHUB_SHA!==e.EXPECTED_SOURCE_SHA)fail("production_source_authority_invalid");
 const fingerprint=sourcePackageHash();if(fingerprint!==e.EXPECTED_SOURCE_PACKAGE_SHA256)fail("production_source_package_changed");
 const manifest=JSON.parse(fs.readFileSync(path.resolve(__dirname,"production/thn-deployment-identities.json"))),record=e.EXECUTION==="review"?undefined:JSON.parse(fs.readFileSync(path.resolve(e.REVIEW_FILE),"utf8"));
 const result=await runIdentities({call:cert.productionClients(e,`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`),manifest,sourceSha:e.EXPECTED_SOURCE_SHA,fingerprint,execution:e.EXECUTION,scope:e.IDENTITY_SCOPE,runId:`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`,record,approvedDigest:e.EXPECTED_REVIEW_DIGEST,outputPath:path.resolve("identities-review.json"),verifySource:()=>cert.assertCurrentProductionSource(e.EXPECTED_SOURCE_SHA,e)});console.log(JSON.stringify(result));
})().catch(error=>{console.error(JSON.stringify({error:/^[a-z0-9_]+$/.test(error.message)?error.message:"production_identities_failed",...(error.causeCode?{cause_code:error.causeCode}:{}),...(Number.isInteger(error.cliExitCode)?{cli_exit_status:error.cliExitCode}:{})}));process.exitCode=1;});}
