import { describe, expect, it } from "vitest";
import { buildChatSelectionPrompt, normalizeChatSelection } from "./selection-prompt";

describe("buildChatSelectionPrompt", () => {
  it("leads with the instruction and quotes the selection", () => {
    expect(
      buildChatSelectionPrompt({ instruction: "Explain this.", selection: "Use a mutex." }),
    ).toBe("Explain this.\n\n> Use a mutex.");
  });

  it("quotes every line and keeps paragraph breaks inside the quote", () => {
    expect(
      buildChatSelectionPrompt({
        instruction: "Contest this.",
        selection: "First line\nSecond line\n\nNew paragraph",
      }),
    ).toBe("Contest this.\n\n> First line\n> Second line\n>\n> New paragraph");
  });

  it("returns null when the selection is only whitespace", () => {
    expect(
      buildChatSelectionPrompt({ instruction: "Research this.", selection: " \n\t " }),
    ).toBeNull();
  });
});

describe("normalizeChatSelection", () => {
  it("normalizes line endings, trailing and non-breaking spaces, and runs of blank lines", () => {
    expect(normalizeChatSelection("  a b  \r\n\r\n\r\n\r\nc\r")).toBe("a b\n\nc");
  });
});
