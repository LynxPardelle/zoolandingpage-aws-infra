"use strict";
const fs=require("node:fs"),path=require("node:path"),{canonical,sha,STACK,roles,productionClients}=require("./thn-production-certificate-release");
const fail=c=>{throw Error(c);},keys=["schemaVersion","contract","operation","sourceSha","sourcePackageSha256","stackId","stateSha256","enable","createdAt","expiresAt"];
function stateCheck(s){if(!s||!new RegExp(`^arn:aws:cloudformation:us-east-1:765932874577:stack/${STACK}/[A-Za-z0-9-]+$`).test(s.stackId)||s.status!=="UPDATE_COMPLETE"&&s.status!=="CREATE_COMPLETE"||typeof s.enabled!=="boolean"||!/^[a-f0-9]{64}$/.test(s.nativeSha256)||!/^[a-f0-9]{64}$/.test(s.permissionSha256))fail("production_protection_invalid");}
function reviewProtection(state,sourceSha,sourcePackageSha256,now=new Date()){
 stateCheck(state);if(state.enabled||!/^[a-f0-9]{40}$/.test(sourceSha)||!/^[a-f0-9]{64}$/.test(sourcePackageSha256))fail("production_protection_invalid");
 const body={schemaVersion:1,contract:"thn-production-protection/v1",operation:"enable-termination-protection",sourceSha,sourcePackageSha256,stackId:state.stackId,stateSha256:sha(canonical(state)),enable:true,createdAt:now.toISOString(),expiresAt:new Date(now.getTime()+86400000).toISOString()};return {...body,digest:sha(canonical(body))};
}
function validateProtection(record){const {digest,...body}=record||{};if(canonical(Object.keys(body).sort())!==canonical([...keys].sort())||body.schemaVersion!==1||body.contract!=="thn-production-protection/v1"||body.operation!=="enable-termination-protection"||body.enable!==true||sha(canonical(body))!==digest||Date.parse(body.expiresAt)-Date.parse(body.createdAt)!==86400000)fail("production_protection_invalid");return record;}
async function executeProtection(record,digest,fresh,sourceSha,sourcePackageSha256,apply,now=new Date()){
 validateProtection(record);if(record.digest!==digest)fail("production_protection_invalid");
 if(now.getTime()<Date.parse(record.createdAt)-60000||now.getTime()>=Date.parse(record.expiresAt))fail("production_protection_expired");
 if(record.sourceSha!==sourceSha||record.sourcePackageSha256!==sourcePackageSha256||record.stackId!==fresh.stackId||record.stateSha256!==sha(canonical(fresh))||fresh.enabled)fail("production_protection_stale");
 await apply({StackName:record.stackId,EnableTerminationProtection:true});return true;
}
module.exports={reviewProtection,validateProtection,executeProtection};
function sourcePackageHash(){return sha(canonical(Object.fromEntries(["tools/thn-production-protection.js","tools/thn-production-certificate-release.js",".github/workflows/thn-production-protection.yml","package.json","package-lock.json"].map(f=>[f,sha(fs.readFileSync(path.resolve(__dirname,"..",f)))]))));}
function captureState(call){
 const cert=require("./thn-production-certificate-release"),b=cert.readProductionBaseline(call,{certificateAbsent:false,adminMustAbsent:false});
 return {stackId:b.stackId,status:b.status,enabled:b.terminationProtection,nativeSha256:cert.baselineDigest(b),permissionSha256:sha(canonical(b.trust))};
}
async function runProtection(options){
 const {call,sourceSha,fingerprint,execution}=options;
 if(!["review","execute"].includes(execution))fail("production_protection_invalid");
 const state=captureState(call);
 if(execution==="review")return reviewProtection(state,sourceSha,fingerprint);
 await executeProtection(options.record,options.approvedDigest,state,sourceSha,fingerprint,async request=>{
  const immediate=captureState(call);if(canonical(immediate)!==canonical(state))fail("production_protection_stale");
  options.verifySource?.();call("deploy","cloudformation","update-termination-protection",request);
 });
 const after=captureState(call);if(!after.enabled||after.stackId!==state.stackId||after.permissionSha256!==state.permissionSha256)fail("production_protection_post_mismatch");
 // Changing the protection bit is the only accepted native change.
 const cert=require("./thn-production-certificate-release"),b=cert.readProductionBaseline(call,{certificateAbsent:false,adminMustAbsent:false});b.terminationProtection=false;
 if(cert.baselineDigest(b)!==state.nativeSha256)fail("production_protection_post_mismatch");
 return {complete:true,operation:"enable-termination-protection",digest:options.record.digest};
}
module.exports.sourcePackageHash=sourcePackageHash;module.exports.captureState=captureState;module.exports.runProtection=runProtection;
if(require.main===module){(async()=>{
 const e=process.env,cert=require("./thn-production-certificate-release");
 if(e.GITHUB_REPOSITORY!=="LynxPardelle/zoolandingpage-aws-infra"||e.GITHUB_REF!=="refs/heads/main"||e.GITHUB_EVENT_NAME!=="workflow_dispatch"||e.GITHUB_SHA!==e.EXPECTED_SOURCE_SHA)fail("production_source_authority_invalid");
 const fingerprint=sourcePackageHash();if(fingerprint!==e.EXPECTED_SOURCE_PACKAGE_SHA256)fail("production_source_package_changed");
 const record=e.EXECUTION==="review"?undefined:JSON.parse(fs.readFileSync(path.resolve(e.REVIEW_FILE),"utf8"));
 const result=await runProtection({call:productionClients(e,`${e.GITHUB_RUN_ID}-${e.GITHUB_RUN_ATTEMPT}`),sourceSha:e.EXPECTED_SOURCE_SHA,fingerprint,execution:e.EXECUTION,record,approvedDigest:e.EXPECTED_REVIEW_DIGEST,verifySource:()=>cert.assertCurrentProductionSource(e.EXPECTED_SOURCE_SHA,e)});
 if(e.EXECUTION==="review")fs.writeFileSync("protection-review.json",JSON.stringify(result,null,2)+"\n",{flag:"wx",mode:0o600});console.log(JSON.stringify(result));
})().catch(error=>{console.error(JSON.stringify({error:/^[a-z0-9_]+$/.test(error.message)?error.message:"production_protection_failed",...(error.causeCode?{cause_code:error.causeCode}:{}),...(Number.isInteger(error.cliExitCode)?{cli_exit_status:error.cliExitCode}:{})}));process.exitCode=1;});}
