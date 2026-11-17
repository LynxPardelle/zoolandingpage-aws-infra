"use strict";

function readPublicTestSsrInputs(env) {
  const { PUBLIC_SSR_ACTION: action, PUBLIC_SSR_CURRENT_RELEASE_ID: currentReleaseId,
    PUBLIC_SSR_RELEASE_ID: releaseId, PUBLIC_SSR_REVIEW_DIGEST: reviewDigest,
    PUBLIC_SSR_MANIFEST_SHA256: manifestSha256 } = env;
  if (![action, currentReleaseId, releaseId, reviewDigest, manifestSha256].some(Boolean)) return null;

  const releaseFormat = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (env.GITHUB_EVENT_NAME !== "workflow_dispatch" || env.GITHUB_REF !== "refs/heads/test"
    || !["review", "execute"].includes(action)
    || !releaseFormat.test(currentReleaseId || "") || !releaseFormat.test(releaseId || "")
    || currentReleaseId.includes("..") || releaseId.includes("..")
    || currentReleaseId === releaseId || env.FRONTEND_TEST_RELEASE_ID !== releaseId
    || env.ADMIN_INFRASTRUCTURE_APPROVED !== "false" || env.ADMIN_ROUTE_ASSOCIATION_APPROVED !== "false"
    || !/^[a-f0-9]{64}$/.test(manifestSha256 || "")
    || (action === "review" ? Boolean(reviewDigest) : !/^[a-f0-9]{64}$/.test(reviewDigest || ""))) {
    throw new Error("public_test_ssr_selection_invalid");
  }
  return { action, currentReleaseId, releaseId, reviewDigest, manifestSha256 };
}

if (require.main === module) {
  try {
    if (!readPublicTestSsrInputs(process.env)) throw new Error();
  } catch {
    process.stderr.write("public_test_ssr_selection_invalid\n");
    process.exitCode = 1;
  }
}

module.exports = { readPublicTestSsrInputs };
