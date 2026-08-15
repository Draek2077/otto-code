import { describe, expect, it } from "vitest";
import { clampShortcutDiscoveryCoordinate } from "./shortcut-discovery-position";

describe("clampShortcutDiscoveryCoordinate", () => {
  it("keeps a top-edge shortcut badge fully inside the floating surface", () => {
    expect(clampShortcutDiscoveryCoordinate(-8, 18, 600)).toBe(4);
  });

  it("keeps badges inside both trailing edges", () => {
    expect(clampShortcutDiscoveryCoordinate(30, 18, 100)).toBe(30);
    expect(clampShortcutDiscoveryCoordinate(96, 18, 100)).toBe(78);
  });
});
