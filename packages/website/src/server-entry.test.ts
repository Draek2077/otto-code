import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ render: vi.fn(), feedback: vi.fn(), redirect: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: calls.render } }));
vi.mock("~/canonical-url", () => ({ getCanonicalRedirect: () => null }));
vi.mock("~/docs", () => ({ getDoc: () => undefined, getLegacyDocsRedirect: calls.redirect }));
vi.mock("~/feedback-intake", () => ({
  FEEDBACK_INTAKE_PATH: "/api/feedback",
  handleFeedbackRequest: calls.feedback,
}));
vi.mock("~/latest-release", () => ({ getLatestAndroidVersion: vi.fn() }));
vi.mock("~/llms", () => ({ buildLlmsTxt: () => "Otto" }));
import entry from "./server-entry";

const context = {
  waitUntil: vi.fn(),
  passThroughOnException: vi.fn(),
} as unknown as ExecutionContext;
beforeEach(() => {
  vi.resetAllMocks();
});

describe("SSR platform and documentation response contracts", () => {
  it.each([undefined, "Accept-Encoding", "USER-AGENT, Accept-Encoding", "*"])(
    "prevents shared platform caching while retaining existing Vary=%s",
    async (vary) => {
      const headers = new Headers({
        "content-type": "text/html",
        "cache-control": "public, max-age=3600",
      });
      if (vary) headers.set("vary", vary);
      calls.render.mockResolvedValue(new Response("page", { headers }));
      const response = await entry.fetch(new Request("https://otto-code.me/"), {}, context);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
      let expectedVary = "user-agent";
      if (vary === "*" || vary?.startsWith("USER-AGENT")) expectedVary = vary;
      else if (vary) expectedVary = `${vary}, user-agent`;
      expect(response.headers.get("vary")).toBe(expectedVary);

      expect(await response.text()).toBe("page");
    },
  );

  it("protects platform-bearing server-function JSON as well as HTML", async () => {
    calls.render.mockResolvedValue(Response.json({ platform: "android" }));
    const response = await entry.fetch(
      new Request("https://otto-code.me/_serverFn/platform"),
      {},
      context,
    );
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("vary")).toBe("user-agent");
  });

  it("redirects legacy versioned plugin docs and preserves query parameters", async () => {
    calls.redirect.mockReturnValue("/docs/plugins/v0.8/migration");
    const response = await entry.fetch(
      new Request("https://otto-code.me/docs/plugins/migration?from=old"),
      {},
      context,
    );
    expect(response.status).toBe(301);
    expect(response.headers.get("location")).toBe(
      "https://otto-code.me/docs/plugins/v0.8/migration?from=old",
    );
    expect(calls.render).not.toHaveBeenCalled();
  });

  it("keeps Otto feedback intake ahead of document and SSR routing", async () => {
    const accepted = new Response("accepted", { status: 202 });
    calls.feedback.mockResolvedValue(accepted);
    const request = new Request("https://otto-code.me/api/feedback", {
      method: "POST",
      body: "report",
    });
    expect(await entry.fetch(request, {}, context)).toBe(accepted);
    expect(calls.feedback).toHaveBeenCalledExactlyOnceWith(request);
    expect(calls.redirect).not.toHaveBeenCalled();
    expect(calls.render).not.toHaveBeenCalled();
  });
});
