"use strict";

const cdk = require("aws-cdk-lib");
const { ServiceRepositoryBootstrapStack } = require("../lib/stacks/service-repository-bootstrap-stack");
const { environments } = require("../config/environments");
const { deriveAuthority, validateAuthority } = require("./thn-test-prerequisites");

const logicalIds = [
  "ThnDedicatedRuntimeTestCloudFormationRoleCF799F56",
  "ThnDedicatedRuntimeTestGithubPolicy",
  "ThnDedicatedRuntimeTestExecutionPolicy",
];

function candidate() {
  const environment = environments.find(entry => entry.name === "test");
  if (!environment) throw new Error("thn_dedicated_identity_candidate_invalid");
  const app = new cdk.App();
  const stack = new ServiceRepositoryBootstrapStack(app, "DedicatedIdentityCandidate", {
    env: { account: environment.account, region: environment.region }, environment,
  });
  const template = cdk.assertions.Template.fromStack(stack).toJSON();
  const names = Object.keys(template.Resources).filter(name => name.startsWith("ThnDedicatedRuntime"));
  if (JSON.stringify(names.sort()) !== JSON.stringify([...logicalIds].sort())) {
    throw new Error("thn_dedicated_identity_candidate_invalid");
  }
  const additions = Object.fromEntries(logicalIds.map(name => [name, template.Resources[name]]));
  const authority = deriveAuthority("operator-role");
  validateAuthority(authority, "operator-role", { account: environment.account });
  return { additions, authority };
}

if (require.main === module) process.stdout.write(JSON.stringify(candidate()) + "\n");

module.exports = { candidate };
