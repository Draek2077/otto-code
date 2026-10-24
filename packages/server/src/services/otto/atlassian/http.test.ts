import { expect, it } from "vitest";
import {
  atlassianApiBase,
  normalizeAtlassianSite,
  readLegacyAtlassian,
  type AtlassianCredential,
} from "./credentials.js";
import { createAtlassianHttp } from "./http.js";

const credential: AtlassianCredential = {
  revision: "account-1",
  email: "fixture@example.test",
  apiToken: "fixture-secret",
  siteUrl: "https://fixture.atlassian.net",
  route: { kind: "site" },
};
function fixture(account = credential) {
  const calls: Array<{ url: string; options: RequestInit | undefined }> = [];
  const response = {
    get: async (): Promise<Response> => new Response(JSON.stringify({ ok: true }), { status: 200 }),
  };
  const fetch: typeof globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return response.get();
  };
  return { calls, response, http: createAtlassianHttp({ credential: account, fetch }) };
}
it("normalizes actual Cloud site inputs and rejects credential-bearing or unrelated origins", () => {
  expect(normalizeAtlassianSite("fixture")).toBe("https://fixture.atlassian.net");
  expect(normalizeAtlassianSite("fixture.atlassian.net/jira/software/projects/OTTO")).toBe(
    "https://fixture.atlassian.net",
  );
  expect(normalizeAtlassianSite("https://fixture.atlassian.net.evil.invalid")).toBeNull();
  expect(normalizeAtlassianSite("https://user:secret@fixture.atlassian.net")).toBeNull();
  expect(normalizeAtlassianSite("http://fixture.atlassian.net")).toBeNull();
});
it("retains both official API-token routes without interpreting scoped tokens as OAuth", () => {
  expect(atlassianApiBase(credential)).toBe("https://fixture.atlassian.net");
  expect(
    atlassianApiBase({ ...credential, route: { kind: "scoped", cloudId: "cloud-identity" } }),
  ).toBe("https://api.atlassian.com/ex/jira/cloud-identity");
  expect(
    atlassianApiBase({ ...credential, route: { kind: "scoped", cloudId: "../other" } }),
  ).toBeNull();
});
it("reads preserved accounts without combining credentials across identities or changing bytes", () => {
  const config = {
    gitHosting: {
      providers: {
        atlassian: { email: "fixture@example.test", apiToken: "old-token", jiraSiteUrl: "fixture" },
        future: { keep: true },
      },
    },
    unknown: ["keep"],
  };
  const bytes = JSON.stringify(config);
  expect(readLegacyAtlassian(config, "revision")).toEqual({
    revision: "revision",
    email: "fixture@example.test",
    apiToken: "old-token",
    siteUrl: "https://fixture.atlassian.net",
    route: { kind: "site" },
  });
  expect(JSON.stringify(config)).toBe(bytes);
  expect(
    readLegacyAtlassian(
      {
        gitHosting: {
          providers: {
            atlassian: { email: "new@example.test" },
            bitbucketCloud: { email: "old@example.test", apiToken: "old-token" },
          },
        },
      },
      "revision",
    ),
  ).toBeNull();
  expect(
    readLegacyAtlassian(
      {
        gitHosting: {
          providers: { bitbucketCloud: { email: "old@example.test", apiToken: "old-token" } },
        },
      },
      "revision",
    ),
  ).toMatchObject({ email: "old@example.test", siteUrl: "" });
});
it("is inert until requested and sends credentials only to the selected HTTPS API route", async () => {
  const f = fixture();
  expect(f.calls).toEqual([]);
  expect(await f.http.read("/rest/agile/1.0/board/42/configuration")).toEqual({
    ok: true,
    value: { ok: true },
  });
  expect(f.calls).toHaveLength(1);
  expect(f.calls[0]?.url).toBe(
    "https://fixture.atlassian.net/rest/agile/1.0/board/42/configuration",
  );
  expect(f.calls[0]?.options).toMatchObject({
    method: "GET",
    redirect: "manual",
    headers: {
      Authorization:
        "Basic " + Buffer.from("fixture@example.test:fixture-secret").toString("base64"),
    },
  });
  expect(f.calls[0]?.options?.signal).toBeInstanceOf(AbortSignal);
});
it("keeps the scoped gateway prefix for the same Basic credential method", async () => {
  const f = fixture({ ...credential, route: { kind: "scoped", cloudId: "cloud-identity" } });
  await f.http.read("/rest/api/3/myself");
  expect(f.calls[0]?.url).toBe(
    "https://api.atlassian.com/ex/jira/cloud-identity/rest/api/3/myself",
  );
});
it.each([
  "https://evil.invalid/rest/api/3/issue",
  "//evil.invalid/rest/api/3/issue",
  "/rest/api/3/../outside",
  "/rest/api/3/issue#secret",
])("refuses an unsafe endpoint before a request: %s", async (endpoint) => {
  const f = fixture();
  expect(await f.http.read(endpoint)).toMatchObject({
    ok: false,
    error: { code: "invalid_target" },
  });
  expect(await f.http.write("POST", endpoint, {})).toMatchObject({
    status: "rejected",
    error: { code: "invalid_target" },
  });
  expect(f.calls).toEqual([]);
});
it.each([
  [401, "auth_required"],
  [403, "access_denied"],
  [404, "not_found"],
  [429, "rate_limited"],
  [500, "unavailable"],
  [302, "access_denied"],
] as const)("reports HTTP %i safely without redirects or retries", async (status, code) => {
  const f = fixture();
  f.response.get = async () =>
    new Response("fixture-secret", { status, headers: { Location: "https://evil.invalid/" } });
  const result = await f.http.read("/rest/api/3/issue/OTTO-1");
  expect(result).toMatchObject({ ok: false, error: { code } });
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(f.calls).toHaveLength(1);
});
it("does not repeat a write or infer rejection from a lost response", async () => {
  const f = fixture();
  f.response.get = async () => {
    throw new Error("fixture-secret upstream details");
  };
  const result = await f.http.write("POST", "/rest/api/3/issue/OTTO-1/transitions", {
    transition: { id: "2" },
  });
  expect(result).toMatchObject({ status: "uncertain", error: { code: "unavailable" } });
  expect(JSON.stringify(result)).not.toContain("fixture-secret");
  expect(f.calls).toHaveLength(1);
});
it("handles a successful no-content update and an invalid body explicitly", async () => {
  const f = fixture();
  f.response.get = async () => new Response(null, { status: 204 });
  expect(
    await f.http.write("PUT", "/rest/api/3/issue/OTTO-1", { fields: { summary: "Updated" } }),
  ).toEqual({ status: "applied", value: null });
  f.response.get = async () => new Response("{partial", { status: 200 });
  expect(await f.http.read("/rest/api/3/issue/OTTO-1")).toMatchObject({
    ok: false,
    error: { code: "invalid_response" },
  });
});
it("bounds streamed responses instead of accepting a partial board", async () => {
  const f = fixture();
  const chunk = new Uint8Array(256 * 1024).fill(32);
  f.response.get = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (let index = 0; index < 42; index++) controller.enqueue(chunk);
          controller.close();
        },
      }),
    );
  expect(await f.http.read("/rest/agile/1.0/board/42/issue")).toMatchObject({
    ok: false,
    error: { code: "read_limit" },
  });
  expect(f.calls).toHaveLength(1);
});
