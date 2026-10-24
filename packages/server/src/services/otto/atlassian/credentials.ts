/** Shared by Jira and Bitbucket; credentials never belong to a project or plugin settings. */
import { z } from "zod";

export interface AtlassianCredential {
  revision: string;
  email: string;
  apiToken: string;
  siteUrl: string;
  route: { kind: "site" } | { kind: "scoped"; cloudId: string };
}
const PairSchema = z.object({
  email: z.string().trim().min(1),
  apiToken: z.string().trim().min(1),
  jiraSiteUrl: z.string().optional(),
});
const LegacySchema = z
  .object({
    gitHosting: z
      .object({
        providers: z
          .object({ atlassian: z.unknown().optional(), bitbucketCloud: z.unknown().optional() })
          .passthrough(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
export function normalizeAtlassianSite(value: string): string | null {
  let site = value.trim();
  if (!site) return null;
  if (/^[a-z0-9][a-z0-9-]*$/i.test(site)) site += ".atlassian.net";
  try {
    const url = new URL(site.includes("://") ? site : "https://" + site);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      !/^[a-z0-9][a-z0-9-]*\.atlassian\.net$/i.test(url.hostname)
    )
      return null;
    return url.origin;
  } catch {
    return null;
  }
}
export function atlassianApiBase(credential: AtlassianCredential): string | null {
  const site = normalizeAtlassianSite(credential.siteUrl);
  if (!site) return null;
  if (credential.route.kind === "site") return site;
  if (!/^[a-zA-Z0-9-]{1,128}$/.test(credential.route.cloudId)) return null;
  // Scoped API tokens also use Basic auth. The gateway is not OAuth-only.
  // Official token contract: https://support.atlassian.com/atlassian-account/docs/manage-api-tokens-for-your-atlassian-account/
  return "https://api.atlassian.com/ex/jira/" + credential.route.cloudId;
}
/** Read preserved 0.9 settings without rewriting, combining identities or migrating secrets. */
// COMPAT(otto09Atlassian): added in v0.10.0; remove after 2027-04-24 once preserved-account import is explicit.
export function readLegacyAtlassian(value: unknown, revision: string): AtlassianCredential | null {
  const parsed = LegacySchema.safeParse(value);
  if (!parsed.success) return null;
  const providers = parsed.data.gitHosting?.providers;
  if (!providers) return null;
  const source = providers.atlassian === undefined ? providers.bitbucketCloud : providers.atlassian;
  const account = PairSchema.safeParse(source);
  if (!account.success) return null;
  return {
    revision,
    email: account.data.email,
    apiToken: account.data.apiToken,
    siteUrl: normalizeAtlassianSite(account.data.jiraSiteUrl ?? "") ?? "",
    route: { kind: "site" },
  };
}
