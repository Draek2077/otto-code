import { describe, expect, it } from "vitest";
import {
  BUILTIN_PROVIDER_ICON_NAMES,
  KNOWN_PROVIDER_ICON_NAMES,
  TERMINAL_PROFILE_ICON_NAMES,
} from "@otto-code/protocol/provider-icon-names";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { getProviderIcon } from "./provider-icons";
import { resolveProviderIconName } from "./provider-icon-name";

describe("resolveProviderIconName", () => {
  it("returns the built-in identifier for known provider ids", () => {
    expect(resolveProviderIconName("kiro")).toEqual({ kind: "builtin", id: "kiro" });
    expect(resolveProviderIconName("claude")).toEqual({ kind: "builtin", id: "claude" });
    expect(resolveProviderIconName("omp")).toEqual({ kind: "builtin", id: "omp" });
    expect(resolveProviderIconName("minimax")).toEqual({ kind: "builtin", id: "minimax" });
  });

  it("returns the catalog identifier for ACP catalog provider ids that ship an icon", () => {
    expect(resolveProviderIconName("amp-acp")).toEqual({ kind: "catalog", id: "amp-acp" });
    expect(resolveProviderIconName("gemini")).toEqual({ kind: "catalog", id: "gemini" });
    expect(resolveProviderIconName("traecli")).toEqual({ kind: "catalog", id: "traecli" });
  });

  it("falls back to the bot icon for unknown custom providers", () => {
    expect(resolveProviderIconName("custom-claude-profile")).toEqual({ kind: "bot" });
  });
});

describe("known provider icon names", () => {
  // Membership in the protocol registry is only ONE of the two routes to a
  // specific icon: app-only ids resolve through APP_PROVIDER_ICONS in
  // provider-icons.ts instead, which getProviderIcon consults first. The local
  // brain host is deliberately on that route — it is Otto's own host rather
  // than an ACP provider, and adding it to the protocol registry would also
  // make guessTerminalProfileIcon match a command named "otto-brain".
  //
  // So assert the outcome both routes exist for — a catalog entry that ships
  // an icon never falls back to the generic bot — rather than membership in
  // one particular route.
  it("gives every ACP catalog entry that ships an icon a specific icon", () => {
    const botFallback = getProviderIcon("provider-id-that-cannot-exist");
    for (const entry of ACP_PROVIDER_CATALOG) {
      if (entry.iconSvg) {
        expect(getProviderIcon(entry.id), entry.id).not.toBe(botFallback);
      }
    }
  });

  it("only lists ACP icon ids that have a catalog entry with an icon", () => {
    const builtin = new Set(BUILTIN_PROVIDER_ICON_NAMES);
    const terminalOnly = new Set(TERMINAL_PROFILE_ICON_NAMES);
    const catalogIdsWithIcons = new Set(
      ACP_PROVIDER_CATALOG.filter((entry) => entry.iconSvg).map((entry) => entry.id),
    );
    for (const name of KNOWN_PROVIDER_ICON_NAMES) {
      if (!builtin.has(name) && !terminalOnly.has(name)) {
        expect(catalogIdsWithIcons).toContain(name);
      }
    }
  });
});
