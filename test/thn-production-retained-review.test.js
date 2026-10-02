"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=()=>require("../tools/thn-production-retained-review");
const data=()=>({schemaVersion:1,contract:"thn-production-retained-review/v1",environment:"production",service:"infra",purpose:"certificate",sourceSha:"a".repeat(40),sourcePackageSha256:"b".repeat(64),stackId:"arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingProduction-Zoolandingpage-production-Frontend/11111111-1111-1111-1111-111111111111",changeSetArn:"arn:aws:cloudformation:us-east-1:765932874577:changeSet/thn-production-certificate-1/11111111-1111-1111-1111-111111111111",createdAt:"2026-09-27T12:00:00.000Z",expiresAt:"2026-09-28T12:00:00.000Z",baselineSha256:"c".repeat(64),identitySha256:"d".repeat(64),permissionSha256:"e".repeat(64),originalTemplateSha256:"f".repeat(64),processedTemplateSha256:"1".repeat(64),parametersSha256:"2".repeat(64),packageManifest:[{bucket:"cdk-hnb659fds-assets-765932874577-us-east-1",key:"thn-production/certificate/"+"3".repeat(64)+".json",versionId:"abc123",sha256:"3".repeat(64)}],recoveryCoordinates:[],changes:[{Type:"Resource",ResourceChange:{Action:"Add",LogicalResourceId:"ThnAdminProductionCertificate",ResourceType:"AWS::CertificateManager::Certificate"}}]});
function sealed(){const d=data();return api().sealReview({...d,changes:api().inventorySummary(d.changes),nativeInventorySha256:api().hash(d.changes)});}
test("retained review seals full native inventory, exact ARN and versioned package coordinates",()=>{
 const record=sealed();assert.match(record.digest,/^[a-f0-9]{64}$/);assert.deepEqual(api().validateReview(record),record);
 for(const change of [x=>x.changeSetArn=x.changeSetArn.replace("certificate-1","certificate-2"),x=>x.packageManifest[0].key+="other",x=>x.packageManifest[0].versionId="abc124",x=>x.changes[0].ResourceChange.Details=[{Target:{Name:"other"}}],x=>x.permissionSha256="4".repeat(64),x=>x.sourcePackageSha256="5".repeat(64)]){const bad=structuredClone(record);change(bad);assert.throws(()=>api().validateReview(bad),/retained_review_invalid/);}
});
test("API tag path review seals the deployment identities stack and exact purpose",()=>{
 const body=data();body.purpose="deployment-identities-api-tag-path-patch";
 body.stackId=body.stackId.replace("Frontend","ThnDeploymentIdentities");
 body.changeSetArn=body.changeSetArn.replace("certificate-1","deployment-identities-api-tag-path-patch-37057162818-1");
 body.changes=[{Type:"Resource",ResourceChange:{Action:"Modify",LogicalResourceId:"ApiCfnNativePolicy0",ResourceType:"AWS::IAM::ManagedPolicy",Replacement:"False",Scope:["Properties"]}}];
 const record=api().sealReview({...body,changes:api().inventorySummary(body.changes),nativeInventorySha256:api().hash(body.changes)});
 assert.deepEqual(api().validateReview(record),record);
 const wrongStack=structuredClone(record);wrongStack.stackId=wrongStack.stackId.replace("ThnDeploymentIdentities","Frontend");
 assert.throws(()=>api().validateReview(wrongStack),/retained_review_invalid/);
});
test("execution gate fails closed on source, baseline, permissions, native preview state and expiry before execute",()=>{
 const r=sealed(),fresh={sourceSha:r.sourceSha,sourcePackageSha256:r.sourcePackageSha256,baselineSha256:r.baselineSha256,identitySha256:r.identitySha256,permissionSha256:r.permissionSha256,originalTemplateSha256:r.originalTemplateSha256,processedTemplateSha256:r.processedTemplateSha256,parametersSha256:r.parametersSha256,changes:r.changes,nativeInventorySha256:r.nativeInventorySha256,packageManifest:r.packageManifest};
 const native={Status:"CREATE_COMPLETE",ExecutionStatus:"AVAILABLE",StackId:r.stackId,ChangeSetId:r.changeSetArn,CreationTime:r.createdAt,Changes:data().changes};
 assert.equal(api().verifyRetainedExecution(r,r.digest,fresh,native,new Date("2026-09-27T13:00:00Z")),true);
 for(const [key,value] of [["baselineSha256","4".repeat(64)],["sourceSha","f".repeat(40)],["permissionSha256","5".repeat(64)],["changes",[]]])assert.throws(()=>api().verifyRetainedExecution(r,r.digest,{...fresh,[key]:value},native,new Date("2026-09-27T13:00:00Z")),/retained_review_stale/);
 assert.throws(()=>api().verifyRetainedExecution(r,r.digest,fresh,native,new Date("2026-09-28T12:00:00Z")),/retained_review_expired/);
 assert.throws(()=>api().verifyRetainedExecution(r,r.digest,fresh,{...native,ExecutionStatus:"EXECUTE_COMPLETE"},new Date("2026-09-27T13:00:00Z")),/retained_review_stale/);
});
