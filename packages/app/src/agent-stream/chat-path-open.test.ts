import { describe, expect, it } from "vitest";
import { resolveChatPathOpen } from "./chat-path-open";

const API_WORKSPACE = "C:/Users/phili/Projects/ttc-api";

describe("resolveChatPathOpen", () => {
  it("keeps relative links relative to the displayed workspace", () => {
    const path = "docs/readme.md";
    expect(resolveChatPathOpen({ raw: path, path }, "main", API_WORKSPACE)).toEqual({
      location: { path },
      disposition: "main",
    });
  });

  it("keeps an absolute link rooted when the agent works outside the displayed workspace", () => {
    const path = String.raw`C:\Users\phili\Projects\ttc-tasters\docs\redesign-2026\merch-migration-plan.md`;
    expect(resolveChatPathOpen({ raw: path, path }, "side", API_WORKSPACE)).toEqual({
      location: {
        path: "C:/Users/phili/Projects/ttc-tasters/docs/redesign-2026/merch-migration-plan.md",
      },
      disposition: "side",
    });
  });

  it("keeps an absolute link within the pane workspace relative for tab identity", () => {
    const path = String.raw`C:\Users\phili\Projects\ttc-api\docs\readme.md`;
    expect(resolveChatPathOpen({ raw: path, path, lineStart: 12 }, "main", API_WORKSPACE)).toEqual({
      location: { path: "docs/readme.md", lineStart: 12 },
      disposition: "main",
    });
  });
});
