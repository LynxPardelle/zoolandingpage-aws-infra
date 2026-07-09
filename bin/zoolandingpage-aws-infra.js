#!/usr/bin/env node
"use strict";

const cdk = require("aws-cdk-lib");
const { ZoolandingpageEnvironmentStage } = require("../lib/zoolandingpage-environment-stage");
const { environments } = require("../config/environments");

const app = new cdk.App();

for (const environment of environments) {
  new ZoolandingpageEnvironmentStage(app, environment.stageId, {
    environment,
    env: {
      account: environment.account,
      region: environment.region,
    },
  });
}

