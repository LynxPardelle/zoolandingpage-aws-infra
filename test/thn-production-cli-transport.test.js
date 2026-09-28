"use strict";
const assert=require('node:assert/strict'),path=require('node:path'),test=require('node:test');
const {buildAwsCliArguments}=require('../tools/thn-production-certificate-release');

test('streaming GetObject uses required CLI flags and preserves its exact version and owner',()=>{
 const output=path.resolve('private-readback.json');
 const args=buildAwsCliArguments('s3api','get-object',{
  Bucket:'cdk-hnb659fds-assets-765932874577-us-east-1',Key:'thn-production/example.json',
  VersionId:'-exact-version',ExpectedBucketOwner:'765932874577',
 },path.resolve('input.json'),output,[]);
 assert.equal(args.includes('--cli-input-json'),false,'the custom streaming command does not accept CLI JSON');
 for(const flag of ['--bucket=cdk-hnb659fds-assets-765932874577-us-east-1','--key=thn-production/example.json','--version-id=-exact-version','--expected-bucket-owner=765932874577'])assert.ok(args.includes(flag));
 assert.equal(args.at(-1),output);
});

test('streaming GetObject fails closed on unknown fields, a missing owner or a relative output path',()=>{
 const input={Bucket:'bucket',Key:'key',ExpectedBucketOwner:'765932874577'},output=path.resolve('readback.json');
 for(const bad of [{...input,Unknown:'value'},{Bucket:'bucket',Key:'key'},{...input,ExpectedBucketOwner:'000000000000'},{...input,VersionId:''}]){
  assert.throws(()=>buildAwsCliArguments('s3api','get-object',bad,'request.json',output,[]),/production_cli_input_invalid/);
 }
 assert.throws(()=>buildAwsCliArguments('s3api','get-object',input,'request.json','relative.json',[]),/production_cli_input_invalid/);
});

test('ordinary API operations retain their private CLI JSON transport',()=>{
 const args=buildAwsCliArguments('cloudformation','get-template',{StackName:'reviewed-stack'},'request.json',undefined,[]);
 assert.deepEqual(args,['cloudformation','get-template','--cli-input-json','file://request.json','--region','us-east-1','--output','json','--no-cli-pager']);
});

test('public unversioned reads omit the version flag while retaining the expected owner',()=>{
 const args=buildAwsCliArguments('s3api','get-object',{Bucket:'zoolandingpage-public-files',Key:'frontend/file.js',ExpectedBucketOwner:'765932874577'},'request.json',path.resolve('public-readback.js'),[]);
 assert.equal(args.some(a=>a.startsWith('--version-id')),false);
 assert.ok(args.includes('--expected-bucket-owner=765932874577'));
 assert.equal(args.includes('--cli-input-json'),false);
});
