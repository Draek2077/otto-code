import { describe, expect, it } from "vitest";
import { resolveOttoFormHost } from "./otto-form-target";

describe("Otto global form host initialization", () => {
  it("selects the first available host only while no host has been chosen", () => {
    const base = { selectedServerId: null, seedServerId: null };
    expect(resolveOttoFormHost({ ...base, onlineServerIds: [] })).toBeNull();
    const selectedServerId = resolveOttoFormHost({ ...base, onlineServerIds: ["a", "b"] });
    expect(selectedServerId).toBe("a");
    expect(resolveOttoFormHost({ ...base, selectedServerId, onlineServerIds: ["b"] })).toBe("a");
  });

  it("keeps the seeded host even when another host is online", () => {
    expect(
      resolveOttoFormHost({ selectedServerId: null, seedServerId: "seed", onlineServerIds: ["a"] }),
    ).toBe("seed");
  });

  it("keeps the explicit project selection ahead of the original seed", () => {
    expect(
      resolveOttoFormHost({
        selectedServerId: "chosen",
        seedServerId: "seed",
        onlineServerIds: ["a"],
      }),
    ).toBe("chosen");
  });
});
