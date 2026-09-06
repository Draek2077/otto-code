import { describe, expect, it } from "vitest";
import { resolveKnowledgeDocumentIdentityLayout } from "./document-identity";

describe("resolveKnowledgeDocumentIdentityLayout", () => {
  it("keeps only the name before the header has been measured", () => {
    expect(resolveKnowledgeDocumentIdentityLayout(0)).toEqual({
      showType: false,
      showDate: false,
    });
  });

  it("drops the date before it drops the type", () => {
    expect(resolveKnowledgeDocumentIdentityLayout(320)).toEqual({
      showType: true,
      showDate: false,
    });
  });

  it("drops the type once even that would crowd the name", () => {
    expect(resolveKnowledgeDocumentIdentityLayout(180)).toEqual({
      showType: false,
      showDate: false,
    });
  });

  it("shows the whole identity when the header has room", () => {
    expect(resolveKnowledgeDocumentIdentityLayout(720)).toEqual({
      showType: true,
      showDate: true,
    });
  });

  it("sheds in one direction as the header narrows", () => {
    const widths = [720, 500, 400, 399, 260, 259, 0];
    const shown = widths.map((width) => {
      const layout = resolveKnowledgeDocumentIdentityLayout(width);
      return Number(layout.showType) + Number(layout.showDate);
    });
    for (let index = 1; index < shown.length; index += 1) {
      expect(shown[index]).toBeLessThanOrEqual(shown[index - 1] ?? 0);
    }
  });
});
