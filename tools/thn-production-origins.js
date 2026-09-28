"use strict";
const {canonical,sha}=require("./thn-production-certificate-release");
const fail=()=>{throw new Error("production_owner_snapshot_invalid");};
const exact=(x,k)=>x&&typeof x==="object"&&!Array.isArray(x)&&JSON.stringify(Object.keys(x).sort())===JSON.stringify(k.sort());
const owners=Object.freeze({thnAuthAdmin:{stack:"zoolanding-auth-admin-prod",logical:"ThnAuthAdminV2Api",type:"AWS::ApiGatewayV2::Api",stage:"prod"},thnAuthRuntime:{stack:"zoolanding-thn-auth-runtime-production",logical:"ThnRuntimeApi",type:"AWS::ApiGateway::RestApi",stage:"Prod"},contentHub:{stack:"zoolanding-content-hub-prod",logical:"ContentHubApi",type:"AWS::ApiGatewayV2::Api",stage:"prod"}});
const forbidden=new Set(["d6h2nzsn0i","5paiwwz4zl","z1pub0v0c7","11zpm6wug2","88fcmasim1","yxp97qlog2"]);
function validateProductionOrigins(snapshot){
 if(!exact(snapshot,["schemaVersion","environment","account","region","owners"])||snapshot.schemaVersion!==1||snapshot.environment!=="production"||snapshot.account!=="765932874577"||snapshot.region!=="us-east-1"||!exact(snapshot.owners,Object.keys(owners)))fail();
 const result={};
 for(const [key,spec] of Object.entries(owners)){
  const o=snapshot.owners[key];
  if(!exact(o,["stackId","stackStatus","resources","processedTemplate","processedTemplateSha256","resourceInventorySha256","stageParameters"])||!new RegExp(`^arn:aws:cloudformation:us-east-1:765932874577:stack/${spec.stack}/[a-zA-Z0-9-]+$`).test(o.stackId)||!["UPDATE_COMPLETE","CREATE_COMPLETE"].includes(o.stackStatus)||!Array.isArray(o.resources)||!o.processedTemplate?.Resources||!/^[a-f0-9]{64}$/.test(o.processedTemplateSha256)||!/^[a-f0-9]{64}$/.test(o.resourceInventorySha256))fail();
  const api=o.resources.filter(r=>r.LogicalResourceId===spec.logical);
  if(api.length!==1||api[0].ResourceType!==spec.type||!/^[a-z0-9]{10}$/.test(api[0].PhysicalResourceId)||forbidden.has(api[0].PhysicalResourceId)||o.processedTemplate.Resources[spec.logical]?.Type!==spec.type)fail();
  const stageType=spec.type==="AWS::ApiGateway::RestApi"?"AWS::ApiGateway::Stage":"AWS::ApiGatewayV2::Stage",idKey=spec.type==="AWS::ApiGateway::RestApi"?"RestApiId":"ApiId";
  if(!exact(o.stageParameters,Object.keys(o.stageParameters))||Object.keys(o.stageParameters).some(k=>k!=="EnvironmentName")||o.stageParameters.EnvironmentName!==undefined&&o.stageParameters.EnvironmentName!=="prod")fail();
  const stageName=v=>typeof v==="string"?v:canonical(v)===canonical({Ref:"EnvironmentName"})?o.stageParameters.EnvironmentName:undefined;
  const stage=Object.values(o.processedTemplate.Resources).filter(r=>r.Type===stageType&&stageName(r.Properties?.StageName)===spec.stage&&canonical(r.Properties[idKey])===canonical({Ref:spec.logical}));
  if(stage.length!==1)fail();
  result[key]={domainName:`${api[0].PhysicalResourceId}.execute-api.us-east-1.amazonaws.com`,originPath:`/${spec.stage}`};
 }
 if(new Set(Object.values(result).map(r=>r.domainName)).size!==3)fail();
 return Object.freeze(result);
}
function captureProductionOrigins(call){
 const snapshot={schemaVersion:1,environment:"production",account:"765932874577",region:"us-east-1",owners:{}};
 for(const [key,spec] of Object.entries(owners)){
  const response=call("cloudformation","describe-stacks",{StackName:spec.stack});if(response.Stacks?.length!==1)fail();const s=response.Stacks[0];
  const resources=call("cloudformation","list-stack-resources",{StackName:s.StackId});if(resources.NextToken)fail();
  const raw=call("cloudformation","get-template",{StackName:s.StackId,TemplateStage:"Processed"}).TemplateBody;
  const template=typeof raw==="string"?JSON.parse(raw):raw,allResources=resources.StackResourceSummaries.map(({LogicalResourceId,ResourceType,PhysicalResourceId})=>({LogicalResourceId,ResourceType,PhysicalResourceId}));
  const selectedDefinitions=Object.fromEntries(Object.entries(template.Resources).filter(([id,r])=>id===spec.logical||(r.Type=== "AWS::ApiGateway::Stage"||r.Type==="AWS::ApiGatewayV2::Stage")&&canonical(r.Properties?.ApiId||r.Properties?.RestApiId)===canonical({Ref:spec.logical})));
  snapshot.owners[key]={stackId:s.StackId,stackStatus:s.StackStatus,stageParameters:Object.fromEntries((s.Parameters||[]).filter(p=>p.ParameterKey==="EnvironmentName").map(p=>[p.ParameterKey,p.ParameterValue])),resources:allResources.filter(r=>r.LogicalResourceId===spec.logical),processedTemplate:{Resources:selectedDefinitions},processedTemplateSha256:sha(canonical(template)),resourceInventorySha256:sha(canonical(allResources.sort((a,b)=>a.LogicalResourceId.localeCompare(b.LogicalResourceId))))};
 }
 validateProductionOrigins(snapshot);return snapshot;
}
module.exports={validateProductionOrigins,captureProductionOrigins,owners,snapshotDigest:snapshot=>{validateProductionOrigins(snapshot);return sha(canonical(snapshot));}};
