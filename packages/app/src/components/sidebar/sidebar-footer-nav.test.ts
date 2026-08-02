import { describe, expect, it } from "vitest";
import { resolveSidebarFooterActiveItem } from "@/components/sidebar/sidebar-footer-nav";

describe("resolveSidebarFooterActiveItem", () => {
  it("marks Home on the open-project route", () => {
    expect(resolveSidebarFooterActiveItem("/open-project")).toBe("home");
  });

  it("marks Metrics on the stats route", () => {
    expect(resolveSidebarFooterActiveItem("/stats")).toBe("stats");
  });

  it("marks Settings on the settings route and its sections", () => {
    expect(resolveSidebarFooterActiveItem("/settings")).toBe("settings");
    expect(resolveSidebarFooterActiveItem("/settings/projects/local/otto")).toBe("settings");
  });

  it("matches the host-scoped twins of those routes", () => {
    expect(resolveSidebarFooterActiveItem("/h/local/open-project")).toBe("home");
    expect(resolveSidebarFooterActiveItem("/h/local/settings")).toBe("settings");
  });

  it("marks nothing on routes with no footer destination", () => {
    expect(resolveSidebarFooterActiveItem("/h/local/workspace/abc")).toBeUndefined();
    expect(resolveSidebarFooterActiveItem("/new-project")).toBeUndefined();
    expect(resolveSidebarFooterActiveItem("/sessions")).toBeUndefined();
  });
});
