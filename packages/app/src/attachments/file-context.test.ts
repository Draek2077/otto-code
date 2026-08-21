import { describe, expect, it } from "vitest";
import {
  buildFileContextAttachmentId,
  createFileContextAttachment,
  formatFileContextSelection,
} from "./file-context";
import { appendWorkspaceAttachment } from "./workspace-attachments-store";

const SELECTION = { startLine: 12, startColumn: 5, endLine: 40, endColumn: 18 };

describe("buildFileContextAttachmentId", () => {
  it("uses the bare path for a whole file", () => {
    expect(buildFileContextAttachmentId({ path: "src/app.ts" })).toBe("src/app.ts");
  });

  it("appends the line for a single-line target", () => {
    expect(buildFileContextAttachmentId({ path: "src/app.ts", lineStart: 12 })).toBe(
      "src/app.ts:12",
    );
  });

  it("appends the row:column range for a selection", () => {
    expect(buildFileContextAttachmentId({ path: "src/app.ts", selection: SELECTION })).toBe(
      "src/app.ts:12:5-40:18",
    );
  });

  it("distinguishes a selection from the whole file, so both can be attached", () => {
    expect(buildFileContextAttachmentId({ path: "src/app.ts", selection: SELECTION })).not.toBe(
      buildFileContextAttachmentId({ path: "src/app.ts" }),
    );
  });
});

describe("formatFileContextSelection", () => {
  it("reads as the range the editor gutter was showing", () => {
    expect(formatFileContextSelection(SELECTION)).toBe("12:5-40:18");
  });
});

describe("createFileContextAttachment", () => {
  it("omits absent fields rather than writing undefined into the attachment", () => {
    expect(createFileContextAttachment({ path: "src/app.ts", entryKind: "file" })).toEqual({
      kind: "file_context",
      id: "src/app.ts",
      path: "src/app.ts",
      entryKind: "file",
    });
  });

  it("carries the selection through", () => {
    expect(createFileContextAttachment({ path: "src/app.ts", selection: SELECTION })).toEqual({
      kind: "file_context",
      id: "src/app.ts:12:5-40:18",
      path: "src/app.ts",
      selection: SELECTION,
    });
  });
});

// The point of routing every producer through one id: the toolbar, the file
// explorer and an `@` mention all name the same whole file, so the user gets one
// pill and one X - not three that each need removing.
describe("dedupe across entry points", () => {
  it("collapses repeat attachments of the same file", () => {
    const first = appendWorkspaceAttachment(
      [],
      createFileContextAttachment({ path: "src/app.ts" }),
    );
    const second = appendWorkspaceAttachment(
      first,
      createFileContextAttachment({ path: "src/app.ts", entryKind: "file" }),
    );
    expect(second).toHaveLength(1);
  });

  it("keeps a selection alongside the whole file", () => {
    const withFile = appendWorkspaceAttachment(
      [],
      createFileContextAttachment({ path: "src/app.ts" }),
    );
    const withBoth = appendWorkspaceAttachment(
      withFile,
      createFileContextAttachment({ path: "src/app.ts", selection: SELECTION }),
    );
    expect(withBoth).toHaveLength(2);
  });
});
