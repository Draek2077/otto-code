import { describe, expect, it } from "vitest";
import { connectorPrivateValues, redactConnectorJson } from "./redaction.js";

describe("Connector result redaction", () => {
  it("redacts keys and strings before JSON escaping, including quoted and newline-bearing credentials", () => {
    const secret = 'private"\nkey';
    expect(redactConnectorJson({ [secret]: { value: `Bearer ${secret}` } }, [secret])).toEqual({
      "[redacted]": { value: "Bearer [redacted]" },
    });
  });
  it("includes bearer payloads and endpoint query values without treating header names as secrets", () => {
    expect(
      connectorPrivateValues({
        type: "http",
        url: "https://fixture.invalid/mcp?api_key=query-secret",
        headers: { Authorization: "Bearer token-secret" },
      }),
    ).toEqual(expect.arrayContaining(["Bearer token-secret", "token-secret", "query-secret"]));
  });
  it("fails closed for cycles and non-JSON outputs", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => redactConnectorJson(cyclic, [])).toThrow("non-JSON");
    expect(() => redactConnectorJson(undefined, [])).toThrow("non-JSON");
  });
  it("bounds result size and nested traversal", () => {
    expect(() => redactConnectorJson("x".repeat(2 * 1024 * 1024), [])).toThrow("too large");
    let value: unknown = "leaf";
    for (let index = 0; index < 34; index++) value = { child: value };
    expect(() => redactConnectorJson(value, [])).toThrow("overly complex");
  });
});
