# Production Hub generated EventBridge rule names

The Hub state execution on 2026-09-29 rolled back when the CloudFormation execution role could not call `events:DescribeRule` for a generated rule. The retained production stack returned to its 17 original resource identities. Three new tables and one empty bucket remained outside the stack under `Retain`; cleanup requires a separate inventory and authorization.

The identity manifest had allowed ARN patterns using the full stack and logical IDs. CloudFormation generated a 64-character rule name using the first 25 characters of each ID and a 12-character suffix. The TEST stack's three rule names and the failed production event agree on this shape.

The manifest now uses those exact three prefixes in its resource requirements, permission proof matrix, and managed policies. A test checks all three prefixes and the observed production name. Before another Hub review, deploy these identity grants through the protected review and execute process, then simulate all EventBridge actions against three concrete generated ARN examples using the live CloudFormation role.
