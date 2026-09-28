"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const api=()=>require("../tools/thn-production-protection");
const state={stackId:"arn:aws:cloudformation:us-east-1:765932874577:stack/ZoolandingProduction-Zoolandingpage-production-Frontend/11111111-1111-1111-1111-111111111111",status:"UPDATE_COMPLETE",enabled:false,nativeSha256:"a".repeat(64),permissionSha256:"b".repeat(64)};
test("production protection operation is enable-only and requires exact fresh source/state digest",async()=>{
 const spec=api().reviewProtection(state,"c".repeat(40),"d".repeat(64),new Date("2026-09-27T12:00:00Z"));const writes=[];
 const run=()=>api().executeProtection(spec,spec.digest,state,"c".repeat(40),"d".repeat(64),request=>writes.push(request),new Date("2026-09-27T13:00:00Z"));
 await run();assert.equal(writes.length,1);assert.deepEqual(writes[0],{StackName:state.stackId,EnableTerminationProtection:true});
 for(const changed of [{...state,nativeSha256:"f".repeat(64)},{...state,enabled:true},{...state,stackId:state.stackId.replace("Production","Test")}])await assert.rejects(()=>api().executeProtection(spec,spec.digest,changed,"c".repeat(40),"d".repeat(64),request=>writes.push(request),new Date("2026-09-27T13:00:00Z")),/production_protection_stale/);
 assert.equal(writes.length,1);const disable={...spec,enable:false};await assert.rejects(()=>api().executeProtection(disable,spec.digest,state,"c".repeat(40),"d".repeat(64),()=>{},new Date("2026-09-27T13:00:00Z")),/production_protection_invalid/);
});
