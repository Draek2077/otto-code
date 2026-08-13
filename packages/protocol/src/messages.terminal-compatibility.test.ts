import { describe, expect, it } from "vitest";
import { SessionInboundMessageSchema, SessionOutboundMessageSchema } from "./messages.js";

describe("terminal compatibility diagnostic messages", () => {
  it("accepts the dotted request and response pair", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "terminal.compatibility.diagnostic.request",
      requestId: "request-1",
    });
    const response = SessionOutboundMessageSchema.parse({
      type: "terminal.compatibility.diagnostic.response",
      payload: {
        requestId: "request-1",
        success: true,
        error: null,
        generatedAt: "2026-08-12T00:00:00.000Z",
        platform: "win32",
        term: "xterm-256color",
        termProgram: "kitty",
        checks: [
          {
            id: "kitty-compatibility",
            label: "Kitty compatibility",
            status: "unknown",
            detail: "TERM_PROGRAM is not evidence.",
          },
        ],
      },
    });

    expect(request.type).toBe("terminal.compatibility.diagnostic.request");
    expect(response.type).toBe("terminal.compatibility.diagnostic.response");
  });

  it("preserves embedded terminal presentation through creation and listing", () => {
    const request = SessionInboundMessageSchema.parse({
      type: "create_terminal_request",
      cwd: "C:/repo",
      workspaceId: "workspace-1",
      presentation: "embedded",
      requestId: "request-2",
    });
    const response = SessionOutboundMessageSchema.parse({
      type: "create_terminal_response",
      payload: {
        requestId: "request-2",
        error: null,
        terminal: {
          id: "terminal-1",
          name: "Vim: file.ts",
          cwd: "C:/repo",
          workspaceId: "workspace-1",
          presentation: "embedded",
          activity: null,
        },
      },
    });

    expect(request.presentation).toBe("embedded");
    expect(response.payload.terminal?.presentation).toBe("embedded");
  });
});
