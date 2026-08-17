import type { MutableDaemonConfig } from "@otto-code/protocol/messages";

/**
 * The one Atlassian account credential, shared by every Atlassian surface.
 *
 * Bitbucket Cloud (git hosting) and Jira (the Kanban board) are the same
 * account and the same HTTP Basic pair - account email + API token - so the
 * user authors it once. `jiraSiteUrl` is the only Jira-specific part and is not
 * a secret: Basic-auth Jira Cloud calls are site-addressed
 * (https://acme.atlassian.net/rest/...), unlike the OAuth-only
 * api.atlassian.com/ex/jira gateway, so the site cannot be derived from the
 * credential alone.
 */
export interface AtlassianCredentials {
  email: string;
  apiToken: string;
  /** Jira Cloud site base URL, normalized without a trailing slash. Empty when unset. */
  jiraSiteUrl: string;
}

function trimmed(value: string | undefined): string {
  return value?.trim() ?? "";
}

/**
 * Reads the host's Atlassian credential, preferring the `atlassian` slot and
 * falling back to the older Bitbucket-only one so an install that authored its
 * credential before the Atlassian re-frame keeps working untouched. The older
 * slot has no Jira site, so a config that has only ever seen `bitbucketCloud`
 * resolves usable Bitbucket credentials and an empty `jiraSiteUrl` - which is
 * exactly what Kanban treats as "Jira not configured yet".
 *
 * COMPAT(atlassianCredential): added in v0.8.11, drop the bitbucketCloud
 * fallback after 2027-02-28.
 */
export function readAtlassianCredentials(config: MutableDaemonConfig): AtlassianCredentials | null {
  const providers = config.gitHosting?.providers;
  const atlassian = providers?.atlassian;
  const legacy = providers?.bitbucketCloud;

  const email = trimmed(atlassian?.email) || trimmed(legacy?.email);
  const apiToken = trimmed(atlassian?.apiToken) || trimmed(legacy?.apiToken);
  if (!email || !apiToken) {
    return null;
  }
  return {
    email,
    apiToken,
    jiraSiteUrl: normalizeJiraSiteUrl(trimmed(atlassian?.jiraSiteUrl)),
  };
}

/**
 * Accepts what a user actually pastes - "acme", "acme.atlassian.net",
 * "https://acme.atlassian.net/jira/software/..." - and reduces it to the site
 * origin. Returns "" for anything it cannot make an origin of, which callers
 * read as "not configured" rather than guessing a host.
 */
export function normalizeJiraSiteUrl(value: string): string {
  const raw = value.trim().replace(/\/+$/, "");
  if (!raw) {
    return "";
  }
  // A bare site name is the common case in the settings field.
  if (/^[a-z0-9][a-z0-9-]*$/i.test(raw)) {
    return `https://${raw}.atlassian.net`;
  }
  try {
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      return "";
    }
    return url.origin;
  } catch {
    return "";
  }
}
