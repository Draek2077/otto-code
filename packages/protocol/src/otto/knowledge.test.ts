import { expect, it } from "vitest";
import { ServerInfoStatusPayloadSchema } from "../messages.js";

it("accepts old daemon snapshots with no Knowledge capability instead of inventing support", () => {
  const minimal = { status: "server_info", serverId: "legacy-host" };
  expect(ServerInfoStatusPayloadSchema.parse(minimal).features).toBeUndefined();
  const old = ServerInfoStatusPayloadSchema.parse({
    ...minimal,
    features: { pluginSettings: true },
  });
  expect(old.features?.ottoKnowledge).toBeUndefined();
});

it("keeps snapshots with the additive Knowledge capability parseable by the prior feature shape", () => {
  const oldFeatures = ServerInfoStatusPayloadSchema.in.shape.features
    .unwrap()
    .omit({ ottoKnowledge: true });
  const prior = ServerInfoStatusPayloadSchema.in.extend({ features: oldFeatures.optional() });
  const snapshot = {
    status: "server_info",
    serverId: "updated-host",
    features: { pluginSettings: true, ottoKnowledge: true },
  };
  expect(prior.parse(snapshot).features?.pluginSettings).toBe(true);
  expect(ServerInfoStatusPayloadSchema.parse(snapshot).features?.ottoKnowledge).toBe(true);
  expect(
    ServerInfoStatusPayloadSchema.parse({ ...snapshot, features: { ottoKnowledge: false } })
      .features?.ottoKnowledge,
  ).toBe(false);
});
