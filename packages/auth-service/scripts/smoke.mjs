// Local Cloudflare runtime proof. Only synthetic grants; all external network is denied.
import { fileURLToPath } from "node:url";
import { Miniflare, createFetchMock } from "miniflare";
import { createHash, randomBytes } from "node:crypto";
import assert from "node:assert/strict";
const vendor = createFetchMock();
const vendorId = process.argv[2] ?? "box";
assert.ok(["box", "hubspot"].includes(vendorId));
const hubspot = vendorId === "hubspot";
const tokenOrigin = hubspot ? "https://mcp.hubspot.com" : "https://api.box.com";
const tokenPath = hubspot ? "/oauth/v3/token" : "/oauth2/token";
const scopes = hubspot ? { scopes: ["crm.objects.contacts.read"] } : {};
vendor.disableNetConnect();
vendor
  .get(tokenOrigin)
  .intercept({ path: tokenPath, method: "POST" })
  .reply(200, {
    access_token: "fixture-access",
    refresh_token: "fixture-refresh",
    token_type: "Bearer",
    expires_in: 3600,
    ...scopes,
  });
vendor
  .get(tokenOrigin)
  .intercept({ path: tokenPath, method: "POST" })
  .reply(200, {
    access_token: "fixture-renewed",
    refresh_token: "fixture-rotated",
    token_type: "Bearer",
    expires_in: 3600,
    ...scopes,
  });
vendor
  .get(hubspot ? "https://api.hubapi.com" : "https://api.box.com")
  .intercept({ path: hubspot ? "/oauth/2026-09/token/revoke" : "/oauth2/revoke", method: "POST" })
  .reply(200, "");
const runtime = new Miniflare({
  modules: true,
  scriptPath: fileURLToPath(new URL("../dist/worker.js", import.meta.url)),
  compatibilityDate: "2026-05-01",
  host: "127.0.0.1",
  port: 0,
  durableObjects: { GRANTS: { className: "AuthGrant", useSQLite: true } },
  ratelimits: { REQUEST_LIMITER: { simple: { limit: 120, period: 60 } } },
  bindings: {
    PUBLIC_ORIGIN: "https://auth.example",
    BOX_CLIENT_ID: "fixture-client",
    BOX_CLIENT_SECRET: "fixture-publisher",
    HUBSPOT_CLIENT_ID: "fixture-hubspot-client",
    HUBSPOT_CLIENT_SECRET: "fixture-hubspot-publisher",
  },
  fetchMock: vendor,
});
const proof = randomBytes(32).toString("base64url");
const call = (path, init = {}) =>
  runtime.dispatchFetch("https://auth.example" + path, { ...init, redirect: "manual" });
try {
  const start = await call("/v1/grants", {
    method: "POST",
    body: JSON.stringify({
      vendorId,
      proofHash: createHash("sha256").update(proof).digest("base64url"),
    }),
  });
  assert.equal(start.status, 201);
  const { grantId, authorizationUrl } = await start.json();
  const consent = await call(new URL(authorizationUrl).pathname);
  const html = await consent.text();
  const state = /action="\?state=([\w-]+)"/.exec(html)[1];
  const authorize = await call(`/v1/grants/${grantId}/authorize?state=${state}`, {
    method: "POST",
    headers: { origin: "https://auth.example" },
  });
  assert.equal(authorize.status, 303);
  const oauth = new URL(authorize.headers.get("location"));
  assert.equal(oauth.origin, hubspot ? "https://mcp.hubspot.com" : "https://account.box.com");
  assert.equal(oauth.searchParams.get("code_challenge_method"), "S256");
  assert.equal(oauth.searchParams.has("scope"), !hubspot);
  assert.equal(oauth.searchParams.get("redirect_uri"), "https://auth.example/v1/callback");
  const callback = await call(
    "/v1/callback?" +
      new URLSearchParams({ state: oauth.searchParams.get("state"), code: "fixture-code" }),
  );
  assert.equal(callback.status, 200);
  const request = { method: "POST", headers: { authorization: `Bearer ${proof}` } };
  const collected = await call(`/v1/grants/${grantId}/collect`, request);
  assert.equal(collected.status, 200);
  const tokens = (await collected.json()).tokens;
  assert.equal(tokens.accessToken, "fixture-access");
  if (hubspot) assert.deepEqual(tokens.scopes, scopes.scopes);
  assert.equal((await call(`/v1/grants/${grantId}/collect`, request)).status, 409);
  const refreshed = await call(`/v1/grants/${grantId}/refresh`, {
    ...request,
    body: JSON.stringify({ refreshToken: "fixture-refresh" }),
  });
  assert.equal(refreshed.status, 200);
  assert.equal((await refreshed.json()).tokens.refreshToken, "fixture-rotated");
  const revoked = await call(`/v1/grants/${grantId}/revoke`, {
    ...request,
    body: JSON.stringify({ refreshToken: "fixture-rotated" }),
  });
  assert.equal(revoked.status, 200);
  assert.equal((await call(`/v1/grants/${grantId}/collect`, request)).status, 410);
  vendor.assertNoPendingInterceptors();
  console.log(
    `Cloudflare local runtime (${vendorId}): consent, PKCE callback, collection, replay rejection, rotation, revocation passed. Synthetic vendor only.`,
  );
} finally {
  await runtime.dispose();
}
