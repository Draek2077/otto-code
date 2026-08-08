import path from "node:path";

export interface DemoRemote {
  owner: string;
  name: string;
  url: string;
  /** Branch with the seeded open PR used by enriched captures. */
  demoBranch?: string;
}

/**
 * Resolve a demo template to the real GitHub repository used for captures.
 *
 * DEMO_GITHUB_REPOS can override the checked-in default mapping with a JSON
 * object keyed by template name. Set DEMO_GITHUB_OFFLINE=1 to use the old
 * synthetic-origin lane instead.
 */
export function resolveDemoRemote(templateName: string, fallbackOwner: string): DemoRemote {
  const raw = process.env.DEMO_GITHUB_REPOS?.trim();
  if (raw || process.env.DEMO_GITHUB_OFFLINE !== "1") {
    const configuredRaw =
      raw ??
      JSON.stringify({
        "mango-storefront": "Draek2077/mango-storefront",
        "pulse-api": "Draek2077/pulse-api",
      });
    let configured: unknown;
    try {
      configured = JSON.parse(configuredRaw);
    } catch (error) {
      throw new Error(`DEMO_GITHUB_REPOS must be valid JSON: ${String(error)}`, { cause: error });
    }
    const value =
      configured && typeof configured === "object"
        ? (configured as Record<string, unknown>)[templateName]
        : undefined;
    if (typeof value !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(value)) {
      throw new Error(`DEMO_GITHUB_REPOS is missing a valid owner/repo entry for ${templateName}`);
    }
    const [owner, name] = value.split("/");
    return {
      owner,
      name,
      url: `https://github.com/${owner}/${name}.git`,
      demoBranch: "demo/checkout-flow",
    };
  }

  const originUrl = `https://git.demoforge.dev/${fallbackOwner}/${path.basename(templateName)}.git`;
  return { owner: fallbackOwner, name: path.basename(templateName), url: originUrl };
}
