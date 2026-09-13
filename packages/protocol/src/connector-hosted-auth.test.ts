import { expect, test } from "vitest";
import { hostedConnectorVendor } from "./connector-hosted-auth.js";
import { ConnectorAuthStateSchema } from "./provider-config.js";

test("publisher authorization is bound to exact approved HTTP resources", () => {
  expect(hostedConnectorVendor({ server: { type: "http", url: "https://mcp.box.com" } })).toBe(
    "box",
  );
  expect(hostedConnectorVendor({ server: { type: "http", url: "https://mcp.box.com/" } })).toBe(
    "box",
  );
  for (const url of [
    "http://mcp.box.com",
    "https://mcp.box.com.attacker.test",
    "https://mcp.box.com@attacker.test",
    "https://mcp.box.com/?redirect=attacker",
    "https://mcp.box.com/other",
  ]) {
    expect(hostedConnectorVendor({ server: { type: "http", url } })).toBeNull();
  }
  expect(hostedConnectorVendor({ server: { type: "sse", url: "https://mcp.box.com" } })).toBeNull();
});

test("hosted projection remains optional and has no secret fields", () => {
  expect(ConnectorAuthStateSchema.parse({ kind: "oauth" })).toEqual({ kind: "oauth" });
  expect(
    ConnectorAuthStateSchema.parse({
      kind: "oauth",
      hosted: {
        vendorId: "box",
        connected: true,
        proof: "private",
        refreshToken: "private",
        scopes: ["root_readwrite"],
      },
    }),
  ).toEqual({
    kind: "oauth",
    hosted: { vendorId: "box", connected: true, scopes: ["root_readwrite"] },
  });
});
