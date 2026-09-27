import { describe, expect, test } from "vitest";
import { appShowsHostedTabs } from "./hosted-tab-support.js";

const capability = { supportedCommands: ["snapshot" as const], hostKind: "desktop app" };

describe("which apps can show hosted tabs", () => {
  test("an app that says so is believed either way", () => {
    expect(appShowsHostedTabs({ ...capability, hostedTabs: true }, "0.9.20")).toBe(true);
    expect(appShowsHostedTabs({ ...capability, hostedTabs: false }, "0.9.30")).toBe(false);
  });

  test("an app that says nothing is judged by its version", () => {
    expect(appShowsHostedTabs(capability, "0.9.24")).toBe(false);
    expect(appShowsHostedTabs(capability, "0.9.25")).toBe(true);
    expect(appShowsHostedTabs(capability, "0.9.25-beta.2")).toBe(true);
    expect(appShowsHostedTabs(capability, "0.10.0")).toBe(true);
    expect(appShowsHostedTabs(capability, "1.0.0")).toBe(true);
  });

  test("an app with no readable version is treated as unable", () => {
    expect(appShowsHostedTabs(capability, null)).toBe(false);
    expect(appShowsHostedTabs(capability, "dev")).toBe(false);
  });
});
