# Service repository deployment identities

`ServiceRepositoryBootstrapStack` creates retained deployment identities for these repositories:

- `LynxPardelle/zoolanding-data-spaces`
- `LynxPardelle/zoolanding-commerce`
- `LynxPardelle/zoolanding-integrations`
- `LynxPardelle/zoolanding-notifications`

Each `test` or `production` stage contains one independent bootstrap stack. It does not create or modify service application resources. Each service receives:

- one GitHub OIDC role for its exact repository, GitHub Environment, and branch ref;
- one CloudFormation execution role trusted only by `cloudformation.amazonaws.com`;
- one output for each role ARN.

Both roles use `DeletionPolicy: Retain` and `UpdateReplacePolicy: Retain`. Deployment identities use the disjoint `zoolanding-deployer-*` prefix, so the CloudFormation execution role's application-role prefix cannot match or modify either deployment identity.

## Independent CDK targets

| Environment | CDK target | CloudFormation stack |
| --- | --- | --- |
| test | `ZoolandingTest/Zoolandingpage-test-ServiceRepositoryBootstrap` | `ZoolandingTest-Zoolandingpage-test-ServiceRepositoryBootstrap` |
| production | `ZoolandingProduction/Zoolandingpage-production-ServiceRepositoryBootstrap` | `ZoolandingProduction-Zoolandingpage-production-ServiceRepositoryBootstrap` |

Use the configured local profile `ADMIN-AIM-CLI`. On this Windows host, Node must use the Windows trust store; do not disable TLS verification.

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npx cdk synth "ZoolandingTest/Zoolandingpage-test-ServiceRepositoryBootstrap"
npx cdk diff --no-change-set --profile ADMIN-AIM-CLI "ZoolandingTest/Zoolandingpage-test-ServiceRepositoryBootstrap"
npx cdk deploy --profile ADMIN-AIM-CLI "ZoolandingTest/Zoolandingpage-test-ServiceRepositoryBootstrap"
```

Promote and validate test before production, then use the production target:

```powershell
$env:NODE_OPTIONS = "--use-system-ca"
npx cdk synth "ZoolandingProduction/Zoolandingpage-production-ServiceRepositoryBootstrap"
npx cdk diff --no-change-set --profile ADMIN-AIM-CLI "ZoolandingProduction/Zoolandingpage-production-ServiceRepositoryBootstrap"
npx cdk deploy --profile ADMIN-AIM-CLI "ZoolandingProduction/Zoolandingpage-production-ServiceRepositoryBootstrap"
```

These deploy commands are operator instructions. Repository validation must not run them automatically.

## Outputs and GitHub Environment variables

Copy each repository's output pair into its protected `test` or `production` GitHub Environment:

| Repository | `AWS_ROLE_ARN` output | `AWS_CLOUDFORMATION_ROLE_ARN` output |
| --- | --- | --- |
| `zoolanding-data-spaces` | `DataSpacesGithubDeployRoleArn` | `DataSpacesCloudFormationExecutionRoleArn` |
| `zoolanding-commerce` | `CommerceGithubDeployRoleArn` | `CommerceCloudFormationExecutionRoleArn` |
| `zoolanding-integrations` | `IntegrationsGithubDeployRoleArn` | `IntegrationsCloudFormationExecutionRoleArn` |
| `zoolanding-notifications` | `NotificationsGithubDeployRoleArn` | `NotificationsCloudFormationExecutionRoleArn` |

Role ARNs are deterministic. Replace `{environment}` with `test` or `production`:

```text
arn:aws:iam::765932874577:role/zoolanding-deployer-data-spaces-{environment}-github-deploy
arn:aws:iam::765932874577:role/zoolanding-deployer-data-spaces-{environment}-cfn-exec
arn:aws:iam::765932874577:role/zoolanding-deployer-commerce-{environment}-github-deploy
arn:aws:iam::765932874577:role/zoolanding-deployer-commerce-{environment}-cfn-exec
arn:aws:iam::765932874577:role/zoolanding-deployer-integrations-{environment}-github-deploy
arn:aws:iam::765932874577:role/zoolanding-deployer-integrations-{environment}-cfn-exec
arn:aws:iam::765932874577:role/zoolanding-deployer-notifications-{environment}-github-deploy
arn:aws:iam::765932874577:role/zoolanding-deployer-notifications-{environment}-cfn-exec
```

## Scope contract

GitHub OIDC trust uses three exact `StringEquals` conditions:

- audience: `sts.amazonaws.com`;
- subject: `repo:LynxPardelle/{repository}:environment:{environment}`;
- ref: `refs/heads/test` for `test`, or `refs/heads/main` for `production`.

The GitHub role can operate only its exact SAM stack, exact CloudFormation execution role, exact managed SAM bucket, service-specific artifact prefix, and literal non-secret SSM validation parameters. The managed bucket is `aws-sam-cli-managed-default-samclisourcebucket-obthkeitxden`; each artifact prefix equals the SAM stack name.

The CloudFormation role can fetch only that service's SAM artifacts, resolve only the literal SSM inputs used by its template, manage only the literal SSM outputs published by its template, and operate only AWS resource families present after SAM transformation. IAM roles and policies are restricted to service- and stage-specific generated prefixes. No role receives `AdministratorAccess`, Secrets Manager actions, application data reads/writes, or a wildcard repository/ref trust.

## Unavoidable scoped wildcards

Four AWS APIs cannot be narrowed to a future exact ARN before CloudFormation creates the resource:

| Permission | Why it cannot be exact | Compensating scope |
| --- | --- | --- |
| `sts:GetCallerIdentity` on `*` | STS does not support resource-level authorization for this action. | GitHub role only; no mutation. |
| `logs:DescribeLogGroups` on `*` | CloudWatch Logs does not support resource-level authorization for this list action. | Only services with explicit log-group resources. |
| Lambda event-source mapping CRUD on `*` | Mapping UUID is generated by Lambda. | `lambda:FunctionArn` must match the service stack's function prefix. |
| API Gateway `/restapis/*` | REST API IDs are generated by API Gateway. | Only API Gateway CRUD verbs; no literal account-wide `*`, and only services whose templates contain `AWS::Serverless::Api`. |

CloudFormation truncates generated physical names when a stack name plus logical ID would exceed the target service's name limit. Policies therefore include the full stack prefix plus only the observed CloudFormation truncation prefix needed by that service. The IAM-role fallbacks remain stage-distinct: Data Spaces ends in `-te` or `-pr`, Commerce in `-test` or `-produ`, Integrations in `-t` or `-p`, and Notifications in `-tes` or `-pro`. Lambda, SQS, and EventBridge fallbacks follow the same stage-distinct rule only where their name limits require it. Managed policies retain the full stack prefix. None can match the disjoint `zoolanding-deployer-*` identities.
