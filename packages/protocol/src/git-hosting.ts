import { z } from "zod";

// ── Git hosting providers ────────────────────────────────────────────────
// A project's git hosting provider (GitHub, Bitbucket Cloud, ...) is chosen
// per project in otto.json; all PR/issue functionality follows that choice.
// Shared by messages.ts (wire schemas) and otto-config-schema.ts (project
// config) — lives here to avoid a module cycle between those two.
export const GitHostingProviderIdSchema = z.enum(["github", "bitbucket-cloud"]);

// Wire form of the provider id. Deliberately an OPEN string, not the enum, so a
// newer peer that adds a third provider (e.g. "gitlab") never makes an older
// peer's validator drop the whole message. Consumers normalize to the known set
// with normalizeGitHostingProviderId (mirrors normalizePersonalityRoles) and
// degrade gracefully for unknown ids. Keep the enum for otto.json config and the
// GIT_HOSTING_PROVIDER_IDS known-set.
export const GitHostingProviderIdWireSchema = z.string();

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

// Narrow an open wire provider id to the known set, or null when it's a provider
// this build doesn't recognize (a message from a newer peer). Callers render a
// neutral fallback for null rather than dropping the message.
export function normalizeGitHostingProviderId(
  value: string | null | undefined,
): GitHostingProviderId | null {
  return isGitHostingProviderId(value) ? value : null;
}
