import { beforeEach, describe, expect, it, vi } from "vitest";
const calls = vi.hoisted(() => ({ render: vi.fn(), feedback: vi.fn() }));
vi.mock("@tanstack/react-start/server-entry", () => ({ default: { fetch: calls.render } }));
vi.mock("~/canonical-url", () => ({ getCanonicalRedirect: () => null }));
vi.mock("~/docs", () => ({ getDoc: () => undefined }));
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

  // OTTO(plugins): canonical plugin URLs now serve the current Paseo API docs.
  it("serves current plugin docs through the router without a historical redirect", async () => {
    calls.render.mockResolvedValue(new Response("current guide"));
    const response = await entry.fetch(
      new Request("https://otto-code.me/docs/plugins/migration?from=old"),
      {},
      context,
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
    expect(calls.render).toHaveBeenCalledOnce();
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
    expect(calls.render).not.toHaveBeenCalled();
  });
});
