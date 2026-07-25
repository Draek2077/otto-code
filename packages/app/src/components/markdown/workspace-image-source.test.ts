import { describe, expect, it } from "vitest";
import {
  createWorkspaceImageBase,
  isWorkspaceRelativeImageSrc,
  resolveWorkspaceImagePath,
} from "./workspace-image-source";

const DOCS = { documentDir: "docs/guides" };

describe("resolveWorkspaceImagePath", () => {
  it("resolves a src against the document's own directory", () => {
    expect(resolveWorkspaceImagePath("./assets/flow.png", DOCS)).toBe(
      "docs/guides/assets/flow.png",
    );
    expect(resolveWorkspaceImagePath("assets/flow.png", DOCS)).toBe("docs/guides/assets/flow.png");
  });

  it("resolves a root-relative src against the workspace root, as GitHub does", () => {
    expect(resolveWorkspaceImagePath("/packages/website/public/logo.svg", DOCS)).toBe(
      "packages/website/public/logo.svg",
    );
  });

  it("climbs out of the document directory but never above the root", () => {
    expect(resolveWorkspaceImagePath("../diagram.png", DOCS)).toBe("docs/diagram.png");
    expect(resolveWorkspaceImagePath("../../logo.png", DOCS)).toBe("logo.png");
    expect(resolveWorkspaceImagePath("../../../logo.png", DOCS)).toBeNull();
  });

  it("refuses a path that escapes the workspace root", () => {
    expect(resolveWorkspaceImagePath("../../../../../../etc/passwd.png", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("/../../secrets.png", { documentDir: "" })).toBeNull();
  });

  it("refuses an escape spelled with backslashes", () => {
    expect(resolveWorkspaceImagePath("..\\..\\..\\etc\\passwd.png", DOCS)).toBeNull();
  });

  it("refuses an escape hidden behind percent-encoding", () => {
    expect(resolveWorkspaceImagePath("%2e%2e/%2e%2e/%2e%2e/etc/passwd.png", DOCS)).toBeNull();
  });

  it("leaves remote and data srcs alone — they are not ours to resolve", () => {
    expect(resolveWorkspaceImagePath("https://img.shields.io/x.svg", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("http://example.com/x.png", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("//img.shields.io/x.svg", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("data:image/png;base64,AAAA", DOCS)).toBeNull();
  });

  it("refuses a host-absolute path a document names for itself", () => {
    expect(resolveWorkspaceImagePath("file:///etc/passwd.png", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("C:/Windows/logo.png", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("//server/share/logo.png", DOCS)).toBeNull();
  });

  it("keeps an unsafe scheme unresolvable", () => {
    expect(resolveWorkspaceImagePath("javascript:alert(1)", DOCS)).toBeNull();
  });

  it("only fetches files that could be drawn", () => {
    expect(resolveWorkspaceImagePath(".env", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("../../package.json", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("notes", DOCS)).toBeNull();
    expect(resolveWorkspaceImagePath("logo.SVG", DOCS)).toBe("docs/guides/logo.SVG");
  });

  it("drops a query string and a fragment before resolving", () => {
    expect(resolveWorkspaceImagePath("logo.png?v=2", DOCS)).toBe("docs/guides/logo.png");
    expect(resolveWorkspaceImagePath("logo.png#top", DOCS)).toBe("docs/guides/logo.png");
  });

  it("decodes an escaped space in a file name", () => {
    expect(resolveWorkspaceImagePath("my%20logo.png", DOCS)).toBe("docs/guides/my logo.png");
  });
});

describe("isWorkspaceRelativeImageSrc", () => {
  it("accepts only scheme-less, non-protocol-relative srcs", () => {
    expect(isWorkspaceRelativeImageSrc("docs/x.png")).toBe(true);
    expect(isWorkspaceRelativeImageSrc("/docs/x.png")).toBe(true);
    expect(isWorkspaceRelativeImageSrc("https://example.com/x.png")).toBe(false);
    expect(isWorkspaceRelativeImageSrc("data:image/png;base64,AA")).toBe(false);
    expect(isWorkspaceRelativeImageSrc("javascript:alert(1)")).toBe(false);
    expect(isWorkspaceRelativeImageSrc("//example.com/x.png")).toBe(false);
    expect(isWorkspaceRelativeImageSrc("")).toBe(false);
  });
});

describe("createWorkspaceImageBase", () => {
  it("takes the document's directory, relative to the workspace root", () => {
    expect(
      createWorkspaceImageBase({
        serverId: "s1",
        workspaceRoot: "/home/me/project",
        documentPath: "/home/me/project/docs/guides/setup.md",
      }),
    ).toEqual({ serverId: "s1", workspaceRoot: "/home/me/project", documentDir: "docs/guides" });
  });

  it("accepts a document path that is already workspace-relative", () => {
    expect(
      createWorkspaceImageBase({
        serverId: "s1",
        workspaceRoot: "/home/me/project",
        documentPath: "README.md",
      })?.documentDir,
    ).toBe("");
  });

  it("normalizes Windows separators and folds only the drive letter", () => {
    expect(
      createWorkspaceImageBase({
        serverId: "s1",
        workspaceRoot: "c:\\Users\\me\\project",
        documentPath: "C:\\Users\\me\\project\\docs\\setup.md",
      }),
    ).toEqual({ serverId: "s1", workspaceRoot: "c:/Users/me/project", documentDir: "docs" });
  });

  it("has no base for a document outside the workspace — nothing to contain against", () => {
    expect(
      createWorkspaceImageBase({
        serverId: "s1",
        workspaceRoot: "/home/me/project",
        documentPath: "/etc/notes.md",
      }),
    ).toBeNull();
  });

  it("has no base without an absolute workspace root", () => {
    expect(
      createWorkspaceImageBase({
        serverId: "s1",
        workspaceRoot: "",
        documentPath: "README.md",
      }),
    ).toBeNull();
  });
});
