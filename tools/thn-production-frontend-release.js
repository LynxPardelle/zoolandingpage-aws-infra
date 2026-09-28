"use strict";
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const certificate=require("./thn-production-certificate-release"),retained=require("./thn-production-retained-review"),origins=require("./thn-production-origins"),projection=require("./thn-production-frontend-projection"),admin=require("./thn-admin-release");
const {canonical,sha,ACCOUNT,REGION,STACK,ASSET_BUCKET,roles}=certificate,same=(a,b)=>canonical(a)===canonical(b),fail=c=>{throw Error(c);};
const ARTIFACT_BUCKET="zoolandingpage-production-frontend-artifacts-765932874577",STATIC_BUCKET="zoolandingpage-public-files";
function validateInput(input){
 const keys=["schemaVersion","purpose","sourceSha","publicReleaseId","selection","ownerSnapshot","certificateArn","appCoordinates"];
 if(!input||!same(Object.keys(input).sort(),keys.sort())||input.schemaVersion!==1||!["private-frontdoor","public-visual"].includes(input.purpose)||!/^[a-f0-9]{40}$/.test(input.sourceSha)||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(input.publicReleaseId)||input.publicReleaseId.includes(".."))fail("production_frontend_input_invalid");
 admin.validateSelection(input.selection,"production");origins.validateProductionOrigins(input.ownerSnapshot);
 if(!/^arn:aws:acm:us-east-1:765932874577:certificate\/[a-f0-9-]{36}$/.test(input.certificateArn))fail("production_frontend_input_invalid");
 const c=input.appCoordinates,m=input.selection.metadata;
 if(!c||!same(Object.keys(c).sort(),["artifactId","sourceSha","runId","runAttempt","deliverySha256","manifestSha256"].sort())||!/^[1-9][0-9]*$/.test(c.artifactId)||c.sourceSha!==m.sourceCommit||c.runId!==m.runId||c.runAttempt!==m.runAttempt||c.deliverySha256!==m.deliverySha256||c.manifestSha256!==m.manifestSha256)fail("production_frontend_input_invalid");
 return input;
}
function prepareFrontend(input,destination){
 validateInput(input);
 // These values are source inputs to CDK, never a browser environment selector.
 process.env.FRONTEND_PRODUCTION_RELEASE_ID=input.purpose==="private-frontdoor"?input.publicReleaseId:input.selection.metadata.releaseId;
 process.env.FRONTEND_PRODUCTION_THN_PUBLIC_ORIGIN_ENABLED="true";
 process.env.FRONTEND_PRODUCTION_THN_PUBLIC_ROUTE53_RECORDS_ENABLED="true";
 process.env.FRONTEND_PRODUCTION_THN_PUBLIC_CERTIFICATE_ARN="arn:aws:acm:us-east-1:765932874577:certificate/fdabc4b5-dc47-479b-abc4-ae601b80b63c";
 process.env.FRONTEND_PRODUCTION_CUSTOM_DOMAIN_NAMES_ENABLED="true";
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_ORIGIN_ENABLED="true";
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_ROUTE53_RECORDS_ENABLED="true";
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_CERTIFICATE_ARN=input.certificateArn;
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_HOSTED_ZONE_ID="Z08032292DKYZ4QGCIZDR";
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_OWNER_SNAPSHOT_JSON=JSON.stringify(input.ownerSnapshot);
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_MANIFEST_BASE64=input.selection.manifestBase64;
 process.env.FRONTEND_PRODUCTION_THN_ADMIN_RELEASE_METADATA_JSON=JSON.stringify(input.selection.metadata);
 const cdk=require("aws-cdk-lib"),{FrontendStack}=require("../lib/stacks/frontend-stack"),{environments}=require("../config/environments");
 const environment=environments.find(e=>e.name==="production");
 const app=new cdk.App({outdir:path.join(destination,"assembly")}),stage=new cdk.Stage(app,"ZoolandingProduction",{env:{account:ACCOUNT,region:REGION}}),stack=new FrontendStack(stage,"Zoolandingpage-production-Frontend",{env:{account:ACCOUNT,region:REGION},environment,stackName:STACK});
 const desired=stage.synth().getStackArtifact(stack.artifactId).template;
 fs.mkdirSync(destination,{recursive:true});fs.writeFileSync(path.join(destination,"desired-template.json"),JSON.stringify(desired,null,2)+"\n");fs.writeFileSync(path.join(destination,"release-input.json"),JSON.stringify(input,null,2)+"\n");
 return {desiredTemplateSha256:sha(canonical(desired)),inputSha256:sha(canonical(input))};
}
function sourcePackageHash(){return sha(canonical(Object.fromEntries(["tools/thn-production-frontend-release.js","tools/thn-production-frontend-projection.js","tools/thn-production-origins.js","tools/thn-production-certificate-release.js","tools/thn-production-retained-review.js","tools/thn-admin-release.js","config/environments.js","lib/stacks/frontend-stack.js","lib/project-helpers.js",".github/workflows/thn-production-frontend.yml","package.json","package-lock.json"].map(p=>[p,sha(fs.readFileSync(path.resolve(__dirname,"..",p)))]))));}
function getObject(call,bucket,key,directory,versionId){
 if(![ARTIFACT_BUCKET,STATIC_BUCKET,ASSET_BUCKET].includes(bucket)||!/^frontend\/angular-ssr\/production\/releases\/[A-Za-z0-9._/-]+$/.test(key)&&!/^thn-production\/[A-Za-z0-9._/-]+$/.test(key)||key.split("/").some(s=>!s||s===".."||s==="."))fail("production_release_object_invalid");
 const file=path.join(directory,sha(bucket+key)+".object");
 const header=call(bucket===ASSET_BUCKET?"file-publishing":"lookup","s3api","head-object",{Bucket:bucket,Key:key,...(versionId?{VersionId:versionId}:{}),ExpectedBucketOwner:ACCOUNT});
 if(bucket!==STATIC_BUCKET&&(!header.VersionId||header.VersionId==="null"))fail("production_release_object_unversioned");
 const response=call(bucket===ASSET_BUCKET?"file-publishing":"lookup","s3api","get-object",{Bucket:bucket,Key:key,...(header.VersionId&&header.VersionId!=="null"?{VersionId:header.VersionId}:{}),ExpectedBucketOwner:ACCOUNT},file);
 if(response.VersionId!==header.VersionId||response.ETag!==header.ETag)fail("production_release_object_changed");
 return {bytes:fs.readFileSync(file),versionId:header.VersionId,key,bucket};
}
async function publishedProof(call,input,dir){
 const selected=admin.validateSelection(input.selection,"production"),observed=new Map();
 const read=async key=>{const object=getObject(call,ARTIFACT_BUCKET,key,dir);observed.set(key,object);return object.bytes;};
 await admin.verifyPublishedAdminRelease(selected,read,"production");
 const delivery=JSON.parse(observed.get(selected.originPrefix+"/delivery.json").bytes),manifest=JSON.parse(observed.get(selected.originPrefix+"/manifest.json").bytes);
 const code=getObject(call,ARTIFACT_BUCKET,selected.originPrefix+"/server/ssr-handler.zip",dir);observed.set(code.key,code);
 const codeSha=delivery.files.find(f=>f.path==="ssr-handler.zip")?.sha256;if(sha(code.bytes)!==codeSha||manifest.checksums?.["server/ssr-handler.zip"]!==codeSha)fail("production_release_zip_mismatch");
 const browser=[];
 for(const file of delivery.files.filter(f=>f.path.startsWith("staging/browser/"))){
  const key=selected.originPrefix+"/"+file.path.slice("staging/".length),object=getObject(call,STATIC_BUCKET,key,dir);
  if(sha(object.bytes)!==file.sha256)fail("production_release_browser_mismatch");browser.push({key,sha256:file.sha256,versionId:object.versionId||null});
 }
 if(!browser.length)fail("production_release_browser_mismatch");
 const assets=[...observed.values()].map(o=>({bucket:o.bucket,key:o.key,versionId:o.versionId,sha256:sha(o.bytes)}));
 return {assets,browserSha256:sha(canonical(browser)),codeVersionId:code.versionId,codeSha256:codeSha};
}
function selectedBaseline(call,input){
 const baseline=certificate.readProductionBaseline(call,{certificateAbsent:false,adminMustAbsent:false});
 if(!baseline.terminationProtection)fail("production_frontend_termination_protection_required");
 const nativeOrigins=origins.captureProductionOrigins((...a)=>call("lookup",...a));if(!same(nativeOrigins,input.ownerSnapshot))fail("production_owner_snapshot_changed");
 const owned=baseline.resources.filter(r=>r.LogicalResourceId==="ThnAdminProductionCertificate");
 if(owned.length!==1||owned[0].PhysicalResourceId!==input.certificateArn)fail("production_certificate_identity_mismatch");
 const c=call("lookup","acm","describe-certificate",{CertificateArn:input.certificateArn}).Certificate;
 if(c?.DomainName!=="admin.thehairnarrative.com"||c.Status!=="ISSUED"||!same(c.SubjectAlternativeNames,["admin.thehairnarrative.com"]))fail("production_certificate_identity_mismatch");
 const privateResource=baseline.resources.find(r=>r.LogicalResourceId==="FrontendDistributionThehairnarrativeAdminProductionF99395A3");
 if(input.purpose==="private-frontdoor"&&!privateResource&&baseline.dns.some(r=>r.Name==="admin.thehairnarrative.com."))fail("production_admin_dns_conflict");
 const lambdas={},distributions={};
 for(const r of baseline.resources){
  if(r.ResourceType==="AWS::Lambda::Function"&&["zoolandingpage-production-frontend-ssr","zoolandingpage-production-frontend-thn-admin-ssr"].includes(r.PhysicalResourceId)){
   const cfg=call("lookup","lambda","get-function-configuration",{FunctionName:r.PhysicalResourceId});if(cfg.FunctionName!==r.PhysicalResourceId||cfg.State!=="Active"||cfg.LastUpdateStatus!=="Successful")fail("production_lambda_baseline_invalid");lambdas[r.LogicalResourceId]=cfg;
  }
  if(r.ResourceType==="AWS::CloudFront::Distribution")distributions[r.LogicalResourceId]=call("lookup","cloudfront","get-distribution-config",{Id:r.PhysicalResourceId});
 }
 const authResources=call("lookup","cloudformation","list-stack-resources",{StackName:input.ownerSnapshot.owners.thnAuthAdmin.stackId});
 if(authResources.NextToken)fail("production_auth_resource_inventory_incomplete");
 const authorizer=authResources.StackResourceSummaries?.filter(r=>r.LogicalResourceId==="ThnAuthAdminV2OriginAuthorizerFunction"&&r.ResourceType==="AWS::Lambda::Function");
 if(authorizer?.length!==1)fail("production_origin_secret_owner_mismatch");
 const auth=call("lookup","lambda","get-function-configuration",{FunctionName:authorizer[0].PhysicalResourceId}),authEnv=auth.Environment?.Variables;
 if(authEnv?.THN_DEPLOYMENT_ENVIRONMENT!=="production"||!/^[a-f0-9]{64}$/.test(authEnv.THN_AUTH_V2_ORIGIN_HEADER_SHA256_CURRENT||""))fail("production_origin_secret_owner_mismatch");
 const authorizerEvidence={functionArn:auth.FunctionArn,codeSha256:auth.CodeSha256,revisionId:auth.RevisionId,currentOriginSha256:authEnv.THN_AUTH_V2_ORIGIN_HEADER_SHA256_CURRENT,previousOriginSha256:authEnv.THN_AUTH_V2_ORIGIN_HEADER_SHA256_PREVIOUS||null};
 const publicFunction=Object.values(lambdas).find(f=>f.FunctionName==="zoolandingpage-production-frontend-ssr");
 if(publicFunction?.Environment?.Variables?.ZLP_RELEASE_ID!==input.publicReleaseId)fail("production_public_baseline_release_changed");
 return {...baseline,lambdas,distributions,authorizerEvidence,ownerSnapshotSha256:origins.snapshotDigest(nativeOrigins)};
}
module.exports={validateInput,prepareFrontend,sourcePackageHash,getObject,publishedProof,selectedBaseline};

