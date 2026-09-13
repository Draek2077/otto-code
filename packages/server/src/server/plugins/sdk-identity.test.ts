import { describe, expect, it } from "vitest";
import { createOttoApi } from "@otto-code/client";
import { DaemonClient } from "@otto-code/client/internal/daemon-client";
import { pluginApiContext, projectProviderInput, upstreamProviderRuntime } from "./sdk-identity.js";

describe("upstream plugin identity boundary", () => {
  it("shares one API object between author aliases", () => {
    const api = createOttoApi(
      new DaemonClient({ url: "ws://127.0.0.1:1/ws", clientId: "aliases" }),
    );
    const context = pluginApiContext(api);
    expect(context.otto).toBe(api);
    expect(context.paseo).toBe(api);
  });

  it.each([
    ["forge_change_request", "forge-change-request"],
    ["forge_issue", "forge-issue"],
    ["review", "review"],
  ])("translates only the %s attachment discriminator and preserves user text", (type, suffix) => {
    const content = [
      { type, mimeType: `application/otto-${suffix}`, title: "application/otto-review" },
      { type: "text", text: "application/otto-review" },
      { type: "uploaded_file", mimeType: "application/otto-review" },
    ];
    const original = { type: "session.prompt", prompt: { input: { type: "message", content } } };
    const projected = projectProviderInput(original, "paseo");
    expect(projected).toEqual({
      type: "session.prompt",
      prompt: {
        input: {
          type: "message",
          content: [
            { ...content[0], mimeType: `application/paseo-${suffix}` },
            content[1],
            content[2],
          ],
        },
      },
    });
    expect(projectProviderInput(projected, "otto")).toEqual(original);
    expect(original.prompt.input.content).toBe(content);
    expect(content[0].mimeType).toBe(`application/otto-${suffix}`);
  });

  it("keeps upstream schema callers in their namespace after canonical validation", () => {
    const input = {
      type: "session.prompt",
      sessionId: "session",
      prompt: {
        clientMessageId: "message",
        delivery: "auto",
        input: {
          type: "message",
          content: [
            {
              type: "forge_issue",
              mimeType: "application/paseo-forge-issue",
              number: 1,
              title: "Issue",
              url: "https://example.test/issue/1",
            },
          ],
        },
      },
    };
    expect(upstreamProviderRuntime.ProviderInputSchema.parse(input)).toEqual(input);
  });
});
