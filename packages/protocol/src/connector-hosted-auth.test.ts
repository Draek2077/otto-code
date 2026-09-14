import { expect, test } from "vitest";
import { hostedConnectorVendor } from "./connector-hosted-auth.js";
import { ConnectorAuthStateSchema } from "./provider-config.js";

test.each(["box", "hubspot"])(
  "%s authorization is bound to exact approved HTTP resources",
  (vendor) => {
    expect(
      hostedConnectorVendor({ server: { type: "http", url: `https://mcp.${vendor}.com` } }),
    ).toBe(vendor);
    expect(
      hostedConnectorVendor({ server: { type: "http", url: `https://mcp.${vendor}.com/` } }),
    ).toBe(vendor);
    for (const url of [
      `http://mcp.${vendor}.com`,
      `https://mcp.${vendor}.com.attacker.test`,
      `https://mcp.${vendor}.com@attacker.test`,
      `https://mcp.${vendor}.com/?redirect=attacker`,
      `https://mcp.${vendor}.com/other`,
    ]) {
      expect(hostedConnectorVendor({ server: { type: "http", url } })).toBeNull();
    }
    expect(
      hostedConnectorVendor({ server: { type: "sse", url: `https://mcp.${vendor}.com` } }),
    ).toBeNull();
  },
);

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
