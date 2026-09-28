"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const api=()=>require("../tools/thn-production-certificate-release");
const certificate={Type:"AWS::CertificateManager::Certificate",DeletionPolicy:"Retain",UpdateReplacePolicy:"Retain",Properties:{DomainName:"admin.thehairnarrative.com",ValidationMethod:"DNS",CertificateExport:"DISABLED",DomainValidationOptions:[{DomainName:"admin.thehairnarrative.com",HostedZoneId:"Z08032292DKYZ4QGCIZDR"}]}};
const original={AWSTemplateFormatVersion:"2010-09-09",Resources:{ExistingPublic:{Type:"AWS::CloudFront::Distribution",Properties:{DistributionConfig:{Aliases:["thehairnarrative.com"]}}}},Outputs:{PublicAlias:{Value:"thehairnarrative.com"}}};
const fixture=()=>({Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",ChangeSetType:"UPDATE",StackName:"ZoolandingProduction-Zoolandingpage-production-Frontend",StackId:"arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingProduction-Zoolandingpage-production-Frontend/11111111-2222-3333-4444-555555555555",Changes:[{Type:"Resource",ResourceChange:{Action:"Add",LogicalResourceId:"ThnAdminProductionCertificate",ResourceType:"AWS::CertificateManager::Certificate",Scope:["Properties"],Details:[],AfterContext:JSON.stringify({Properties:certificate.Properties})}}]});
test("compose production certificate preserves every existing resource/parameter/output and retains exactly one approved certificate",()=>{
 const result=api().composeCertificateTemplate(original);
 assert.deepEqual(result.Resources.ThnAdminProductionCertificate,certificate);
 assert.deepEqual(result.Resources.ExistingPublic,original.Resources.ExistingPublic);
 const copy=structuredClone(result);delete copy.Resources.ThnAdminProductionCertificate;assert.deepEqual(copy,original);
 assert.throws(()=>api().composeCertificateTemplate(result),/production_certificate_template_invalid/);
 assert.throws(()=>api().composeCertificateTemplate({...original,Transform:"AWS::Serverless-2016-10-31"}),/production_certificate_template_invalid/);
});
test("native certificate review rejects all collateral, deletion, replacement, wrong environment and incomplete change-set states",()=>{
 const f=fixture();assert.equal(api().reviewCertificateChangeSet(f).length,1);
 for(const mutate of [v=>v.Changes.push({...v.Changes[0],ResourceChange:{...v.Changes[0].ResourceChange,LogicalResourceId:"ExistingPublic",Action:"Modify"}}),v=>v.Changes[0].ResourceChange.Action="Modify",v=>v.Changes[0].ResourceChange.Action="Remove",v=>v.Changes[0].ResourceChange.Replacement="True",v=>v.Changes[0].ResourceChange.LogicalResourceId="ThnAdminTestCertificate",v=>v.Status="CREATE_IN_PROGRESS",v=>v.ExecutionStatus="EXECUTE_COMPLETE",v=>v.StackId=v.StackId.replace("765932874577","111111111111"),v=>v.Changes[0].ResourceChange.ResourceType="AWS::IAM::Role",v=>v.Changes[0].ResourceChange.AfterContext=JSON.stringify({Properties:{...certificate.Properties,DomainName:"admin-test.thehairnarrative.com"}})]){const bad=structuredClone(f);mutate(bad);assert.throws(()=>api().reviewCertificateChangeSet(bad),/production_certificate_change_set_invalid/);}
});
test("review digest seals source, baseline, permissions snapshot, native inventory and candidate and retains exact native change-set ARN",()=>{
 const context={sourceSha:"a".repeat(40),baselineSha256:"b".repeat(64),candidateSha256:"c".repeat(64),identitySha256:"d".repeat(64),permissionSha256:"e".repeat(64)};
 const f={...fixture(),ChangeSetId:"arn:aws:cloudformation:us-east-1:765932874577:changeSet/thn-production-certificate-1/11111111-2222-3333-4444-555555555555"},first=api().certificateReviewDigest(context,f);
 assert.match(first,/^[a-f0-9]{64}$/);
 assert.notEqual(api().certificateReviewDigest(context,{...f,ChangeSetId:f.ChangeSetId.replace("certificate-1","certificate-2")}),first);
 assert.throws(()=>api().certificateReviewDigest(context,{...f,ChangeSetId:"unused"}),/production_certificate_digest_invalid/);
 for(const key of Object.keys(context)){const bad={...context,[key]:(key==="sourceSha"?"f".repeat(40):"f".repeat(64))};assert.notEqual(api().certificateReviewDigest(bad,f),first);}
});
test("certificate execution readback rejects loss or substitution of any baseline identity and wrong host/issuer status",()=>{
 const before=[{LogicalResourceId:"ExistingPublic",PhysicalResourceId:"EC4GODNMXFG7N",ResourceType:"AWS::CloudFront::Distribution"}];
 const created={LogicalResourceId:"ThnAdminProductionCertificate",PhysicalResourceId:"arn:aws:acm:us-east-1:765932874577:certificate/11111111-2222-3333-4444-555555555555",ResourceType:"AWS::CertificateManager::Certificate"};
 const cert={CertificateArn:created.PhysicalResourceId,DomainName:"admin.thehairnarrative.com",SubjectAlternativeNames:["admin.thehairnarrative.com"],Status:"ISSUED",Type:"AMAZON_ISSUED"};
 assert.equal(api().verifyCertificateExecution(before,[...before,created],cert),true);
 for(const after of [[created],[{...before[0],PhysicalResourceId:"OTHER"},created],[...before,created,{...created,LogicalResourceId:"Collateral"}]])assert.throws(()=>api().verifyCertificateExecution(before,after,cert),/production_certificate_readback_invalid/);
 assert.throws(()=>api().verifyCertificateExecution(before,[...before,created],{...cert,Status:"PENDING_VALIDATION"}),/production_certificate_readback_invalid/);
});

test("actual CDK target trust accepts only absence ExternalId condition and rejects all unfamiliar conditions",()=>{
 const base={Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"sts:AssumeRole",Principal:{AWS:"arn:aws:iam::765932874577:root"},Condition:{Null:{"sts:ExternalId":"true"}}}]};
 assert.doesNotThrow(()=>api().assertCdkTrust(base));
 for(const condition of [{Null:{"sts:ExternalId":"false"}},{StringEquals:{"sts:ExternalId":"guessed"}},{Null:{"sts:ExternalId":"true"},StringEquals:{"aws:PrincipalTag/unreviewed":"true"}}])assert.throws(()=>api().assertCdkTrust({...base,Statement:[{...base.Statement[0],Condition:condition}]}),/production_role_trust_unproved/);
});

