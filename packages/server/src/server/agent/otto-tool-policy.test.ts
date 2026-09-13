import { describe, expect, test } from "vitest";
import type { ProviderOttoToolsPolicy } from "@otto-code/protocol/provider-config";
import { isOttoToolEnabled, resolveOttoToolPolicy } from "./otto-tool-policy.js";

describe("Otto provider tool policy", () => {
  test("defaults to the existing catalog and resolves only the exact provider ID", () => {
    const customPolicy = {
      enabled: true,
      disabledTools: ["list_chats"],
    } satisfies ProviderOttoToolsPolicy;
    expect(
      resolveOttoToolPolicy("custom-claude", {
        claude: { ottoTools: { enabled: false } },
        "custom-claude": { ottoTools: customPolicy },
      }),
    ).toBe(customPolicy);
    expect(
      resolveOttoToolPolicy("other-custom", { claude: { ottoTools: customPolicy } }),
    ).toBeUndefined();
    expect(isOttoToolEnabled(undefined, "list_chats")).toBe(true);
  });
  test("restricts built-in tools including voice without granting a named deny", () => {
    expect(isOttoToolEnabled({ enabled: false }, "list_chats")).toBe(false);
    expect(isOttoToolEnabled({ enabled: false }, "speak")).toBe(false);
    expect(isOttoToolEnabled({ enabled: true, disabledTools: ["speak"] }, "speak")).toBe(false);
    expect(isOttoToolEnabled({ disabledTools: ["list_chats"] }, "list_chats")).toBe(false);
    expect(isOttoToolEnabled({ disabledTools: ["list_chats"] }, "create_chat")).toBe(true);
  });
  test("keeps connector enablement separate while enforcing explicit matching denies", () => {
    expect(isOttoToolEnabled({ enabled: false }, "connector_read", "connector")).toBe(true);
    expect(
      isOttoToolEnabled(
        { enabled: false, disabledTools: ["connector_read"] },
        "connector_read",
        "connector",
      ),
    ).toBe(false);
  });
});
