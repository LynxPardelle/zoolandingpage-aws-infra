"use strict";
const {canonical,sha}=require("./thn-production-certificate-release");
const same=(a,b)=>canonical(a)===canonical(b),fail=c=>{throw new Error(c);};
const privateTypes=new Map([
 ["FrontendThnAdminSsrLogGroup25C7E89D","AWS::Logs::LogGroup"],["FrontendThnAdminSsrFunctionServiceRole633F1E33","AWS::IAM::Role"],["FrontendThnAdminSsrFunction874373CC","AWS::Lambda::Function"],["FrontendThnAdminSsrFunctionFunctionUrlA847D4A7","AWS::Lambda::Url"],["FrontendThnAdminSsrFunctionAllowCloudFrontInvokeFunctionUrlThehairnarrativeAdminProductionB8136A3A","AWS::Lambda::Permission"],["FrontendThnAdminSsrFunctionAllowCloudFrontInvokeFunctionThehairnarrativeAdminProduction8A0AB701","AWS::Lambda::Permission"],["FrontendViewerHostHeaderFunctionThehairnarrativeAdminProduction1D25C5CB","AWS::CloudFront::Function"],["FrontendResponseHeadersPolicyThehairnarrativeAdminProductionB0DBB124","AWS::CloudFront::ResponseHeadersPolicy"],["FrontendDistributionThehairnarrativeAdminProductionOrigin1FunctionUrlOriginAccessControl025A6E7B","AWS::CloudFront::OriginAccessControl"],["FrontendDistributionThehairnarrativeAdminProductionF99395A3","AWS::CloudFront::Distribution"],["FrontendDistributionDomainParameterThehairnarrativeAdminProduction2FBFA4CE","AWS::SSM::Parameter"]
]);
function privateResource(id,r){return privateTypes.get(id)===r.Type || (/^FrontendDistributionThehairnarrativeAdminProductionOrigin1InvokeFromApiFor[A-Za-z0-9]+[A-F0-9]{8}$/.test(id)&&r.Type==="AWS::Lambda::Permission") || (/^ThnProductionAdminAlias(?:A0|AAAA1)[A-F0-9]{8}$/.test(id)&&r.Type==="AWS::Route53::RecordSet");}
const release=x=>typeof x==="string"&&/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(x)&&!x.includes("..");
function ownedArtifactBucket(template,value){
 if(value==="zoolandingpage-production-frontend-artifacts-765932874577")return true;
 if(value&&typeof value.Ref==="string"&&Object.keys(value).length===1){const resource=template.Resources[value.Ref];return resource?.Type==="AWS::S3::Bucket"&&resource.Properties?.BucketName==="zoolandingpage-production-frontend-artifacts-765932874577";}
 return false;
}
function projectPrivateFrontdoor(before,desired,releaseId){
 const bad=()=>fail("production_private_projection_invalid");
 if(!release(releaseId)||!before?.Resources||!desired?.Resources||!same(before.Resources.ThnAdminProductionCertificate,desired.Resources.ThnAdminProductionCertificate)||!before.Resources.ThnAdminProductionCertificate)bad();
 const result=structuredClone(before),entries=Object.entries(desired.Resources).filter(([id,r])=>privateResource(id,r));
 const fn=entries.filter(([,r])=>r.Type==="AWS::Lambda::Function"),dist=entries.filter(([,r])=>r.Type==="AWS::CloudFront::Distribution");
 if(fn.length!==1||dist.length!==1||fn[0][1].Properties.FunctionName!=="zoolandingpage-production-frontend-thn-admin-ssr"||fn[0][1].Properties.Environment?.Variables?.THN_DEPLOYMENT_ENVIRONMENT!=="production"||!ownedArtifactBucket(desired,fn[0][1].Properties.Code?.S3Bucket)||fn[0][1].Properties.Code?.S3Key!==`frontend/angular-ssr/production/releases/${releaseId}/server/ssr-handler.zip`||!same(dist[0][1].Properties.DistributionConfig.Aliases,["admin.thehairnarrative.com"]))bad();
 for(const [id,r] of entries){
  if(r.Type==="AWS::Route53::RecordSet"&&(r.Properties.Name!=="admin.thehairnarrative.com."||r.Properties.HostedZoneId!=="Z08032292DKYZ4QGCIZDR"||!["A","AAAA"].includes(r.Properties.Type)||r.DeletionPolicy!=="Retain"||r.UpdateReplacePolicy!=="Retain"))bad();
  result.Resources[id]=structuredClone(r);
 }
 const param=desired.Parameters?.ThnAdminAuthAdminOriginVerifySecret;
 if(param){if(param.NoEcho!==true||param.Default!==undefined||param.AllowedPattern!=="^[A-Za-z0-9_-]{43}$")bad();result.Parameters={...result.Parameters,ThnAdminAuthAdminOriginVerifySecret:structuredClone(param)};}
 return result;
}
function projectPublicVisual(before,desired,releaseId){
 const bad=()=>fail("production_public_projection_invalid");if(!release(releaseId)||!before?.Resources||!desired?.Resources)bad();
 const result=structuredClone(before),functions=Object.entries(before.Resources).filter(([,r])=>r.Type==="AWS::Lambda::Function"&&r.Properties.FunctionName==="zoolandingpage-production-frontend-ssr");
 if(functions.length!==1)bad();const [id,fn]=functions[0],candidate=desired.Resources[id];
 const code=candidate?.Properties?.Code;
 if(candidate?.Type!==fn.Type||!ownedArtifactBucket(desired,code?.S3Bucket)||code.S3Key!==`frontend/angular-ssr/production/releases/${releaseId}/server/ssr-handler.zip`||candidate.Properties.Environment?.Variables?.ZLP_RELEASE_ID!==releaseId)bad();
 result.Resources[id].Properties.Code=structuredClone(code);result.Resources[id].Properties.Environment.Variables.ZLP_RELEASE_ID=releaseId;
 let publicSeen=false;
 for(const [rid,r] of Object.entries(before.Resources)){
  if(r.Type==="AWS::CloudFront::Distribution"&&!r.Properties.DistributionConfig.Aliases?.includes("admin.thehairnarrative.com")){
   const d=desired.Resources[rid];if(!same(d?.Properties?.DistributionConfig?.Aliases,r.Properties.DistributionConfig.Aliases))bad();
   if(r.Properties.DistributionConfig.Aliases?.includes("thehairnarrative.com"))publicSeen=true;
   const oldOrigins=r.Properties.DistributionConfig.Origins||[],newOrigins=d.Properties.DistributionConfig.Origins||[];
   for(const origin of oldOrigins.filter(o=>o.DomainName==="assets.zoolandingpage.com.mx")){
    const incoming=newOrigins.filter(o=>o.Id===origin.Id);if(incoming.length!==1||incoming[0].DomainName!==origin.DomainName||incoming[0].OriginPath!==`/frontend/angular-ssr/production/releases/${releaseId}/browser`)bad();
    result.Resources[rid].Properties.DistributionConfig.Origins.find(o=>o.Id===origin.Id).OriginPath=incoming[0].OriginPath;
   }
  }
  if(r.Type==="AWS::SSM::Parameter"&&["release-id","static-prefix","server-bundle-key"].some(s=>r.Properties.Name===`/zoolandingpage/production/frontend/${s}`)){
   const incoming=desired.Resources[rid];if(incoming?.Type!==r.Type||incoming.Properties.Name!==r.Properties.Name)bad();result.Resources[rid].Properties.Value=incoming.Properties.Value;
  }
 }
 if(!publicSeen)bad();if(result.Outputs?.FrontendReleaseId)result.Outputs.FrontendReleaseId.Value=releaseId;
 return result;
}
function reviewFrontendChanges(before,candidate,description){
 const bad=()=>fail("production_frontend_inventory_invalid");
 if(description.Status!=="CREATE_COMPLETE"||description.ExecutionStatus!=="AVAILABLE"||description.NextToken||description.IncludeNestedStacks||!Array.isArray(description.Changes))bad();
 const changed=Object.keys(candidate.Resources).filter(id=>!same(candidate.Resources[id],before.Resources[id]));if(!changed.length||description.Changes.length<changed.length)bad();
 const seen=new Set();
 for(const c of description.Changes){const r=c.ResourceChange,id=r?.LogicalResourceId,b=before.Resources[id],a=candidate.Resources[id];
  if(c.Type!=="Resource"||!a||seen.has(id)||r.ResourceType!==a.Type||r.Scope?.some(s=>s!=="Properties")||r.Details?.some(d=>d.Target?.Attribute!==undefined&&d.Target.Attribute!=="Properties"))bad();
  if(changed.includes(id)){
   if(r.Action!==(b?"Modify":"Add")||![undefined,"False"].includes(r.Replacement))bad();
  }else{
   // Exact unchanged native reference dependencies only, never a blanket
   // exception for Conditional replacement or arbitrary property drift.
   if(!same(a,b)||r.Action!=="Modify"||!["AWS::Lambda::Url","AWS::Lambda::Permission"].includes(a.Type)||!["False","Conditional"].includes(r.Replacement)||!r.Details?.length)bad();
   for(const d of r.Details){
    const source=String(d.CausingEntity||"").split(".")[0];
    if(d.Evaluation!=="Dynamic"||d.ChangeSource!=="ResourceReference"||!changed.includes(source)||!["FunctionName","TargetFunctionArn","SourceArn"].includes(d.Target?.Name)||!["Conditionally","Never"].includes(d.Target?.RequiresRecreation))bad();
    const direct=candidate.Resources[source],old=before.Resources[source];
    if(!old||!(direct.Type==="AWS::Lambda::Function"&&direct.Properties.FunctionName===old.Properties.FunctionName||direct.Type==="AWS::CloudFront::Distribution"&&same(direct.Properties.DistributionConfig.Aliases,old.Properties.DistributionConfig.Aliases)))bad();
   }
  }
  seen.add(id);
 }
 if(changed.some(id=>!seen.has(id)))bad();
 return description.Changes;
}
module.exports={ownedArtifactBucket,projectPrivateFrontdoor,projectPublicVisual,reviewFrontendChanges,privateResource,candidateHash:t=>sha(canonical(t))};
