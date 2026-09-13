import { describe, expect, test } from "vitest";

import { MutableDaemonConfigPatchSchema, MutableDaemonConfigSchema } from "./messages.js";
import { ProviderOverrideSchema, ProviderOttoToolsPolicySchema } from "./provider-config.js";

describe("provider Otto-tool policy", () => {
  test("accepts arbitrary tool IDs and leaves an empty policy enabled by default", () => {
    expect(
      ProviderOttoToolsPolicySchema.parse({
        disabledTools: ["future_tool", "browser_future_tool"],
      }),
    ).toEqual({
      disabledTools: ["future_tool", "browser_future_tool"],
    });
    expect(ProviderOttoToolsPolicySchema.parse({})).toEqual({});
    expect(ProviderOverrideSchema.parse({}).ottoTools).toBeUndefined();
  });

  test("accepts ottoTools on persisted provider overrides", () => {
    expect(
      ProviderOverrideSchema.parse({
        extends: "claude",
        ottoTools: {
          enabled: false,
          disabledTools: ["create_workspace"],
        },
      }).ottoTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["create_workspace"],
    });
  });

  test("accepts ottoTools when reading and patching mutable daemon providers", () => {
    expect(
      MutableDaemonConfigSchema.parse({
        mcp: { injectIntoAgents: true },
        providers: {
          codex: {
            ottoTools: { enabled: false, disabledTools: ["future_tool"] },
          },
        },
      }).providers.codex?.ottoTools,
    ).toEqual({
      enabled: false,
      disabledTools: ["future_tool"],
    });

    expect(
      MutableDaemonConfigPatchSchema.parse({
        providers: {
          codex: {
            ottoTools: { disabledTools: ["browser_future_tool"] },
          },
        },
      }).providers?.codex?.ottoTools,
    ).toEqual({ disabledTools: ["browser_future_tool"] });
  });
});
