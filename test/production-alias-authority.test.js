"use strict";
const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),os=require("node:os"),path=require("node:path"),{spawnSync}=require("node:child_process");
const workflow=()=>fs.readFileSync(path.join(__dirname,"../.github/workflows/production-alias-ops.yml"),"utf8").replace(/\r\n/g,"\n");
const bash=process.platform==="win32"?"C:/Program Files/Git/bin/bash.exe":"bash";
function run(script,env){return spawnSync(bash,["-c",script],{encoding:"utf8",env:{...process.env,...env}});}
test("alias operation preserves shell metacharacters as literal argv",()=>{
 const body=workflow().split("      - name: Audit or clean production aliases")[1],script=body.split("        run: |\n")[1].replace(/^          /gm,"");
 assert(!script.includes("${{ inputs."));
 const result=run("node(){ printf '%s\\n' \"$@\"; };\n"+script,{APPLY_CLEANUP:"false",CONFIRM_CLEANUP:'$(printf INPUT_EXECUTED)',PREFLIGHT_CUSTOM_ALIASES:"true"});
 assert.equal(result.status,0,result.stderr);assert(result.stdout.includes('--confirm-cleanup=$(printf INPUT_EXECUTED)'));
});
test("alias authority rejects other branches before credentials",()=>{
 const text=workflow(),section=text.split("      - name: Validate production authority before credentials")[1];assert(section);
 assert(text.indexOf("Validate production authority")<text.indexOf("aws-actions/configure-aws-credentials"));
 const script=section.split("        run: |\n")[1].split("      - ")[0].replace(/^          /gm,"");
 const result=run(script,{GITHUB_REF:"refs/heads/test",GITHUB_REPOSITORY:"LynxPardelle/zoolandingpage-aws-infra",GITHUB_EVENT_NAME:"workflow_dispatch"});assert.notEqual(result.status,0);
});
