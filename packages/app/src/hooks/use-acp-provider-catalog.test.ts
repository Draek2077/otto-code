import { describe, expect, it } from "vitest";
import { ACP_PROVIDER_CATALOG } from "@/data/acp-provider-catalog";
import { buildAcpProviderConfigPatch, getAcpProviderCatalog } from "./use-acp-provider-catalog";

function findProvider(id: string) {
  const entry = getAcpProviderCatalog().find((provider) => provider.id === id);
  if (!entry) {
    throw new Error(`Missing ACP provider catalog entry: ${id}`);
  }
  return entry;
}

describe("ACP provider catalog", () => {
  it("vendors provider entries with unique ids and concrete commands", () => {
    const ids = new Set<string>();

    for (const entry of ACP_PROVIDER_CATALOG) {
      expect(ids.has(entry.id)).toBe(false);
      ids.add(entry.id);
      expect(entry.title).not.toBe("");
      expect(entry.description).not.toBe("");
      expect(entry.installLink).toMatch(/^https:\/\//);
      if (entry.extends === "acp") {
        expect(entry.command).toBeDefined();
        expect(entry.command?.length).toBeGreaterThan(0);
        expect(entry.command?.[0]).not.toBe("");
      } else {
        // Endpoint presets need env routing (base URL) instead of a command.
        expect(entry.env).toBeDefined();
      }
    }
  });

  it("lists featured entries before the rest of the catalog", () => {
    const firstNonFeaturedIndex = ACP_PROVIDER_CATALOG.findIndex((entry) => !entry.featured);
    const lastFeaturedIndex = ACP_PROVIDER_CATALOG.map((entry) => entry.featured).lastIndexOf(true);

    expect(ACP_PROVIDER_CATALOG.some((entry) => entry.featured)).toBe(true);
    expect(lastFeaturedIndex).toBeLessThan(firstNonFeaturedIndex);
    expect(ACP_PROVIDER_CATALOG.filter((entry) => entry.featured)).toContainEqual(
      expect.objectContaining({ id: "lmstudio" }),
    );
  });

  it("bundles SVG icons for catalog entries that declare an icon", () => {
    const entriesWithIcons = ACP_PROVIDER_CATALOG.filter((entry) => entry.iconSvg !== null);

    expect(entriesWithIcons.length).toBeGreaterThan(0);
    for (const entry of entriesWithIcons) {
      expect(entry.iconSvg).toContain("<svg");
    }
  });

  it("uses PATH commands for entries that were binary distributions upstream", () => {
    expect(findProvider("amp-acp").command).toEqual(["amp-acp"]);
    expect(findProvider("cursor").command).toEqual(["cursor-agent", "acp"]);
    expect(findProvider("codewhale").command).toEqual(["codewhale", "serve", "--acp"]);
    expect(findProvider("devin").command).toEqual(["devin", "acp"]);
    expect(findProvider("goose").command).toEqual(["goose", "acp"]);
    expect(findProvider("junie").command).toEqual(["junie", "--acp", "true"]);
    expect(findProvider("kiro").command).toEqual(["kiro-cli", "acp"]);
    expect(findProvider("poolside").command).toEqual(["pool", "acp"]);
    expect(findProvider("traecli").command).toEqual(["traecli", "acp", "serve"]);
  });

  it("maps a catalog entry to the daemon provider config patch", () => {
    expect(buildAcpProviderConfigPatch(findProvider("amp-acp"))).toEqual({
      providers: {
        "amp-acp": {
          extends: "acp",
          label: "Amp",
          description: "ACP wrapper for Amp - the frontier coding agent",
          command: ["amp-acp"],
          env: {},
        },
      },
    });
  });

  it("preserves provider env in the daemon config patch", () => {
    const patch = buildAcpProviderConfigPatch(findProvider("auggie"));

    expect(patch.providers?.auggie?.env).toEqual({
      AUGMENT_DISABLE_AUTO_UPDATE: "1",
    });
  });

  it("maps the LM Studio preset to a native openai-compatible provider config patch", () => {
    const patch = buildAcpProviderConfigPatch(findProvider("lmstudio"));
    const lmstudio = patch.providers?.lmstudio;

    expect(lmstudio?.extends).toBe("openai-compatible");
    expect(lmstudio?.command).toBeUndefined();
    expect(lmstudio?.models).toBeUndefined();
    expect(lmstudio?.env).toEqual({
      OPENAI_BASE_URL: "http://localhost:1234/v1",
    });
  });

  it("preserves provider params in the daemon config patch", () => {
    const droidPatch = buildAcpProviderConfigPatch(findProvider("factory-droid"));

    expect(droidPatch.providers?.["factory-droid"]?.params).toEqual({
      supportsMcpServers: false,
    });
  });
});
