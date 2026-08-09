import { describe, expect, it } from "vitest";
import {
  isProviderCleanupManifestSafe,
  unsupportedProviderCleanupManifest,
} from "./provider-cleanup.js";

describe("provider archive cleanup", () => {
  it("defaults unsupported providers to a zero-byte no-op", () => {
    expect(unsupportedProviderCleanupManifest("acp", null)).toMatchObject({
      capability: "unsupported",
      providerBytes: 0,
      entries: [],
    });
  });

  it("rejects shared resources", () => {
    expect(
      isProviderCleanupManifestSafe({
        capability: "supported",
        provider: "direct",
        sessionId: "s1",
        providerBytes: 10,
        validationToken: "manifest",
        entries: [
          {
            resourceId: "r1",
            bytes: 10,
            owner: "provider",
            referenceCount: 2,
            validationToken: "r1",
          },
        ],
      }),
    ).toBe(false);
  });
});
