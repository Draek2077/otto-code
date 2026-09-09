import { describe, expect, it } from "vitest";
import { resolveWorkspaceMarkdownLink } from "./workspace-link-target";

const base = {
  workspaceRoot: "C:/work/route-os",
  documentPath: "docs/README.md",
};

describe("resolveWorkspaceMarkdownLink", () => {
  it("resolves a sibling document from the source document directory", () => {
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "guide.md" })).toEqual({
      kind: "workspace",
      path: "docs/guide.md",
    });
  });

  it("resolves cross-document anchors and percent-encoded fragments", () => {
    expect(
      resolveWorkspaceMarkdownLink({
        ...base,
        href: "../spec/principles.md#fp-02-durable-messaging-and-controlled-scale",
      }),
    ).toEqual({
      kind: "workspace",
      path: "spec/principles.md",
      anchor: "fp-02-durable-messaging-and-controlled-scale",
    });
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "#Caf%C3%A9%20Options" })).toEqual({
      kind: "workspace",
      path: "docs/README.md",
      anchor: "café-options",
    });
  });

  it("keeps root-relative links inside the workspace", () => {
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "/README.md" })).toEqual({
      kind: "workspace",
      path: "README.md",
    });
  });

  it("refuses workspace escapes and malformed local targets", () => {
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "../../outside.md" })).toEqual({
      kind: "invalid",
      reason: "The Markdown link escapes this workspace.",
    });
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "docs%ZZ/bad.md" })).toEqual({
      kind: "invalid",
      reason: "The Markdown file target is invalid.",
    });
  });

  it("leaves outbound URLs with the existing external-link behavior", () => {
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "https://otto-code.me/docs" })).toEqual({
      kind: "external",
    });
  });
});
