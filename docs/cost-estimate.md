# Cost Estimate

Prepared 2026-07-09 CT. Prices below came from AWS Pricing API with profile `ADMIN-AIM-CLI`, except the CloudFront flat-rate allowance noted from the public AWS CloudFront pricing page.

## Current EC2 List-Rate Baseline

Verified EC2 inventory for `LynxServer`:

- Instance: `t3.medium`.
- Region: `us-east-1`.
- EBS: 120 GB `gp3`.
- Public IPv4: one in-use address.

List-rate estimate:

- EC2 compute: `0.0416 USD/hour * 730 hours = 30.37 USD/month`.
- EBS gp3 storage: `0.08 USD/GB-month * 120 GB = 9.60 USD/month`.
- Public IPv4: `0.005 USD/hour * 730 hours = 3.65 USD/month`.
- Baseline total: `43.62 USD/month`, before snapshots, data transfer, CloudWatch, tax, support, or discounts.

Cost Explorer did not return usable current EC2 spend during inspection, so this is list-rate, not billed spend.

## Serverless Frontend Estimate

This stack has no always-on EC2 instance.

Measured local release artifact:

- Browser files: 121.04 MB.
- SSR zip: 104.50 MB.
- Total stored per release copy: 225.54 MB.

Verified unit prices:

- S3 Standard first 50 TB: `0.023 USD/GB-month`.
- Lambda duration tier 1 in us-east-1: `0.0000166667 USD/GB-second`.
- CloudFront HTTPS GET/HEAD requests in the United States: `0.0100 USD / 10,000 requests`.
- CloudFront HTTP GET/HEAD requests in the United States: `0.0075 USD / 10,000 requests`.

Example formulas:

- S3 artifact storage: `0.22554 GB * release copies * 0.023`.
- Lambda SSR at 512 MB: `requests * avg_duration_seconds * 0.5 GB * 0.0000166667`.
- CloudFront requests: `https_get_head_requests / 10000 * 0.0100`.

Example with 1M SSR requests/month at 300 ms average:

- Lambda duration: `1,000,000 * 0.3 * 0.5 * 0.0000166667 = 2.50 USD`.
- CloudFront HTTPS requests: `1,000,000 / 10,000 * 0.0100 = 1.00 USD`.
- S3 storage for 10 retained releases: `0.22554 * 10 * 0.023 = 0.05 USD`.
- Estimated subtotal: `3.55 USD/month`, plus data transfer and any request/free-tier effects.

CloudFront public pricing page currently shows a Free flat-rate plan at `0 USD/month` with `1M` requests and `100GB` data transfer allowance per distribution. This CDK stack does not explicitly configure a CloudFront pricing plan; confirm the distribution billing mode during deployment before treating that allowance as guaranteed.

