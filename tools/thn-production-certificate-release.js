"use strict";
const {createHash}=require("node:crypto");
const fs=require("node:fs"),path=require("node:path"),os=require("node:os");
const {spawnSync}=require("node:child_process");
const ACCOUNT="765932874577",REGION="us-east-1",HOST="admin.thehairnarrative.com",ZONE="Z08032292DKYZ4QGCIZDR";
const STACK="ZoolandingProduction-Zoolandingpage-production-Frontend";
const LOGICAL="ThnAdminProductionCertificate";
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==="object"?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const canonical=v=>JSON.stringify(stable(v));
const sha=v=>createHash("sha256").update(v).digest("hex");
const same=(a,b)=>canonical(a)===canonical(b);
const object=v=>v&&typeof v==="object"&&!Array.isArray(v);
const fail=code=>{throw new Error(code);};
const certificate=()=>({Type:"AWS::CertificateManager::Certificate",DeletionPolicy:"Retain",UpdateReplacePolicy:"Retain",Properties:{DomainName:HOST,ValidationMethod:"DNS",CertificateExport:"DISABLED",DomainValidationOptions:[{DomainName:HOST,HostedZoneId:ZONE}]}});
function composeCertificateTemplate(original){
 if(!object(original)||!object(original.Resources)||original.Transform||Object.hasOwn(original.Resources,LOGICAL))fail("production_certificate_template_invalid");
 return {...structuredClone(original),Resources:{...structuredClone(original.Resources),[LOGICAL]:certificate()}};
}
function reviewCertificateChangeSet(description){
 const validStack=new RegExp(`^arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${STACK}/[A-Za-z0-9-]+$`);
 if(!object(description)||description.Status!=="CREATE_COMPLETE"||description.ExecutionStatus!=="AVAILABLE"
  ||description.StackName!==STACK||!validStack.test(description.StackId||"")||description.IncludeNestedStacks===true||description.NextToken
  ||(description.ChangeSetType!==undefined&&description.ChangeSetType!=="UPDATE")||!Array.isArray(description.Changes)||description.Changes.length!==1)fail("production_certificate_change_set_invalid");
 const change=description.Changes[0],r=change.ResourceChange;
 if(change.Type!=="Resource"||!object(r)||r.Action!=="Add"||r.LogicalResourceId!==LOGICAL||r.ResourceType!==certificate().Type
  ||![undefined,"False"].includes(r.Replacement)||r.PhysicalResourceId
  ||(r.Scope!==undefined&&(!Array.isArray(r.Scope)||r.Scope.some(v=>v!=="Properties")))||r.BeforeContext)fail("production_certificate_change_set_invalid");
 if(r.AfterContext!==undefined){
  let after;try{after=JSON.parse(r.AfterContext);}catch{fail("production_certificate_change_set_invalid");}
  if(!same(after.Properties??after.properties,certificate().Properties))fail("production_certificate_change_set_invalid");
 }
 return [structuredClone(change)];
}
function certificateReviewDigest(context,description){
 const fields=["sourceSha","baselineSha256","candidateSha256","identitySha256","permissionSha256"];
 if(!object(context)||Object.keys(context).length!==fields.length||!fields.every(k=>typeof context[k]==="string"&&(k==="sourceSha"?/^[a-f0-9]{40}$/:/^[a-f0-9]{64}$/).test(context[k])))fail("production_certificate_digest_invalid");
 if(!new RegExp(`^arn:aws:cloudformation:${REGION}:${ACCOUNT}:changeSet/thn-production-certificate-[a-zA-Z0-9-]+/[a-zA-Z0-9-]+$`).test(description.ChangeSetId||""))fail("production_certificate_digest_invalid");
 return sha(canonical({schemaVersion:1,operation:"certificate",environment:"production",account:ACCOUNT,region:REGION,stackId:description.StackId,changeSetArn:description.ChangeSetId,context,inventory:reviewCertificateChangeSet(description)}));
}
const identities=resources=>resources.map(r=>Object.fromEntries(["LogicalResourceId","PhysicalResourceId","ResourceType"].map(k=>[k,r[k]]))).sort((a,b)=>a.LogicalResourceId.localeCompare(b.LogicalResourceId));
function verifyCertificateExecution(before,after,cert){
 const added=after.filter(r=>r.LogicalResourceId===LOGICAL),remaining=after.filter(r=>r.LogicalResourceId!==LOGICAL);
 const arn=new RegExp(`^arn:aws:acm:${REGION}:${ACCOUNT}:certificate/[a-f0-9-]{36}$`);
 if(added.length!==1||added[0].ResourceType!==certificate().Type||!arn.test(added[0].PhysicalResourceId||"")||!same(identities(before),identities(remaining))
  ||cert?.CertificateArn!==added[0].PhysicalResourceId||cert.DomainName!==HOST||cert.Status!=="ISSUED"||cert.Type!=="AMAZON_ISSUED"
  ||!same(cert.SubjectAlternativeNames,[HOST]))fail("production_certificate_readback_invalid");
 return true;
}
module.exports={assertCdkTrust,composeCertificateTemplate,reviewCertificateChangeSet,certificateReviewDigest,verifyCertificateExecution,canonical,sha,identities,ACCOUNT,REGION,HOST,ZONE,STACK,LOGICAL};

