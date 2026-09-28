"use strict";

const cdk = require("aws-cdk-lib");
const { FrontendStack } = require("./stacks/frontend-stack");
const { ServiceRepositoryBootstrapStack } = require("./stacks/service-repository-bootstrap-stack");

class ZoolandingpageEnvironmentStage extends cdk.Stage {
  constructor(scope, id, props) {
    super(scope, id, props);

    const { environment } = props;
    const stackProps = {
      env: props.env,
      environment,
      description: `Zoolandingpage serverless frontend ${environment.name} environment scaffold.`,
    };

    new FrontendStack(this, `Zoolandingpage-${environment.name}-Frontend`, stackProps);
    new ServiceRepositoryBootstrapStack(
      this,
      `Zoolandingpage-${environment.name}-ServiceRepositoryBootstrap`,
      {
        ...stackProps,
        description: `Zoolandingpage bounded service repository deployment identities for ${environment.name}.`,
      }
    );
  }
}

module.exports = {
  ZoolandingpageEnvironmentStage,
};

