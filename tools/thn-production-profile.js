"use strict";

// Only the deployment owner chooses an environment. Neither a browser request
// nor a descriptor is an environment selector. Existing TEST tools stay TEST-only.
const profiles = Object.freeze(Object.fromEntries(["test", "production"].map(environment => [environment,
  Object.freeze({environment, account:"765932874577", region:"us-east-1",
    branch: environment === "test" ? "test" : "main",
    adminHost: environment === "test" ? "admin-test.thehairnarrative.com" : "admin.thehairnarrative.com",
    publicHost: environment === "test" ? "test.zoolandingpage.com.mx" : "thehairnarrative.com",
    bindingId: `thn-journal-${environment}-v2`,
    stackName: environment === "test" ? "ZoolandingTest-Zoolandingpage-test-Frontend" : "ZoolandingProduction-Zoolandingpage-production-Frontend",
    securityProfile: `thn-admin-${environment}`})])));
function deploymentProfile(environment) {
  if (typeof environment !== "string" || !Object.hasOwn(profiles,environment)) throw new Error("thn_deployment_profile_invalid");
  return profiles[environment];
}
function validateEnvironmentSelection(environment, selection) {
  const expected=deploymentProfile(environment);
  if (selection?.metadata?.environment !== expected.environment || selection?.manifest?.environment !== expected.environment
      || !selection.originPrefix?.startsWith(`frontend/angular-ssr/${expected.environment}/releases/`)) throw new Error("thn_private_environment_mismatch");
  return selection;
}
module.exports={deploymentProfile,validateEnvironmentSelection};
