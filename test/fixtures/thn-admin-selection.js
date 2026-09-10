"use strict";

const { createHash } = require("node:crypto");
const digest = value => createHash("sha256").update(value).digest("hex");
const bytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function fixture(paths = ["/browser/main-2ZPUOXRY.js"]) {
  const releaseId = "thn-admin-fixture-release";
  const sourceCommit = "a".repeat(40);
  const prefix = `frontend/angular-ssr/test/releases/${releaseId}`;
  const manifest = { version: 1, environment: "test", releaseId, staticAssetPaths: paths };
  const pagePaths = ["/admin/journal/access", "/admin/journal/mfa", "/admin/journal", "/admin/journal/new", "/admin/journal/:articleId/edit", "/admin/journal/:articleId/preview"];
  const backendMethods = {
    "/auth-v2/runtime-config": ["GET", "POST"],
    "/auth-v2/session/signin": ["POST"],
    "/auth-v2/session/challenge/respond": ["POST"],
    "/auth-v2/session/mfa/setup": ["POST"],
    "/auth-v2/session/mfa/verify": ["POST"],
    "/auth-v2/session/me": ["GET"],
    "/auth-v2/session/logout": ["POST"],
    "/features/content-hub-v2/read": ["POST"],
    "/features/content-hub-v2/action": ["POST"],
  };
  const routes = { version: 1, environment: "test", domain: "thehairnarrative.com", origins: {
    admin: { host: "admin-test.thehairnarrative.com", originRole: "protected-admin", defaultDecision: "deny",
      staticAssets: { mode: "selected-release-manifest-only" },
      pageRoutes: pagePaths.map(path => ({ path, methods: ["GET"] })),
      backendRoutes: Object.entries(backendMethods).map(([path, methods]) => ({ path, methods })),
    },
  } };
  const sourceManifest = { schemaVersion: 1, app: "zoolandingpage", environment: "test", releaseId, sourceCommit,
    browserPrefix: `${prefix}/browser`, serverBundleKey: `${prefix}/server/ssr-handler.zip`,
    checksums: { "server/ssr-handler.zip": digest("fixture zip") },
  };
  const objects = new Map([
    [`${prefix}/thn-admin-release.json`, bytes(manifest)],
    [`${prefix}/thn-route-manifest.json`, bytes(routes)],
    [`${prefix}/manifest.json`, bytes(sourceManifest)],
  ]);
  const files = [
    ...["manifest.json", "thn-admin-release.json", "thn-route-manifest.json"].map(path => ({ path, sha256: digest(objects.get(`${prefix}/${path}`)) })),
    { path: "ssr-handler.zip", sha256: sourceManifest.checksums["server/ssr-handler.zip"] },
    ...paths.map(path => ({ path: `staging${path}`, sha256: digest(`fixture ${path}`) })),
  ].sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const delivery = { schemaVersion: 1, environment: "test", releaseId, sourceCommit, runId: "123", runAttempt: "1",
    deployed: false, thnAdmin: { enabled: true, origin: "https://admin-test.thehairnarrative.com" }, files };
  const deliveryBytes = bytes(delivery);
  objects.set(`${prefix}/delivery.json`, deliveryBytes);
  const metadata = { schemaVersion: 1, environment: "test", releaseId, sourceCommit, runId: "123", runAttempt: "1",
    deliverySha256: digest(deliveryBytes), manifestSha256: digest(bytes(manifest)) };
  return { manifest, metadata, delivery, objects, prefix, inputs: {
    FRONTEND_TEST_THN_ADMIN_ORIGIN_ENABLED: "true",
    FRONTEND_TEST_THN_ADMIN_MANIFEST_BASE64: bytes(manifest).toString("base64"),
    FRONTEND_TEST_THN_ADMIN_RELEASE_METADATA_JSON: JSON.stringify(metadata),
  } };
}

module.exports = { fixture, digest, bytes };
