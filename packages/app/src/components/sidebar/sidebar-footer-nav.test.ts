import { describe, expect, it } from "vitest";
import { resolveSidebarFooterActiveItem } from "@/components/sidebar/sidebar-footer-nav";

describe("resolveSidebarFooterActiveItem", () => {
  it("marks Home on the open-project route", () => {
    expect(resolveSidebarFooterActiveItem("/open-project")).toBe("home");
  });

  it("marks Metrics on the stats route", () => {
    expect(resolveSidebarFooterActiveItem("/stats")).toBe("stats");
  });

  it("marks Brain on the brain route", () => {
    expect(resolveSidebarFooterActiveItem("/brain")).toBe("brain");
  });

  it("marks Settings on the settings route and its sections", () => {
    expect(resolveSidebarFooterActiveItem("/settings")).toBe("settings");
    expect(resolveSidebarFooterActiveItem("/settings/projects/local/otto")).toBe("settings");
  });

  it("matches the host-scoped twins of those routes", () => {
    expect(resolveSidebarFooterActiveItem("/h/local/open-project")).toBe("home");
    expect(resolveSidebarFooterActiveItem("/h/local/settings")).toBe("settings");
  });

  it("keeps Brain distinct from Settings, whose Brain section is a different surface", () => {
    // `/settings/hosts/<id>/brain` is the connection-and-security page, not the
    // console. Settings is checked first, so the section keeps the Settings mark.
    expect(resolveSidebarFooterActiveItem("/settings/hosts/local/brain")).toBe("settings");
  });

  it("marks nothing on routes with no footer destination", () => {
    expect(resolveSidebarFooterActiveItem("/h/local/workspace/abc")).toBeUndefined();
    expect(resolveSidebarFooterActiveItem("/new-project")).toBeUndefined();
    expect(resolveSidebarFooterActiveItem("/sessions")).toBeUndefined();
  });
});
