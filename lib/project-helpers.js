"use strict";

const cdk = require("aws-cdk-lib");

function applyZoolandingpageTags(scope, environment) {
  cdk.Tags.of(scope).add("Project", "zoolandingpage");
  cdk.Tags.of(scope).add("Environment", environment.name);
  cdk.Tags.of(scope).add("ManagedBy", "aws-cdk");
}

function buildResourceName(environment, service, resource) {
  return ["zoolandingpage", environment.name, service, resource].filter(Boolean).join("-");
}

function buildParameterName(environment, parameterPath) {
  const normalizedPath = parameterPath.replace(/^\/+/, "");
  return `/zoolandingpage/${environment.name}/${normalizedPath}`;
}

function removalPolicyForEnvironment(environment) {
  if (environment.removalPolicy === "retain") {
    return cdk.RemovalPolicy.RETAIN;
  }
  return cdk.RemovalPolicy.DESTROY;
}

function pascalId(value) {
  return String(value)
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((part) => `${part.charAt(0).toUpperCase()}${part.slice(1)}`)
    .join("");
}

module.exports = {
  applyZoolandingpageTags,
  buildParameterName,
  buildResourceName,
  pascalId,
  removalPolicyForEnvironment,
};

