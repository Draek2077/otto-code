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
    // As written: the reader decides whether it names an id or a heading slug.
    expect(resolveWorkspaceMarkdownLink({ ...base, href: "#Caf%C3%A9%20Options" })).toEqual({
      kind: "workspace",
      path: "docs/README.md",
      anchor: "Café Options",
    });
  });

  it("keeps explicit HTML anchor fragments exactly as written", () => {
    const principles = { workspaceRoot: "C:/work/route-os", documentPath: "spec/principles.md" };
    expect(
      resolveWorkspaceMarkdownLink({ ...principles, href: "quality/verification.md#ros-ac-18" }),
    ).toEqual({ kind: "workspace", path: "spec/quality/verification.md", anchor: "ros-ac-18" });
    expect(
      resolveWorkspaceMarkdownLink({ ...principles, href: "decisions/open-decisions.md#ros-d-09" }),
    ).toEqual({ kind: "workspace", path: "spec/decisions/open-decisions.md", anchor: "ros-d-09" });
    expect(resolveWorkspaceMarkdownLink({ ...principles, href: "notes.md#Mixed_Case" })).toEqual({
      kind: "workspace",
      path: "spec/notes.md",
      anchor: "Mixed_Case",
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
