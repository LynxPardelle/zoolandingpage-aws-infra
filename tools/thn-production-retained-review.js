"use strict";
const {createHash}=require("node:crypto");
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==="object"?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
const canonical=x=>JSON.stringify(stable(x));const hash=x=>createHash("sha256").update(canonical(x)).digest("hex");
const fail=c=>{throw new Error(c||"retained_review_invalid");};
const keys=["schemaVersion","contract","environment","service","purpose","sourceSha","sourcePackageSha256","stackId","changeSetArn","createdAt","expiresAt","baselineSha256","identitySha256","permissionSha256","originalTemplateSha256","processedTemplateSha256","parametersSha256","nativeInventorySha256","packageManifest","recoveryCoordinates","changes"];
const exact=(x,k)=>x&&typeof x==="object"&&!Array.isArray(x)&&canonical(Object.keys(x).sort())===canonical([...k].sort());
function bodyReview(r){
 if(!exact(r,keys)||r.schemaVersion!==1||r.contract!=="thn-production-retained-review/v1"||r.environment!=="production"||r.service!=="infra"||!["certificate","private-frontdoor","public-visual","general","recover","deployment-identities","deployment-identities-trust-patch","deployment-identities-hub-rule-policy-patch","deployment-identities-hub-import-read-patch","deployment-identities-api-runtime-role-patch"].includes(r.purpose)||!/^([a-f0-9]{40})$/.test(r.sourceSha)||/^0+$/.test(r.sourceSha))fail();
 for(const k of keys.filter(k=>k.endsWith("Sha256")))if(!/^[a-f0-9]{64}$/.test(r[k]))fail();
 const stack=["deployment-identities","deployment-identities-trust-patch","deployment-identities-hub-rule-policy-patch","deployment-identities-hub-import-read-patch","deployment-identities-api-runtime-role-patch"].includes(r.purpose)?"ThnDeploymentIdentities":"Frontend";
 if(!new RegExp(`^arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingProduction-Zoolandingpage-production-${stack}/[A-Za-z0-9-]+$`).test(r.stackId)||!new RegExp(`^arn:aws:cloudformation:us-east-1:765932874577:changeSet/thn-production-${r.purpose}-[A-Za-z0-9-]+/[A-Za-z0-9-]+$`).test(r.changeSetArn))fail();
 const created=Date.parse(r.createdAt),expires=Date.parse(r.expiresAt);
 if(!Number.isFinite(created)||new Date(created).toISOString()!==r.createdAt||expires-created!==86400000||new Date(expires).toISOString()!==r.expiresAt)fail();
 for(const list of [r.packageManifest,r.recoveryCoordinates]){
  if(!Array.isArray(list)||list.length>256)fail();const seen=new Set();
  for(const o of list){if(!exact(o,["bucket","key","versionId","sha256"])||!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(o.bucket)||!/^thn-production\/[A-Za-z0-9._/-]+$/.test(o.key)&&!(o.bucket==="zoolandingpage-production-frontend-artifacts-765932874577"&&/^frontend\/angular-ssr\/production\/releases\/[A-Za-z0-9._/-]+$/.test(o.key))||o.key.split("/").some(p=>!p||p==="."||p==="..")||typeof o.versionId!=="string"||o.versionId==="null"||!/^[A-Za-z0-9._+/-]{1,1024}$/.test(o.versionId)||!/^[a-f0-9]{64}$/.test(o.sha256)||seen.has(o.bucket+"/"+o.key))fail();seen.add(o.bucket+"/"+o.key);}
 }
 if(!r.packageManifest.length||!Array.isArray(r.changes)||!r.changes.length||r.changes.some(c=>c.Type!=="Resource"||!c.ResourceChange))fail();
 return r;
}
function sealReview(body){bodyReview(body);return {...structuredClone(body),digest:hash(body)};}
function validateReview(record){if(!exact(record,[...keys,"digest"])||!/^[a-f0-9]{64}$/.test(record.digest))fail();const {digest,...body}=record;bodyReview(body);if(hash(body)!==digest)fail();return record;}
function verifyRetainedExecution(record,approvedDigest,fresh,native,now=new Date()){
 validateReview(record);if(record.digest!==approvedDigest)fail();
 const current=now.getTime();if(current<Date.parse(record.createdAt)-60000||current>=Date.parse(record.expiresAt))fail("retained_review_expired");
 for(const k of ["sourceSha","sourcePackageSha256","baselineSha256","identitySha256","permissionSha256","originalTemplateSha256","processedTemplateSha256","parametersSha256","nativeInventorySha256","changes","packageManifest"])if(canonical(fresh[k])!==canonical(record[k]))fail("retained_review_stale");
 if(native.StackId!==record.stackId||native.ChangeSetId!==record.changeSetArn||native.Status!=="CREATE_COMPLETE"||native.ExecutionStatus!=="AVAILABLE"||native.NextToken||native.IncludeNestedStacks===true||new Date(native.CreationTime).toISOString()!==record.createdAt||hash(native.Changes)!==record.nativeInventorySha256||canonical(inventorySummary(native.Changes))!==canonical(record.changes))fail("retained_review_stale");
 return true;
}
function inventorySummary(changes){
 if(!Array.isArray(changes))fail();
 return changes.map(c=>{const r=c.ResourceChange;if(c.Type!=="Resource"||!r)fail();return {Type:c.Type,ResourceChange:Object.fromEntries(["Action","LogicalResourceId","PhysicalResourceId","ResourceType","Replacement","Scope"].filter(k=>r[k]!==undefined).map(k=>[k,r[k]])),changeSha256:hash(c)};});
}
module.exports={inventorySummary,sealReview,validateReview,verifyRetainedExecution,canonical,hash};
