import { describe, expect, it, vi } from "vitest";
import { requestProviderDiagnostic } from "./provider-diagnostic.js";

const threadId = "01a14152-e1ac-72f4-9565-0978e4520014";
describe("provider diagnostic capability boundary", () => {
  it("preserves legacy requests, timeouts and output on older hosts", async () => {
    const response = { provider: "codex", diagnostic: "old text", requestId: "r" };
    const send = vi.fn(async () => response);
    expect(await requestProviderDiagnostic(false, "codex", { requestId: "r" }, send)).toBe(
      response,
    );
    expect(send).toHaveBeenCalledWith({
      requestId: "r",
      message: { type: "provider_diagnostic_request", provider: "codex" },
      responseType: "provider_diagnostic_response",
      timeout: 180_000,
    });
  });
  it("rejects missing capability without falling back to a legacy RPC", () => {
    const send = vi.fn();
    expect(() =>
      requestProviderDiagnostic(false, "codex", { discovery: { threadId } }, send),
    ).toThrow("Update the host");
    expect(send).not.toHaveBeenCalled();
  });
  it("validates and sends the opt-in request with a bounded timeout", async () => {
    const send = vi.fn(async (_params: unknown) => ({
      provider: "codex",
      diagnostic: "",
      requestId: "r",
    }));
    await requestProviderDiagnostic(true, "codex", { discovery: { threadId } }, send);
    expect(send.mock.calls[0]?.[0]).toEqual({
      requestId: undefined,
      message: { type: "provider_diagnostic_request", provider: "codex", discovery: { threadId } },
      responseType: "provider_diagnostic_response",
      timeout: 20_000,
    });
    expect(() =>
      requestProviderDiagnostic(true, "codex", { discovery: { threadId: "bad" } }, send),
    ).toThrow();
  });
});