// The runner uses only fixed production authorities. Credentials remain in
// process memory and CLI requests go through private local JSON files.
const BASE_ROLE=`arn:aws:iam::${ACCOUNT}:role/zoolandingpage-infra-production-github-oidc-deploy`;
const roles=Object.freeze(Object.fromEntries(["lookup","deploy","file-publishing","cfn-exec"].map(k=>[k,`arn:aws:iam::${ACCOUNT}:role/cdk-hnb659fds-${k}-role-${ACCOUNT}-${REGION}`])));
const ASSET_BUCKET=`cdk-hnb659fds-assets-${ACCOUNT}-${REGION}`;
function buildAwsCliArguments(service,operation,input,inputFile,outputFile,extra=[]){
 if(service==="s3api"&&operation==="get-object"){
  // The AWS CLI's custom streaming command does not support --cli-input-json.
  const fields={Bucket:"bucket",Key:"key",VersionId:"version-id",ExpectedBucketOwner:"expected-bucket-owner"};
  if(!object(input)||Object.keys(input).some(k=>!Object.hasOwn(fields,k))
    ||typeof input.Bucket!=="string"||!input.Bucket||typeof input.Key!=="string"||!input.Key
    ||input.ExpectedBucketOwner!==ACCOUNT||!path.isAbsolute(outputFile||"")||extra.length
    ||Object.hasOwn(input,"VersionId")&&(typeof input.VersionId!=="string"||!input.VersionId))fail("production_cli_input_invalid");
  const flags=Object.entries(fields).filter(([k])=>Object.hasOwn(input,k)).map(([k,flag])=>`--${flag}=${input[k]}`);
  return [service,operation,...flags,"--region",REGION,"--output","json","--no-cli-pager",outputFile];
 }
 return [service,operation,...(outputFile?[outputFile]:[]),"--cli-input-json",`file://${inputFile}`,...extra,"--region",REGION,"--output","json","--no-cli-pager"];
}
module.exports.buildAwsCliArguments=buildAwsCliArguments;
function awsCall(service,operation,input,env=process.env,outputFile){
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-prod-cli-"));
 try{
  const body={...input},extra=[];
  if(service==="s3api"&&operation==="put-object"){if(!path.isAbsolute(body.Body||""))fail("production_cli_input_invalid");extra.push("--body",body.Body);delete body.Body;}
  const file=path.join(dir,"input.json");fs.writeFileSync(file,JSON.stringify(body),{mode:0o600,flag:"wx"});
  const args=buildAwsCliArguments(service,operation,body,file,outputFile,extra);
  if(service==="route53"&&operation==="list-resource-record-sets")args.push("--no-paginate");
  const result=spawnSync("aws",args,{env:{...env,AWS_PAGER:"",AWS_MAX_ATTEMPTS:"1"},timeout:45000,maxBuffer:16*1024*1024});
  if(result.error||result.status!==0){const code=String(result.stderr||"").match(/An error occurred \(([A-Za-z0-9]+)\)/)?.[1]||result.error?.code||"AwsCliFailed";const error=new Error(`production_aws_${service}_${operation}_failed`.replace(/-/g,"_"));error.causeCode=code;error.cliExitCode=result.status;throw error;}
  return result.stdout.length?JSON.parse(result.stdout.toString("utf8")):{};
 }finally{if(path.dirname(dir)!==os.tmpdir())fail("production_cli_cleanup_invalid");fs.rmSync(dir,{recursive:true});}
}
function rolePolicySnapshot(call,arn){
 const name=arn.split("/").at(-1),r=call("iam","get-role",{RoleName:name}).Role;
 if(r?.Arn!==arn)fail("production_role_identity_invalid");
 const inline=call("iam","list-role-policies",{RoleName:name}),attached=call("iam","list-attached-role-policies",{RoleName:name});
 if(inline.IsTruncated||attached.IsTruncated||!Array.isArray(inline.PolicyNames)||!Array.isArray(attached.AttachedPolicies))fail("production_role_policy_incomplete");
 const policies={},policySizes={};
 for(const p of inline.PolicyNames.sort()){const document=call("iam","get-role-policy",{RoleName:name,PolicyName:p}).PolicyDocument;policies[`inline:${p}`]=sha(canonical(document));policySizes[`inline:${p}`]=Buffer.byteLength(canonical(document));}
 for(const p of attached.AttachedPolicies.sort((a,b)=>a.PolicyArn.localeCompare(b.PolicyArn))){const v=call("iam","get-policy",{PolicyArn:p.PolicyArn}).Policy.DefaultVersionId;policies[p.PolicyArn]=sha(canonical(call("iam","get-policy-version",{PolicyArn:p.PolicyArn,VersionId:v}).PolicyVersion.Document));}
 let boundary=null;
 if(r.PermissionsBoundary){const arn=r.PermissionsBoundary.PermissionsBoundaryArn,v=call("iam","get-policy",{PolicyArn:arn}).Policy.DefaultVersionId;boundary={arn,sha256:sha(canonical(call("iam","get-policy-version",{PolicyArn:arn,VersionId:v}).PolicyVersion.Document))};}
 return {arn,roleId:r.RoleId,trust:r.AssumeRolePolicyDocument,policies,policySizes,boundary};
}
function assertCdkTrust(policy,service=false){
 if(!object(policy)||!Array.isArray(policy.Statement)||policy.Statement.some(s=>s.Effect!=="Allow"))fail("production_role_trust_unproved");
 const selected=policy.Statement.some(s=>{
  const actions=Array.isArray(s.Action)?s.Action:[s.Action];
  if(!actions.includes("sts:AssumeRole"))return false;
  const condition=s.Condition||{};
  // Actual bootstrap trust requires absence of ExternalId (Null=true).
  // Every unknown condition is rejected, and sessions omit ExternalId.
  if(Object.keys(condition).length && !same(condition,{Null:{"sts:ExternalId":"true"}}))return false;
  if(service && Object.keys(condition).length)return false;
  if(service)return s.Principal?.Service==="cloudformation.amazonaws.com";
  const principals=Array.isArray(s.Principal?.AWS)?s.Principal.AWS:[s.Principal?.AWS];
  return principals.includes(`arn:aws:iam::${ACCOUNT}:root`)||principals.includes(BASE_ROLE);
 });
 if(!selected)fail("production_role_trust_unproved");
}
const permittedProductionOperations={lookup:new Set(["cloudformation:describe-stacks","cloudformation:get-template","cloudformation:list-stack-resources","cloudformation:describe-type","iam:simulate-principal-policy","iam:simulate-custom-policy","iam:get-role","iam:list-role-policies","iam:list-attached-role-policies","iam:get-role-policy","iam:get-policy","iam:get-policy-version","iam:list-policy-versions","iam:list-entities-for-policy","route53:get-hosted-zone","route53:list-resource-record-sets","cloudfront:get-distribution-config","cloudfront:get-distribution","acm:list-certificates","acm:describe-certificate","s3api:head-bucket","s3api:get-public-access-block","s3api:get-bucket-ownership-controls","s3api:get-bucket-versioning","s3api:get-bucket-encryption","s3api:get-bucket-policy","s3api:get-bucket-acl","kms:describe-key","kms:get-key-policy","lambda:get-function-configuration","lambda:get-function","lambda:get-policy","s3api:head-object","s3api:get-object","acm:describe-certificate"]),deploy:new Set(["cloudformation:create-change-set","cloudformation:describe-change-set","cloudformation:get-template","cloudformation:delete-change-set","cloudformation:execute-change-set","cloudformation:update-termination-protection","cloudformation:describe-stacks","cloudformation:list-stack-resources"]),"file-publishing":new Set(["s3api:head-object","s3api:put-object","s3api:get-object","s3api:list-objects-v2"])};
function assertProductionOperation(kind,service,operation,input){
  if(!permittedProductionOperations[kind]?.has(`${service}:${operation}`))fail("production_operation_out_of_scope");
  if(service==="iam"&&["list-policy-versions","list-entities-for-policy"].includes(operation)&&!/^arn:aws:iam::765932874577:policy\/ThnProductionHubNative[23]$/.test(input.PolicyArn||""))fail("production_operation_out_of_scope");
  if(service==="iam"&&["simulate-principal-policy","simulate-custom-policy"].includes(operation)){
   const resource=input.ResourceArns?.[0],actions=input.ActionNames;
   const trust=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&same([...actions||[]].sort(),["iam:getrole","iam:updateassumerolepolicy"])&&/^arn:aws:iam::765932874577:role\/zoolanding-deployer-(?:image-upload|thn-auth-runtime|api-proxy)-production-github-deploy$/.test(resource||"");
   const policy=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&same([...actions||[]].sort(),["iam:createpolicyversion","iam:deletepolicyversion","iam:getpolicy","iam:getpolicyversion","iam:listentitiesforpolicy","iam:listpolicyversions"])&&/^arn:aws:iam::765932874577:policy\/ThnProductionHubNative[23]$/.test(resource||"");
   const attachment=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&same([...actions||[]].sort(),["iam:attachrolepolicy","iam:detachrolepolicy"])&&resource===`arn:aws:iam::${ACCOUNT}:role/zoolanding-deployer-content-hub-production-cfn-exec`;
   const importPolicyCreate=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&same([...actions||[]].sort(),["iam:GetRolePolicy","iam:PutRolePolicy","iam:DeleteRolePolicy"].sort())&&resource===`arn:aws:iam::${ACCOUNT}:role/zoolanding-content-hub-production-deploy`;
   const eventActions=["events:DeleteRule","events:DescribeRule","events:ListTagsForResource","events:ListTargetsByRule","events:PutRule","events:PutTargets","events:RemoveTargets","events:TagResource","events:UntagResource"].sort();
   const eventResource=/^arn:aws:events:us-east-1:765932874577:rule\/zoolanding-content-hub-pr-ThnContentHubV2(?:PrivateAss|Invalidati|PreparedOr)-[A-Za-z0-9]{12}$/.test(resource||"");
   const event=eventResource&&same([...actions||[]].sort(),eventActions)&&(operation==="simulate-custom-policy"&&input.PolicyInputList?.length===1&&typeof input.PolicyInputList[0]==="string"||operation==="simulate-principal-policy"&&input.PolicySourceArn===`arn:aws:iam::${ACCOUNT}:role/zoolanding-deployer-content-hub-production-cfn-exec`);
   const importRead=operation==="simulate-principal-policy"&&input.PolicySourceArn===`arn:aws:iam::${ACCOUNT}:role/zoolanding-content-hub-production-deploy`&&(
    resource===`arn:aws:dynamodb:${REGION}:${ACCOUNT}:table/zoolanding-content-hub-prod-ServiceBindingRegistryV2`&&same([...actions||[]].sort(),["dynamodb:GetResourcePolicy"])||
    resource===`arn:aws:s3:::zlp-thn-ch-production-private-${ACCOUNT}-${REGION}`&&same([...actions||[]].sort(),["s3:GetBucketVersioning","s3:GetEncryptionConfiguration","s3:GetBucketPublicAccessBlock","s3:ListBucket"].sort()));
   const apiRole=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&resource===`arn:aws:iam::${ACCOUNT}:role/zlp-thn-auth-runtime-prod-role`&&same([...actions||[]].sort(),["iam:CreateRole","iam:PutRolePolicy","iam:AttachRolePolicy","iam:GetRolePolicy","iam:TagRole","iam:UntagRole","iam:GetRole","iam:ListAttachedRolePolicies","iam:ListRolePolicies"].sort());
   const apiPolicy=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&resource===`arn:aws:iam::${ACCOUNT}:policy/ThnProductionApiNative0`&&same([...actions||[]].sort(),["iam:GetPolicy","iam:ListPolicyVersions","iam:CreatePolicyVersion","iam:DeletePolicyVersion","iam:ListEntitiesForPolicy","iam:GetPolicyVersion"].sort());
   const apiGithub=operation==="simulate-principal-policy"&&input.PolicySourceArn===roles["cfn-exec"]&&resource===`arn:aws:iam::${ACCOUNT}:role/zoolanding-deployer-thn-auth-runtime-production-github-deploy`&&same([...actions||[]].sort(),["iam:PutRolePolicy","iam:DeleteRolePolicy","iam:GetRolePolicy"].sort());
   if(input.ResourceArns?.length!==1||!(trust||policy||attachment||importPolicyCreate||event||importRead||apiRole||apiPolicy||apiGithub))fail("production_operation_out_of_scope");
  }
  if(service==="cloudformation"&&operation==="describe-type"&&(input.Type!=="RESOURCE"||!["AWS::IAM::Role","AWS::IAM::ManagedPolicy","AWS::IAM::Policy"].includes(input.TypeName)))fail("production_operation_out_of_scope");
  if(service==="cloudformation"&&operation!=="describe-type"&&!( [STACK,"ZoolandingProduction-Zoolandingpage-production-ThnDeploymentIdentities","zoolanding-auth-admin-prod","zoolanding-thn-auth-runtime-production","zoolanding-content-hub-prod"].some(s=>input.StackName===s||String(input.StackName||"").startsWith(`arn:aws:cloudformation:${REGION}:${ACCOUNT}:stack/${s}/`))))fail("production_operation_out_of_scope");
  if(service==="s3api"&&!(input.Bucket===ASSET_BUCKET||kind==="lookup"&&["zoolandingpage-production-frontend-artifacts-765932874577","zoolandingpage-public-files","zlp-thn-production-releases-765932874577-us-east-1"].includes(input.Bucket)))fail("production_operation_out_of_scope");
}
function productionClients(env,run){
 const identity=awsCall("sts","get-caller-identity",{},env);
 if(identity.Account!==ACCOUNT||!new RegExp(`^arn:aws:sts::${ACCOUNT}:assumed-role/zoolandingpage-infra-production-github-oidc-deploy/[A-Za-z0-9+=,.@_-]+$`).test(identity.Arn||""))fail("production_caller_identity_invalid");
 const sessions={};
 for(const kind of ["lookup","deploy","file-publishing"]){
  const s=awsCall("sts","assume-role",{RoleArn:roles[kind],RoleSessionName:`thn-prod-cert-${run}-${kind}`,DurationSeconds:3600},env).Credentials;
  if(!s?.AccessKeyId||!s.SecretAccessKey||!s.SessionToken)fail("production_role_session_invalid");
  sessions[kind]={...env,AWS_ACCESS_KEY_ID:s.AccessKeyId,AWS_SECRET_ACCESS_KEY:s.SecretAccessKey,AWS_SESSION_TOKEN:s.SessionToken};
  const current=awsCall("sts","get-caller-identity",{},sessions[kind]);
  if(current.Account!==ACCOUNT||!current.Arn.startsWith(`arn:aws:sts::${ACCOUNT}:assumed-role/${roles[kind].split("/").at(-1)}/`))fail("production_role_identity_invalid");
 }
 return (kind,service,operation,input,file)=>{assertProductionOperation(kind,service,operation,input);return awsCall(service,operation,input,sessions[kind],file);};
}
function normalizeParameters(parameters){
 if(!Array.isArray(parameters)||parameters.some(p=>!object(p)||typeof p.ParameterKey!=="string"||typeof p.ParameterValue!=="string")||new Set(parameters.map(p=>p.ParameterKey)).size!==parameters.length)fail("production_parameter_snapshot_invalid");
 return parameters.map(({ParameterKey,ParameterValue,ResolvedValue})=>({ParameterKey,ParameterValue,...(ResolvedValue===undefined?{}:{ResolvedValue})})).sort((a,b)=>a.ParameterKey.localeCompare(b.ParameterKey));
}
function readDns(call){
 const records=[],seen=new Set();let cursor={};
 for(let page=0;page<100;page++){
  const r=call("lookup","route53","list-resource-record-sets",{HostedZoneId:ZONE,MaxItems:"100",...cursor});
  if(!Array.isArray(r.ResourceRecordSets)||typeof r.IsTruncated!=="boolean")fail("production_dns_snapshot_invalid");
  records.push(...r.ResourceRecordSets);if(records.length>10000)fail("production_dns_snapshot_invalid");
  if(!r.IsTruncated)return records.sort((a,b)=>canonical(a).localeCompare(canonical(b)));
  cursor={StartRecordName:r.NextRecordName,StartRecordType:r.NextRecordType,...(r.NextRecordIdentifier?{StartRecordIdentifier:r.NextRecordIdentifier}:{})};
  if(!cursor.StartRecordName||!cursor.StartRecordType||seen.has(canonical(cursor)))fail("production_dns_snapshot_invalid");seen.add(canonical(cursor));
 }
 fail("production_dns_snapshot_invalid");
}
function readProductionBaseline(call,options={certificateAbsent:true,adminMustAbsent:true}){
 const response=call("lookup","cloudformation","describe-stacks",{StackName:STACK});
 if(response.Stacks?.length!==1)fail("production_stack_snapshot_invalid");
 const s=response.Stacks[0];
 if(s.StackName!==STACK||!["UPDATE_COMPLETE","CREATE_COMPLETE"].includes(s.StackStatus)||s.RoleARN!==roles["cfn-exec"])fail("production_stack_snapshot_invalid");
 const templates={};
 for(const stage of ["Original","Processed"]){const b=call("lookup","cloudformation","get-template",{StackName:s.StackId,TemplateStage:stage}).TemplateBody;templates[stage]=typeof b==="string"?JSON.parse(b):b;if(options.certificateAbsent)composeCertificateTemplate(templates[stage]);}
 const resourceResponse=call("lookup","cloudformation","list-stack-resources",{StackName:s.StackId});
 if(resourceResponse.NextToken)fail("production_resource_snapshot_incomplete");
 const resources=identities(resourceResponse.StackResourceSummaries);
 const zone=call("lookup","route53","get-hosted-zone",{Id:ZONE}).HostedZone;
 if(zone?.Id!==`/hostedzone/${ZONE}`||zone.Name!=="thehairnarrative.com."||zone.Config?.PrivateZone!==false)fail("production_zone_invalid");
 const dns=readDns(call);if(options.adminMustAbsent&&dns.some(r=>r.Name.replace(/\.$/,"")===HOST))fail("production_admin_dns_conflict");
 const publicConfig=call("lookup","cloudfront","get-distribution-config",{Id:"EC4GODNMXFG7N"});
 if(!same(publicConfig.DistributionConfig?.Aliases?.Items,["thehairnarrative.com"]))fail("production_public_distribution_invalid");
 const trust={};
 for(const [kind,arn] of Object.entries({...roles,base:BASE_ROLE})){trust[kind]=rolePolicySnapshot((...args)=>call("lookup",...args),arn);if(kind!=="base")assertCdkTrust(trust[kind].trust,kind==="cfn-exec");}
 const bucket={Bucket:ASSET_BUCKET,ExpectedBucketOwner:ACCOUNT};
 const versioning=call("lookup","s3api","get-bucket-versioning",bucket),encryption=call("lookup","s3api","get-bucket-encryption",bucket);
 const kms=call("lookup","kms","describe-key",{KeyId:"alias/aws/s3"}).KeyMetadata;
 const rules=encryption.ServerSideEncryptionConfiguration?.Rules;
 if(versioning.Status!=="Enabled"||rules?.length!==1||rules[0].ApplyServerSideEncryptionByDefault?.SSEAlgorithm!=="aws:kms"||kms?.KeyManager!=="AWS"||kms.Enabled!==true||kms.KeyState!=="Enabled")fail("production_asset_bucket_invalid");
 const kmsPolicy=JSON.parse(call("lookup","kms","get-key-policy",{KeyId:kms.Arn,PolicyName:"default"}).Policy);
 const policy=JSON.parse(call("lookup","s3api","get-bucket-policy",bucket).Policy),acl=call("lookup","s3api","get-bucket-acl",bucket);
 if(acl.Grants?.length!==1||acl.Grants[0].Permission!=="FULL_CONTROL"||acl.Grants[0].Grantee?.ID!==acl.Owner?.ID)fail("production_asset_bucket_invalid");
 return {stackId:s.StackId,status:s.StackStatus,terminationProtection:s.EnableTerminationProtection===true,templates,parameters:normalizeParameters(s.Parameters||[]),resources,dns,publicConfig,trust,bucket:{name:ASSET_BUCKET,versioning,encryption,policy,acl,kmsArn:kms.Arn,kmsPolicy}};
}
function baselineDigest(b){return sha(canonical({...b,trust:undefined}));}
function verifyDnsCertificateDelta(before,after,cert){
 const validation=cert.DomainValidationOptions;
 if(validation?.length!==1||validation[0].DomainName!==HOST||validation[0].ValidationStatus!=="SUCCESS")fail("production_certificate_dns_invalid");
 const cname=validation[0].ResourceRecord;
 if(cname?.Type!=="CNAME"||!/^_[A-Za-z0-9-]+\.admin\.thehairnarrative\.com\.$/.test(cname.Name)||!/^_[A-Za-z0-9.-]+\.acm-validations\.aws\.$/.test(cname.Value))fail("production_certificate_dns_invalid");
 const current=after.filter(r=>r.Name===cname.Name&&r.Type==="CNAME");
 if(current.length!==1||!same(current[0].ResourceRecords,[{Value:cname.Value}]))fail("production_certificate_dns_invalid");
 const old=before.filter(r=>r.Name===cname.Name&&r.Type==="CNAME");
 if(old.length>1||(old.length===1&&!same(old[0],current[0])))fail("production_certificate_dns_invalid");
 const expected=old.length?before:[...before,current[0]].sort((a,b)=>canonical(a).localeCompare(canonical(b)));
 if(!same(after,expected))fail("production_certificate_dns_invalid");
 return {addedValidationRecords:old.length?0:1};
}

