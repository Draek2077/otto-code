import { describe, expect, it } from "vitest";
import { resolveAgentTabTitle } from "@/panels/agent-tab-title";

const FALLBACK = "Chat";

describe("resolveAgentTabTitle", () => {
  it("shows the agent's title once it has one", () => {
    expect(
      resolveAgentTabTitle({ title: "Popup shadows", isHydrated: true, fallbackLabel: FALLBACK }),
    ).toEqual({ label: "Popup shadows", titleState: "ready" });
  });

  it("trims surrounding whitespace", () => {
    expect(
      resolveAgentTabTitle({
        title: "  Popup shadows  ",
        isHydrated: true,
        fallbackLabel: FALLBACK,
      }),
    ).toEqual({ label: "Popup shadows", titleState: "ready" });
  });

  it("shows a placeholder title as the name instead of a permanent skeleton", () => {
    // The regression: a chat stuck on the bare-spawn placeholder used to report
    // "loading" forever, so its tab rendered an empty pill and never a name.
    expect(
      resolveAgentTabTitle({ title: "New chat", isHydrated: true, fallbackLabel: FALLBACK }),
    ).toEqual({ label: "New chat", titleState: "ready" });
    expect(
      resolveAgentTabTitle({ title: "New agent", isHydrated: true, fallbackLabel: FALLBACK }),
    ).toEqual({ label: "New agent", titleState: "ready" });
  });

  it("falls back to the base label when a hydrated agent has no title", () => {
    expect(
      resolveAgentTabTitle({ title: null, isHydrated: true, fallbackLabel: FALLBACK }),
    ).toEqual({ label: FALLBACK, titleState: "ready" });
  });

  it("treats a blank title as no title", () => {
    expect(
      resolveAgentTabTitle({ title: "   ", isHydrated: true, fallbackLabel: FALLBACK }),
    ).toEqual({ label: FALLBACK, titleState: "ready" });
  });

  it("reports loading only while the record has not arrived", () => {
    expect(
      resolveAgentTabTitle({ title: null, isHydrated: false, fallbackLabel: FALLBACK }),
    ).toEqual({ label: FALLBACK, titleState: "loading" });
  });

  it("never returns an empty label, even mid-load", () => {
    for (const isHydrated of [true, false]) {
      for (const title of [null, undefined, "", "  "]) {
        expect(resolveAgentTabTitle({ title, isHydrated, fallbackLabel: FALLBACK }).label).not.toBe(
          "",
        );
      }
    }
  });

  it("prefers a real title over the fallback even before the record settles", () => {
    expect(
      resolveAgentTabTitle({ title: "Popup shadows", isHydrated: false, fallbackLabel: FALLBACK }),
    ).toEqual({ label: "Popup shadows", titleState: "ready" });
  });
});
