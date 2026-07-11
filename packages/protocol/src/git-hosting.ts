import { z } from "zod";

// ── Git hosting providers ────────────────────────────────────────────────
// A project's git hosting provider (GitHub, Bitbucket Cloud, ...) is chosen
// per project in otto.json; all PR/issue functionality follows that choice.
// Shared by messages.ts (wire schemas) and otto-config-schema.ts (project
// config) — lives here to avoid a module cycle between those two.
export const GitHostingProviderIdSchema = z.enum(["github", "bitbucket-cloud"]);

// What a provider can do. The client renders only capability-true actions —
// no emulation of missing features (feature contract).
export const GitHostingCapabilitiesSchema = z.object({
  autoMerge: z.boolean().optional().default(false),
  mergeQueue: z.boolean().optional().default(false),
  checkAnnotations: z.boolean().optional().default(false),
  checkDetails: z.boolean().optional().default(false),
  draftPrs: z.boolean().optional().default(false),
  reviewDecisions: z.boolean().optional().default(false),
  issues: z.boolean().optional().default(false),
});

export type GitHostingProviderId = z.infer<typeof GitHostingProviderIdSchema>;
export type GitHostingCapabilities = z.infer<typeof GitHostingCapabilitiesSchema>;

export const GIT_HOSTING_PROVIDER_IDS = GitHostingProviderIdSchema.options;

export function isGitHostingProviderId(value: unknown): value is GitHostingProviderId {
  return GitHostingProviderIdSchema.safeParse(value).success;
}