function candidateFor(b,desired,input,proof){
 const template=input.purpose==="private-frontdoor"?projection.projectPrivateFrontdoor(b.templates.Original,desired,input.selection.metadata.releaseId):projection.projectPublicVisual(b.templates.Original,desired,input.selection.metadata.releaseId);
 for(const r of Object.values(template.Resources))if(r.Type==="AWS::Lambda::Function"&&r.Properties?.Code?.S3Key===input.selection.originPrefix+"/server/ssr-handler.zip")r.Properties.Code.S3ObjectVersion=proof.codeVersionId;
 return template;
}
function uploadSealed(call,bytes,purpose,dir){
 const key=`thn-production/${purpose}/${sha(bytes)}.json`,file=path.join(dir,sha(bytes)+".json");fs.writeFileSync(file,bytes,{mode:0o600});
 const listed=call("file-publishing","s3api","list-objects-v2",{Bucket:ASSET_BUCKET,Prefix:key,MaxKeys:2,ExpectedBucketOwner:ACCOUNT});if(listed.IsTruncated)fail("production_asset_listing_invalid");
 const found=(listed.Contents||[]).filter(x=>x.Key===key);if(found.length>1)fail("production_asset_listing_invalid");
 const result=found.length?call("file-publishing","s3api","head-object",{Bucket:ASSET_BUCKET,Key:key,ExpectedBucketOwner:ACCOUNT}):call("file-publishing","s3api","put-object",{Bucket:ASSET_BUCKET,Key:key,ExpectedBucketOwner:ACCOUNT,Body:file,IfNoneMatch:"*",ContentType:"application/json",ServerSideEncryption:"aws:kms"});
 const obj=getObject(call,ASSET_BUCKET,key,dir,result.VersionId);if(!obj.bytes.equals(bytes))fail("production_asset_readback_invalid");return {bucket:ASSET_BUCKET,key,versionId:result.VersionId,sha256:sha(bytes)};
}
function recoveryProof(call,b,dir){
 const template=structuredClone(b.templates.Original),assets=[];
 for(const [id,cfg] of Object.entries(b.lambdas)){
  const resource=template.Resources[id],code=resource?.Properties?.Code;
  if(resource?.Type!=="AWS::Lambda::Function"||!projection.ownedArtifactBucket(template,code?.S3Bucket))fail("production_recovery_code_invalid");
  const object=getObject(call,ARTIFACT_BUCKET,code.S3Key,dir,code.S3ObjectVersion);
  if(Buffer.from(cfg.CodeSha256,"base64").toString("hex")!==sha(object.bytes))fail("production_recovery_code_mismatch");
  code.S3ObjectVersion=object.versionId;assets.push({bucket:object.bucket,key:object.key,versionId:object.versionId,sha256:sha(object.bytes)});
 }
 if(!assets.length)fail("production_recovery_code_invalid");
 return {template,assets};
}
module.exports.recoveryProof=recoveryProof;
function nativeReviewFields(call,b,candidate,input,fingerprint,description,packageManifest,proof){
 const bodies={};for(const stage of ["Original","Processed"]){const raw=call("deploy","cloudformation","get-template",{StackName:b.stackId,ChangeSetName:description.ChangeSetId,TemplateStage:stage}).TemplateBody;bodies[stage]=typeof raw==="string"?JSON.parse(raw):raw;if(!same(bodies[stage],candidate))fail("production_frontend_native_template_mismatch");}
 projection.reviewFrontendChanges(b.templates.Original,candidate,description);
 const publicProof={...b,trust:undefined,publishedBrowserSha256:proof.browserSha256};
 return {sourceSha:input.sourceSha,sourcePackageSha256:fingerprint,baselineSha256:sha(canonical(publicProof)),identitySha256:sha(canonical(b.resources)),permissionSha256:sha(canonical(b.trust)),originalTemplateSha256:sha(canonical(bodies.Original)),processedTemplateSha256:sha(canonical(bodies.Processed)),parametersSha256:sha(canonical(description.Parameters)),nativeInventorySha256:retained.hash(description.Changes),changes:retained.inventorySummary(description.Changes),packageManifest};
}
async function runFrontendOperation(options){
 const {call,input,desired,execution,runId,fingerprint}=options;validateInput(input);
 if(!["review","execute","cleanup"].includes(execution)||!/^\d+-\d+$/.test(runId)||!/^[a-f0-9]{64}$/.test(fingerprint))fail("production_frontend_operation_invalid");
 if(execution==="cleanup"){
  const record=retained.validateReview(options.record);if(record.purpose!==input.purpose||record.digest!==options.approvedDigest)fail("production_frontend_review_invalid");
  const stack=call("deploy","cloudformation","describe-stacks",{StackName:record.stackId}).Stacks?.[0],native=call("deploy","cloudformation","describe-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});
  if(stack?.StackId!==record.stackId||native.StackId!==record.stackId||native.ChangeSetId!==record.changeSetArn||native.Status!=="CREATE_COMPLETE"||native.ExecutionStatus!=="AVAILABLE"||retained.hash(native.Changes)!==record.nativeInventorySha256)fail("production_frontend_review_invalid");
  call("deploy","cloudformation","delete-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn});return {cleanup:true,changeSetArn:record.changeSetArn};
 }
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-frontend-production-")),pause=options.pause||((ms)=>new Promise(r=>setTimeout(r,ms))),captureBaseline=options.captureBaseline||selectedBaseline;
 try{
  const before=captureBaseline(call,input),proof=await publishedProof(call,input,dir),candidate=candidateFor(before,desired,input,proof),candidateBytes=Buffer.from(canonical(candidate)+"\n");
  if(input.purpose==="private-frontdoor"){
   const secret=options.originSecret;if(!/^[A-Za-z0-9_-]{43}$/.test(secret||""))fail("production_origin_secret_invalid");
   if(before.authorizerEvidence.currentOriginSha256!==sha(secret))fail("production_origin_secret_owner_mismatch");
  }
  if(execution==="review"){
   const old=recoveryProof(call,before,dir);
   const object=uploadSealed(call,candidateBytes,input.purpose,dir),inputObject=uploadSealed(call,Buffer.from(canonical(input)+"\n"),"release-input",dir),recovery=uploadSealed(call,Buffer.from(canonical(old.template)+"\n"),"recover",dir);
   const immediate=captureBaseline(call,input);if(!same(before,immediate))fail("production_frontend_baseline_changed");
   const parameters=before.parameters.map(p=>({ParameterKey:p.ParameterKey,UsePreviousValue:true}));
   if(candidate.Parameters?.ThnAdminAuthAdminOriginVerifySecret&&!before.templates.Original.Parameters?.ThnAdminAuthAdminOriginVerifySecret)parameters.push({ParameterKey:"ThnAdminAuthAdminOriginVerifySecret",ParameterValue:options.originSecret});
   options.verifySource?.();
   const made=call("deploy","cloudformation","create-change-set",{StackName:before.stackId,ChangeSetName:`thn-production-${input.purpose}-${runId}`,ChangeSetType:"UPDATE",TemplateURL:`https://${ASSET_BUCKET}.s3.${REGION}.amazonaws.com/${object.key}?versionId=${encodeURIComponent(object.versionId)}`,Parameters:parameters,Capabilities:["CAPABILITY_NAMED_IAM"],RoleARN:roles["cfn-exec"],Description:`THN production ${input.purpose} source ${input.sourceSha}; exact retained ARN; expires after24hours`});
   const description=await certificate.waitPreview(call,before.stackId,made.Id,pause),createdAt=new Date(description.CreationTime).toISOString();
   const fields=nativeReviewFields(call,before,candidate,input,fingerprint,description,[object,inputObject,...proof.assets],proof);
   const record=retained.sealReview({schemaVersion:1,contract:"thn-production-retained-review/v1",environment:"production",service:"infra",purpose:input.purpose,stackId:before.stackId,changeSetArn:description.ChangeSetId,createdAt,expiresAt:new Date(Date.parse(createdAt)+86400000).toISOString(),...fields,recoveryCoordinates:[recovery,...old.assets]});
   fs.writeFileSync(options.outputPath,JSON.stringify(record,null,2)+"\n",{flag:"wx",mode:0o600});return record;
  }
  const record=retained.validateReview(options.record);if(record.sourceSha!==input.sourceSha||record.purpose!==input.purpose||record.digest!==options.approvedDigest||record.sourcePackageSha256!==fingerprint)fail("production_frontend_review_invalid");
  const object=record.packageManifest.filter(o=>o.bucket===ASSET_BUCKET&&o.key.startsWith(`thn-production/${input.purpose}/`));if(object.length!==1)fail("production_frontend_review_invalid");
  const stored=getObject(call,object[0].bucket,object[0].key,dir,object[0].versionId);if(!stored.bytes.equals(candidateBytes)||sha(stored.bytes)!==object[0].sha256)fail("production_frontend_candidate_changed");
  const description=call("deploy","cloudformation","describe-change-set",{StackName:before.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});
  const inputObjects=record.packageManifest.filter(o=>o.bucket===ASSET_BUCKET&&o.key.startsWith("thn-production/release-input/"));if(inputObjects.length!==1)fail("production_frontend_review_invalid");
  const sealedInput=getObject(call,ASSET_BUCKET,inputObjects[0].key,dir,inputObjects[0].versionId);if(!sealedInput.bytes.equals(Buffer.from(canonical(input)+"\n")))fail("production_frontend_input_changed");
  const fields=nativeReviewFields(call,before,candidate,input,fingerprint,description,[object[0],inputObjects[0],...proof.assets],proof);
  for(const coordinate of record.recoveryCoordinates){const read=getObject(call,coordinate.bucket,coordinate.key,dir,coordinate.versionId);if(sha(read.bytes)!==coordinate.sha256)fail("production_recovery_readback_changed");}
  if(execution==="cleanup"){
   if(description.StackId!==before.stackId||description.ChangeSetId!==record.changeSetArn||description.ExecutionStatus!=="AVAILABLE")fail("production_frontend_review_invalid");
   call("deploy","cloudformation","delete-change-set",{StackName:before.stackId,ChangeSetName:record.changeSetArn});return {cleanup:true,changeSetArn:record.changeSetArn};
  }
  retained.verifyRetainedExecution(record,options.approvedDigest,fields,description);
  const lastBaseline=captureBaseline(call,input),lastProof=await publishedProof(call,input,dir);if(!same(before,lastBaseline)||!same(proof,lastProof))fail("production_frontend_baseline_changed");
  const last=call("deploy","cloudformation","describe-change-set",{StackName:before.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});retained.verifyRetainedExecution(record,options.approvedDigest,fields,last);
  options.verifySource?.();
  call("deploy","cloudformation","execute-change-set",{StackName:before.stackId,ChangeSetName:record.changeSetArn,ClientRequestToken:`thn-front-${record.digest}`});
  let state;for(let i=0;i<180;i++){state=call("deploy","cloudformation","describe-stacks",{StackName:before.stackId}).Stacks?.[0];if(state?.StackStatus==="UPDATE_COMPLETE")break;if(!["UPDATE_IN_PROGRESS","UPDATE_COMPLETE_CLEANUP_IN_PROGRESS"].includes(state?.StackStatus))fail("production_frontend_execution_failed");await pause(5000);}
  if(state?.StackStatus!=="UPDATE_COMPLETE")fail("production_frontend_execution_timeout");
  const after=captureBaseline(call,input.purpose==="public-visual"?{...input,publicReleaseId:input.selection.metadata.releaseId}:input);
  const oldIdentity=new Map(before.resources.map(r=>[r.LogicalResourceId,r]));for(const r of after.resources){if(oldIdentity.has(r.LogicalResourceId)&&!same(oldIdentity.get(r.LogicalResourceId),r))fail("production_frontend_identity_changed");oldIdentity.delete(r.LogicalResourceId);}if(oldIdentity.size)fail("production_frontend_identity_changed");
  for(const stage of ["Original","Processed"])if(!same(after.templates[stage],candidate))fail("production_frontend_post_template_mismatch");
  if(!same(after.trust,before.trust)||after.ownerSnapshotSha256!==before.ownerSnapshotSha256)fail("production_frontend_post_owner_changed");
  const functionName=input.purpose==="private-frontdoor"?"zoolandingpage-production-frontend-thn-admin-ssr":"zoolandingpage-production-frontend-ssr",fn=Object.values(after.lambdas).find(f=>f.FunctionName===functionName);
  if(!fn||Buffer.from(fn.CodeSha256,"base64").toString("hex")!==proof.codeSha256||fn.Environment?.Variables?.ZLP_RELEASE_ID!==input.selection.metadata.releaseId)fail("production_frontend_post_code_mismatch");
  if(input.purpose==="private-frontdoor"&&!same(after.publicConfig,before.publicConfig))fail("production_public_distribution_changed");
  if(input.purpose==="private-frontdoor"){
   const resource=after.resources.find(r=>r.LogicalResourceId==="FrontendDistributionThehairnarrativeAdminProductionF99395A3"),distribution=after.distributions[resource.LogicalResourceId]?.DistributionConfig;
   if(!same(distribution?.Aliases?.Items,["admin.thehairnarrative.com"]))fail("production_frontend_post_alias_mismatch");
   const live=call("lookup","cloudfront","get-distribution",{Id:resource.PhysicalResourceId}).Distribution;
   if(live?.Id!==resource.PhysicalResourceId||live.Status!=="Deployed"||!/^[a-z0-9]+\.cloudfront\.net$/.test(live.DomainName||""))fail("production_frontend_post_distribution_mismatch");
   const records=after.dns.filter(r=>r.Name==="admin.thehairnarrative.com."&&["A","AAAA"].includes(r.Type));
   const originalRecords=before.dns.filter(r=>r.Name==="admin.thehairnarrative.com."&&["A","AAAA"].includes(r.Type));
   if(records.length!==2||records.some(r=>r.AliasTarget?.HostedZoneId!=="Z2FDTNDATAQYW2"||r.AliasTarget.EvaluateTargetHealth!==false||r.AliasTarget.DNSName.replace(/\.$/,"")!==live.DomainName)||!same(after.dns.filter(r=>!records.includes(r)),before.dns.filter(r=>!originalRecords.includes(r))))fail("production_frontend_post_dns_mismatch");
   const authOrigin=distribution.Origins?.Items?.filter(o=>o.DomainName===origins.validateProductionOrigins(input.ownerSnapshot).thnAuthAdmin.domainName),header=authOrigin?.[0]?.CustomHeaders?.Items?.filter(h=>h.HeaderName==="x-zlp-origin-verify");
   if(authOrigin?.length!==1||header?.length!==1||sha(header[0].HeaderValue)!==sha(options.originSecret))fail("production_frontend_post_origin_proof_mismatch");
  }
  if(input.purpose==="public-visual"&&!same(after.dns,before.dns))fail("production_frontend_dns_changed");
  await publishedProof(call,input,dir);
  return {complete:true,purpose:input.purpose,digest:record.digest,releaseId:input.selection.metadata.releaseId};
 }finally{if(path.dirname(dir)!==os.tmpdir())fail("production_cli_cleanup_invalid");fs.rmSync(dir,{recursive:true});}
}
module.exports.runFrontendOperation=runFrontendOperation;

if(require.main===module){
 (async()=>{
  const [mode,inputPath,destination]=process.argv.slice(2);
  if(mode==="prepare"){
   const input=JSON.parse(fs.readFileSync(path.resolve(inputPath),"utf8"));
   console.log(JSON.stringify(prepareFrontend(input,path.resolve(destination))));return;
  }
  if(mode!=="operate")fail("production_frontend_operation_invalid");
  const e=process.env;
  if(e.GITHUB_REPOSITORY!=="LynxPardelle/zoolandingpage-aws-infra"||e.GITHUB_REF!=="refs/heads/main"||e.GITHUB_EVENT_NAME!=="workflow_dispatch"||e.GITHUB_SHA!==e.EXPECTED_SOURCE_SHA||!/^[a-f0-9]{40}$/.test(e.EXPECTED_SOURCE_SHA||""))fail("production_source_authority_invalid");
  const input=validateInput(JSON.parse(fs.readFileSync(path.resolve(inputPath),"utf8"))),desired=JSON.parse(fs.readFileSync(path.resolve(destination),"utf8")),fingerprint=sourcePackageHash();
  if(input.sourceSha!==e.EXPECTED_SOURCE_SHA||fingerprint!==e.EXPECTED_SOURCE_PACKAGE_SHA256||sha(canonical(input))!==e.EXPECTED_INPUT_SHA256||sha(canonical(desired))!==e.EXPECTED_DESIRED_SHA256)fail("production_source_package_changed");
  const record=e.EXECUTION==="review"?undefined:JSON.parse(fs.readFileSync(path.resolve(e.REVIEW_FILE),"utf8"));
  const result=await runFrontendOperation({verifySource:()=>certificate.assertCurrentProductionSource(e.EXPECTED_SOURCE_SHA,e),call:certificate.productionClients(e,`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`),input,desired,fingerprint,execution:e.EXECUTION,runId:`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`,originSecret:e.THN_AUTH_ADMIN_ORIGIN_VERIFY_SECRET,record,approvedDigest:e.EXPECTED_REVIEW_DIGEST,outputPath:path.resolve("frontend-review.json")});
  console.log(JSON.stringify(result));
 })().catch(error=>{console.error(JSON.stringify({error:/^[a-z0-9_]+$/.test(error.message)?error.message:"production_frontend_operation_failed",...(error.causeCode?{cause_code:error.causeCode}:{}),...(Number.isInteger(error.cliExitCode)?{cli_exit_status:error.cliExitCode}:{})}));process.exitCode=1;});
}
