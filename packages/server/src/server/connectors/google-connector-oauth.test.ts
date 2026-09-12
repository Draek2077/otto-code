import { expect, test } from "vitest";
import { ConnectorOAuthBroker } from "./connector-oauth.js";
import { createMemoryConnectorAuthStore } from "./connector-auth-store.js";

test("legacy client-credential requests cannot replace publisher-owned Google authorization", async () => {
  const store = createMemoryConnectorAuthStore();
  const broker = new ConnectorOAuthBroker({ store });
  await expect(
    broker.beginAuthorization({
      connector: {
        id: "gmail",
        server: { type: "http", url: "https://gmailmcp.googleapis.com/mcp/v1" },
      },
      oauthClient: { clientId: "caller-client", clientSecret: "caller-secret" },
    }),
  ).rejects.toThrow("User-supplied OAuth app credentials are no longer accepted");
  expect(store.read("gmail")).toBeUndefined();
  broker.closeAll();
});
