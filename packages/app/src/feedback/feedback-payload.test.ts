import { describe, expect, it } from "vitest";

import {
  buildFeedbackPayload,
  canSubmitFeedback,
  formatFeedbackContext,
  formatFeedbackSource,
  type FeedbackContextFacts,
} from "@/feedback/feedback-payload";

const FACTS: FeedbackContextFacts = {
  appVersion: "0.6.7",
  platform: "web",
  isDesktopApp: true,
  hosts: [{ status: "online", connectionKind: "relay", daemonVersion: "0.6.7" }],
};

describe("formatFeedbackContext", () => {
  it("reports the app build, platform, and one line per host", () => {
    expect(formatFeedbackContext(FACTS)).toBe(
      [
        "App version: 0.6.7",
        "Platform: web (desktop app)",
        "Host 1: online, relay, daemon 0.6.7",
      ].join("\n"),
    );
  });

  it("says so when no host is configured", () => {
    const context = formatFeedbackContext({ ...FACTS, hosts: [] });
    expect(context).toContain("Hosts: none configured");
  });

  it("keeps unknown daemon versions and missing transports readable", () => {
    const context = formatFeedbackContext({
      ...FACTS,
      hosts: [{ status: "offline", connectionKind: null, daemonVersion: null }],
    });
    expect(context).toContain("Host 1: offline, daemon unknown");
  });

  it("never leaks host labels, endpoints, or paths", () => {
    // The facts shape carries no such field - this pins that intent so adding
    // one has to be a deliberate change to the contract, not a drive-by.
    const context = formatFeedbackContext(FACTS);
    expect(context).not.toMatch(/https?:|\/|\\/);
  });
});

describe("formatFeedbackSource", () => {
  it("identifies the client build", () => {
    expect(formatFeedbackSource(FACTS)).toBe("otto-app 0.6.7 (web (desktop app))");
  });
});

describe("canSubmitFeedback", () => {
  it("requires a non-blank message", () => {
    expect(canSubmitFeedback({ message: "   ", isSubmitting: false })).toBe(false);
    expect(canSubmitFeedback({ message: "it broke", isSubmitting: false })).toBe(true);
  });

  it("blocks a second send while one is in flight", () => {
    expect(canSubmitFeedback({ message: "it broke", isSubmitting: true })).toBe(false);
  });
});

describe("buildFeedbackPayload", () => {
  const base = {
    kind: "bug" as const,
    message: "  the composer eats keystrokes  ",
    contact: "  me@example.com  ",
    context: "App version: 0.6.7",
    facts: FACTS,
    includeContext: true,
  };

  it("trims the message and carries the kind, contact, and context", () => {
    expect(buildFeedbackPayload(base)).toEqual({
      kind: "bug",
      message: "the composer eats keystrokes",
      contact: "me@example.com",
      context: "App version: 0.6.7",
      source: "otto-app 0.6.7 (web (desktop app))",
    });
  });

  it("omits a blank contact so the report stays anonymous", () => {
    const payload = buildFeedbackPayload({ ...base, contact: "   " });
    expect(payload.contact).toBeUndefined();
  });

  it("omits the context entirely when the reporter switched it off", () => {
    const payload = buildFeedbackPayload({ ...base, includeContext: false });
    expect(payload.context).toBeUndefined();
    expect(payload.message).toBe("the composer eats keystrokes");
  });
});