function sourcePackageHash(root=path.resolve(__dirname,"..")){
 const files=["tools/thn-production-certificate-release.js","tools/thn-production-retained-review.js",".github/workflows/thn-production-certificate.yml","package.json","package-lock.json"];
 return sha(canonical(Object.fromEntries(files.map(f=>[f,sha(fs.readFileSync(path.join(root,f)))]))));
}
function assertCurrentProductionSource(sourceSha, env=process.env){
 const result=spawnSync("gh",["api","repos/LynxPardelle/zoolandingpage-aws-infra/git/ref/heads/main","--jq",".object.sha"],{env,encoding:"utf8",timeout:30000,maxBuffer:4096});
 if(result.error||result.status!==0||result.stdout.trim()!==sourceSha)fail("production_source_changed");
 return true;
}
module.exports.assertCurrentProductionSource=assertCurrentProductionSource;
const bodyTemplate=x=>typeof x==="string"?JSON.parse(x):x;
function freshCertificateReview(call,b,sourceSha,sourcePackageSha256,description,manifest){
 const native={};for(const stage of ["Original","Processed"]){native[stage]=bodyTemplate(call("deploy","cloudformation","get-template",{StackName:b.stackId,ChangeSetName:description.ChangeSetId,TemplateStage:stage}).TemplateBody);if(!same(native[stage],composeCertificateTemplate(b.templates[stage])))fail("production_certificate_native_template_mismatch");}
 reviewCertificateChangeSet(description);
 return {sourceSha,sourcePackageSha256,baselineSha256:baselineDigest(b),identitySha256:sha(canonical(b.resources)),permissionSha256:sha(canonical(b.trust)),originalTemplateSha256:sha(canonical(native.Original)),processedTemplateSha256:sha(canonical(native.Processed)),parametersSha256:sha(canonical(b.parameters)),changes:require("./thn-production-retained-review").inventorySummary(description.Changes),nativeInventorySha256:require("./thn-production-retained-review").hash(description.Changes),packageManifest:manifest};
}
function verifyVersionedTemplate(call,coordinate,expectedBytes,dir){
 if(coordinate.bucket!==ASSET_BUCKET||!/^thn-production\/certificate\/[a-f0-9]{64}\.json$/.test(coordinate.key)||coordinate.sha256!==sha(expectedBytes)||!coordinate.versionId||coordinate.versionId==="null")fail("production_asset_coordinates_invalid");
 const output=path.join(dir,"candidate-readback.json");
 const response=call("file-publishing","s3api","get-object",{Bucket:ASSET_BUCKET,Key:coordinate.key,VersionId:coordinate.versionId,ExpectedBucketOwner:ACCOUNT},output);
 if(response.VersionId!==coordinate.versionId||!fs.readFileSync(output).equals(expectedBytes))fail("production_asset_readback_invalid");
 return coordinate;
}
async function waitPreview(call,stackId,arn,pause){
 for(let i=0;i<120;i++){const r=call("deploy","cloudformation","describe-change-set",{StackName:stackId,ChangeSetName:arn,IncludePropertyValues:true});if(r.Status==="CREATE_COMPLETE")return r;if(r.Status!=="CREATE_PENDING"&&r.Status!=="CREATE_IN_PROGRESS")fail("production_certificate_preview_failed");await pause(5000);}
 fail("production_certificate_preview_timeout");
}
async function runCertificateOperation(options){
 const {sourceSha,sourcePackageSha256,execution,runId,call,outputPath}=options,pause=options.pause||((ms)=>new Promise(r=>setTimeout(r,ms)));
 if(!/^[a-f0-9]{40}$/.test(sourceSha)||!/^[a-f0-9]{64}$/.test(sourcePackageSha256)||!["review","execute","cleanup"].includes(execution)||!/^\d+-\d+$/.test(runId))fail("production_certificate_operation_invalid");
 const retained=require("./thn-production-retained-review");
 if(execution==="cleanup"){
  const record=retained.validateReview(options.record);if(record.purpose!=="certificate"||record.digest!==options.approvedDigest)fail("production_certificate_review_invalid");
  const stack=call("deploy","cloudformation","describe-stacks",{StackName:record.stackId}).Stacks?.[0];
  const native=call("deploy","cloudformation","describe-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});
  if(stack?.StackId!==record.stackId||native.StackId!==record.stackId||native.ChangeSetId!==record.changeSetArn||native.ExecutionStatus!=="AVAILABLE"||native.Status!=="CREATE_COMPLETE"||retained.hash(native.Changes)!==record.nativeInventorySha256)fail("production_certificate_review_invalid");
  call("deploy","cloudformation","delete-change-set",{StackName:record.stackId,ChangeSetName:record.changeSetArn});return {cleanup:true,changeSetArn:record.changeSetArn};
 }
 const b=readProductionBaseline(call),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-prod-certificate-"));
 try{
  const candidate=composeCertificateTemplate(b.templates.Original),bytes=Buffer.from(canonical(candidate)+"\n"),key=`thn-production/certificate/${sha(bytes)}.json`;
  if(execution==="review"){
   const templatePath=path.join(dir,"candidate.json");fs.writeFileSync(templatePath,bytes,{mode:0o600,flag:"wx"});
   // Content-addressed write never overwrites an existing version or repairs corruption.
   const listed=call("file-publishing","s3api","list-objects-v2",{Bucket:ASSET_BUCKET,Prefix:key,MaxKeys:2,ExpectedBucketOwner:ACCOUNT});
   if(listed.IsTruncated||!Array.isArray(listed.Contents||[]))fail("production_asset_listing_invalid");
   const found=(listed.Contents||[]).filter(o=>o.Key===key);if(found.length>1)fail("production_asset_listing_invalid");
   const result=found.length?call("file-publishing","s3api","head-object",{Bucket:ASSET_BUCKET,Key:key,ExpectedBucketOwner:ACCOUNT}):call("file-publishing","s3api","put-object",{Bucket:ASSET_BUCKET,Key:key,ExpectedBucketOwner:ACCOUNT,Body:templatePath,IfNoneMatch:"*",ContentType:"application/json",ServerSideEncryption:"aws:kms"});
   const coordinate={bucket:ASSET_BUCKET,key,versionId:result.VersionId,sha256:sha(bytes)};
   verifyVersionedTemplate(call,coordinate,bytes,dir);
   const second=readProductionBaseline(call);if(baselineDigest(second)!==baselineDigest(b)||!same(second.trust,b.trust))fail("production_certificate_baseline_changed");
   const request={StackName:b.stackId,ChangeSetName:`thn-production-certificate-${runId}`,ChangeSetType:"UPDATE",Description:`THN production certificate source ${sourceSha}; expires after 24 hours; execute exact ARN only`,TemplateURL:`https://${ASSET_BUCKET}.s3.${REGION}.amazonaws.com/${key}?versionId=${encodeURIComponent(coordinate.versionId)}`,Parameters:b.parameters.map(p=>({ParameterKey:p.ParameterKey,UsePreviousValue:true})),Capabilities:["CAPABILITY_NAMED_IAM"],RoleARN:roles["cfn-exec"]};
   options.verifySource?.();
   const created=call("deploy","cloudformation","create-change-set",request),description=await waitPreview(call,b.stackId,created.Id,pause);
   const fields=freshCertificateReview(call,b,sourceSha,sourcePackageSha256,description,[coordinate]),createdAt=new Date(description.CreationTime).toISOString();
   const record=retained.sealReview({schemaVersion:1,contract:"thn-production-retained-review/v1",environment:"production",service:"infra",purpose:"certificate",stackId:b.stackId,changeSetArn:description.ChangeSetId,createdAt,expiresAt:new Date(Date.parse(createdAt)+86400000).toISOString(),...fields,recoveryCoordinates:[]});
   fs.writeFileSync(outputPath,JSON.stringify(record,null,2)+"\n",{mode:0o600,flag:"wx"});return record;
  }
  const record=retained.validateReview(options.record);
  if(record.purpose!=="certificate"||record.stackId!==b.stackId||record.sourceSha!==sourceSha||record.sourcePackageSha256!==sourcePackageSha256||record.digest!==options.approvedDigest)fail("production_certificate_review_invalid");
  const description=call("deploy","cloudformation","describe-change-set",{StackName:b.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});
  const fields=freshCertificateReview(call,b,sourceSha,sourcePackageSha256,description,record.packageManifest);
  if(record.packageManifest.length!==1)fail("production_certificate_review_invalid");verifyVersionedTemplate(call,record.packageManifest[0],bytes,dir);
  if(execution==="cleanup"){
   if(description.StackId!==b.stackId||description.ChangeSetId!==record.changeSetArn||description.ExecutionStatus!=="AVAILABLE")fail("production_certificate_review_invalid");
   call("deploy","cloudformation","delete-change-set",{StackName:b.stackId,ChangeSetName:record.changeSetArn});return {cleanup:true,changeSetArn:record.changeSetArn};
  }
  retained.verifyRetainedExecution(record,options.approvedDigest,fields,description);
  const immediate=readProductionBaseline(call);if(baselineDigest(immediate)!==baselineDigest(b)||!same(immediate.trust,b.trust))fail("production_certificate_baseline_changed");
  const last=call("deploy","cloudformation","describe-change-set",{StackName:b.stackId,ChangeSetName:record.changeSetArn,IncludePropertyValues:true});
  retained.verifyRetainedExecution(record,options.approvedDigest,fields,last);
  options.verifySource?.();
  call("deploy","cloudformation","execute-change-set",{StackName:b.stackId,ChangeSetName:record.changeSetArn,ClientRequestToken:`thn-cert-${record.digest}`});
  let state;for(let i=0;i<120;i++){state=call("deploy","cloudformation","describe-stacks",{StackName:b.stackId}).Stacks?.[0];if(state?.StackStatus==="UPDATE_COMPLETE")break;if(state?.StackStatus!=="UPDATE_IN_PROGRESS"&&state?.StackStatus!=="UPDATE_COMPLETE_CLEANUP_IN_PROGRESS")fail("production_certificate_execution_failed");await pause(5000);}
  if(state?.StackStatus!=="UPDATE_COMPLETE")fail("production_certificate_execution_timeout");
  const resources=call("lookup","cloudformation","list-stack-resources",{StackName:b.stackId});if(resources.NextToken)fail("production_resource_snapshot_incomplete");
  const certificateArn=resources.StackResourceSummaries.find(r=>r.LogicalResourceId===LOGICAL)?.PhysicalResourceId;
  const cert=call("lookup","acm","describe-certificate",{CertificateArn:certificateArn}).Certificate;
  verifyCertificateExecution(b.resources,resources.StackResourceSummaries,cert);
  for(const stage of ["Original","Processed"]){const actual=bodyTemplate(call("lookup","cloudformation","get-template",{StackName:b.stackId,TemplateStage:stage}).TemplateBody);if(!same(actual,composeCertificateTemplate(b.templates[stage])))fail("production_certificate_post_template_mismatch");}
  if(!same(normalizeParameters(state.Parameters||[]),b.parameters)||(state.EnableTerminationProtection===true)!==b.terminationProtection)fail("production_certificate_post_stack_mismatch");
  const publicConfig=call("lookup","cloudfront","get-distribution-config",{Id:"EC4GODNMXFG7N"});if(!same(publicConfig,b.publicConfig))fail("production_public_distribution_changed");
  verifyDnsCertificateDelta(b.dns,readDns(call),cert);
  return {complete:true,certificateArn,digest:record.digest};
 }finally{if(path.dirname(dir)!==os.tmpdir())fail("production_cli_cleanup_invalid");fs.rmSync(dir,{recursive:true});}
}
module.exports.runCertificateOperation=runCertificateOperation;
module.exports.sourcePackageHash=sourcePackageHash;

if(require.main===module){
 (async()=>{
  const e=process.env;
  if(e.GITHUB_REPOSITORY!=="LynxPardelle/zoolandingpage-aws-infra"||e.GITHUB_REF!=="refs/heads/main"||e.GITHUB_EVENT_NAME!=="workflow_dispatch"||e.GITHUB_SHA!==e.EXPECTED_SOURCE_SHA||!/^[a-f0-9]{40}$/.test(e.EXPECTED_SOURCE_SHA||"")||!/^\d+$/.test(e.GITHUB_RUN_ID||"")||!/^\d+$/.test(e.GITHUB_RUN_ATTEMPT||""))fail("production_source_authority_invalid");
  const fingerprint=sourcePackageHash();if(fingerprint!==e.EXPECTED_SOURCE_PACKAGE_SHA256)fail("production_source_package_changed");
  const record=e.EXECUTION==="review"?undefined:JSON.parse(fs.readFileSync(path.resolve(e.REVIEW_FILE),"utf8"));
  const result=await runCertificateOperation({execution:e.EXECUTION,sourceSha:e.EXPECTED_SOURCE_SHA,sourcePackageSha256:fingerprint,runId:`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`,verifySource:()=>assertCurrentProductionSource(e.EXPECTED_SOURCE_SHA,e),call:productionClients(e,`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`),record,approvedDigest:e.EXPECTED_REVIEW_DIGEST,outputPath:path.resolve(e.REVIEW_OUTPUT_FILE||"certificate-review.json")});
  console.log(JSON.stringify(result));
 })().catch(error=>{console.error(JSON.stringify({error:/^[a-z0-9_]+$/.test(error.message)?error.message:"production_certificate_operation_failed",...(error.causeCode?{cause_code:error.causeCode}:{}),...(Number.isInteger(error.cliExitCode)?{cli_exit_status:error.cliExitCode}:{})}));process.exitCode=1;});
}

module.exports.productionClients=productionClients;
module.exports.readProductionBaseline=readProductionBaseline;
module.exports.baselineDigest=baselineDigest;
module.exports.verifyVersionedTemplate=verifyVersionedTemplate;
module.exports.waitPreview=waitPreview;
module.exports.roles=roles;
module.exports.ASSET_BUCKET=ASSET_BUCKET;
module.exports.rolePolicySnapshot=rolePolicySnapshot;
module.exports.assertProductionOperation=assertProductionOperation;
