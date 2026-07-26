// Payload shaping for the "Send feedback" sheet.
//
// Feedback goes straight from the client to Otto's hosted intake
// (otto-code.me/api/feedback), not through the user's daemon: a report about
// "my host won't connect" has to be sendable while the host is unreachable.
//
// Everything built here is shown to the reporter verbatim before it is sent —
// nothing leaves the device that they haven't read. Keep the context block
// small and boring for that reason: facts that help triage, never workspace
// paths, repo names, or host labels the reporter didn't choose to disclose.

export const FEEDBACK_KINDS = ["bug", "idea", "other"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

export interface FeedbackHostFacts {
  /** Connection status as the runtime reports it ("online", "offline", …). */
  status: string;
  /** Human-readable transport ("direct TCP", "relay", …), when connected. */
  connectionKind: string | null;
  /** Daemon version from server_info, when the host has answered. */
  daemonVersion: string | null;
}

export interface FeedbackContextFacts {
  appVersion: string | null;
  platform: string;
  isDesktopApp: boolean;
  hosts: FeedbackHostFacts[];
}

export interface FeedbackRequestBody {
  kind: FeedbackKind;
  message: string;
  contact?: string;
  context?: string;
  source?: string;
  honeypot?: string;
}

function describePlatform(facts: FeedbackContextFacts): string {
  return facts.isDesktopApp ? `${facts.platform} (desktop app)` : facts.platform;
}

function describeHost(host: FeedbackHostFacts): string {
  const parts = [host.status];
  if (host.connectionKind) parts.push(host.connectionKind);
  parts.push(`daemon ${host.daemonVersion ?? "unknown"}`);
  return parts.join(", ");
}

/**
 * The context block the reporter sees and sends. Deliberately a handful of
 * lines: app build, client platform, and one line per configured host. No host
 * labels, endpoints, paths, or project names.
 */
export function formatFeedbackContext(facts: FeedbackContextFacts): string {
  const lines = [
    `App version: ${facts.appVersion ?? "unknown"}`,
    `Platform: ${describePlatform(facts)}`,
  ];

  if (facts.hosts.length === 0) {
    lines.push("Hosts: none configured");
  } else {
    facts.hosts.forEach((host, index) => {
      lines.push(`Host ${index + 1}: ${describeHost(host)}`);
    });
  }

  return lines.join("\n");
}

/** Identifies the client build in the delivered report; never user data. */
export function formatFeedbackSource(facts: FeedbackContextFacts): string {
  return `otto-app ${facts.appVersion ?? "unknown"} (${describePlatform(facts)})`;
}

export function canSubmitFeedback(input: { message: string; isSubmitting: boolean }): boolean {
  return !input.isSubmitting && input.message.trim().length > 0;
}

export function buildFeedbackPayload(input: {
  kind: FeedbackKind;
  message: string;
  contact: string;
  context: string;
  facts: FeedbackContextFacts;
  includeContext: boolean;
}): FeedbackRequestBody {
  const contact = input.contact.trim();
  const context = input.context.trim();
  const payload: FeedbackRequestBody = {
    kind: input.kind,
    message: input.message.trim(),
    source: formatFeedbackSource(input.facts),
  };
  if (contact.length > 0) {
    payload.contact = contact;
  }
  // Opt-out, and the checkbox state is what decides — not whether the block
  // happens to be non-empty.
  if (input.includeContext && context.length > 0) {
    payload.context = context;
  }
  return payload;
}
