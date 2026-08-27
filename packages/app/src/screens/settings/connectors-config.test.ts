import { describe, expect, it, vi } from "vitest";
import type { MutableDaemonConfig } from "@otto-code/protocol/messages";
import { addVerifiedCatalogConnector } from "./connectors-config";

const SAVED_CONFIG = { connectors: [] } as unknown as MutableDaemonConfig;

describe("addVerifiedCatalogConnector", () => {
  it("keeps a connector only after live verification succeeds", async () => {
    const add = vi.fn().mockResolvedValue(SAVED_CONFIG);
    const verify = vi.fn().mockResolvedValue({ tools: 3 });
    const remove = vi.fn();

    await expect(addVerifiedCatalogConnector({ add, verify, remove })).resolves.toEqual({
      tools: 3,
    });
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the temporary connector when authorization or enumeration fails", async () => {
    const add = vi.fn().mockResolvedValue(SAVED_CONFIG);
    const verify = vi.fn().mockRejectedValue(new Error("401 Unauthorized"));
    const remove = vi.fn().mockResolvedValue(SAVED_CONFIG);

    await expect(addVerifiedCatalogConnector({ add, verify, remove })).rejects.toThrow(
      "401 Unauthorized",
    );
    expect(remove).toHaveBeenCalledWith(SAVED_CONFIG);
  });

  it("reports a rollback failure instead of falsely claiming the connector was removed", async () => {
    const add = vi.fn().mockResolvedValue(SAVED_CONFIG);
    const verify = vi.fn().mockRejectedValue(new Error("No tools"));
    const remove = vi.fn().mockResolvedValue(undefined);

    await expect(addVerifiedCatalogConnector({ add, verify, remove })).rejects.toThrow(
      "Its incomplete setup could not be removed automatically",
    );
  });
});