test("certificate driver reuses exact reviewed ARN with no repackage and blocks baseline drift before execution",async()=>{
 const fs=require("node:fs"),os=require("node:os"),path=require("node:path"),dir=fs.mkdtempSync(path.join(os.tmpdir(),"thn-certificate-test-"));
 const a=api(),stackId=fixture().StackId,roleArn="arn:aws:iam::765932874577:role/cdk-hnb659fds-cfn-exec-role-765932874577-us-east-1";
 const resources=[{LogicalResourceId:"ExistingPublic",PhysicalResourceId:"EC4GODNMXFG7N",ResourceType:"AWS::CloudFront::Distribution"}],distribution={ETag:"same",DistributionConfig:{Aliases:{Items:["thehairnarrative.com"]}}};
 let preview,bytes,candidate,executed=false,drift=false;const writes=[];
 const call=(kind,service,operation,input,file)=>{
  const key=service+":"+operation;
  if(key==="cloudformation:describe-stacks")return {Stacks:[{StackName:a.STACK,StackId:stackId,StackStatus:"UPDATE_COMPLETE",RoleARN:roleArn,EnableTerminationProtection:false,Parameters:drift?[{ParameterKey:"Changed",ParameterValue:"changed"}]:[]}]};
  if(key==="cloudformation:get-template")return {TemplateBody:input.ChangeSetName?candidate:original};
  if(key==="cloudformation:list-stack-resources")return {StackResourceSummaries:resources};
  if(key==="route53:get-hosted-zone")return {HostedZone:{Id:"/hostedzone/"+a.ZONE,Name:"thehairnarrative.com.",Config:{PrivateZone:false}}};
  if(key==="route53:list-resource-record-sets")return {ResourceRecordSets:[],IsTruncated:false};
  if(key==="cloudfront:get-distribution-config")return distribution;
  if(key==="iam:get-role"){const arn="arn:aws:iam::765932874577:role/"+input.RoleName;return {Role:{Arn:arn,AssumeRolePolicyDocument:{Version:"2012-10-17",Statement:[{Effect:"Allow",Action:"sts:AssumeRole",Principal:input.RoleName.includes("cfn-exec")?{Service:"cloudformation.amazonaws.com"}:{AWS:"arn:aws:iam::765932874577:root"},...(input.RoleName.includes("cfn-exec")?{}:{Condition:{Null:{"sts:ExternalId":"true"}}})}]}}};}
  if(key==="iam:list-role-policies")return {PolicyNames:[]};if(key==="iam:list-attached-role-policies")return {AttachedPolicies:[]};
  if(key==="s3api:get-bucket-versioning")return {Status:"Enabled"};
  if(key==="s3api:get-bucket-encryption")return {ServerSideEncryptionConfiguration:{Rules:[{ApplyServerSideEncryptionByDefault:{SSEAlgorithm:"aws:kms"}}]}};
  if(key==="s3api:get-bucket-policy")return {Policy:"{}"};if(key==="s3api:get-bucket-acl")return {Owner:{ID:"owner"},Grants:[{Permission:"FULL_CONTROL",Grantee:{ID:"owner"}}]};
  if(key==="kms:describe-key")return {KeyMetadata:{Arn:"arn:aws:kms:us-east-1:765932874577:key/11111111-1111-1111-1111-111111111111",KeyManager:"AWS",KeyState:"Enabled",Enabled:true}};
  if(key==="kms:get-key-policy")return {Policy:"{}"};
  if(key==="s3api:list-objects-v2")return {Contents:[]};
  if(key==="s3api:put-object"){writes.push(key);bytes=fs.readFileSync(input.Body);candidate=JSON.parse(bytes);return {VersionId:"version1"};}
  if(key==="s3api:get-object"){fs.writeFileSync(file,bytes);return {VersionId:"version1"};}
  if(key==="cloudformation:create-change-set"){writes.push(key);preview={...fixture(),ChangeSetId:"arn:aws:cloudformation:us-east-1:765932874577:changeSet/"+input.ChangeSetName+"/11111111-1111-1111-1111-111111111111",CreationTime:new Date().toISOString()};return {Id:preview.ChangeSetId};}
  if(key==="cloudformation:describe-change-set")return preview;
  if(key==="cloudformation:execute-change-set"){executed=true;throw Error("test_execution_boundary");}
  throw Error("unexpected_mock_call:"+key);
 };
 try{
  const options={sourceSha:"a".repeat(40),sourcePackageSha256:"b".repeat(64),runId:"123-1",call,outputPath:path.join(dir,"record.json")};
  const record=await a.runCertificateOperation({...options,execution:"review"});assert.equal(executed,false);assert.equal(writes.filter(x=>x==="cloudformation:create-change-set").length,1);
  drift=true;await assert.rejects(()=>a.runCertificateOperation({...options,execution:"execute",record,approvedDigest:record.digest}),/retained_review_stale/);assert.equal(executed,false);
  drift=false;await assert.rejects(()=>a.runCertificateOperation({...options,execution:"execute",record,approvedDigest:record.digest}),/test_execution_boundary/);assert.equal(executed,true);assert.equal(writes.filter(x=>x==="cloudformation:create-change-set").length,1);assert.equal(writes.filter(x=>x==="s3api:put-object").length,1);
 }finally{fs.rmSync(dir,{recursive:true});}
});
