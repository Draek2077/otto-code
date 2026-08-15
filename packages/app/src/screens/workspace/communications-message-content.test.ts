import { describe, expect, it } from "vitest";
import { adaptCommunicationsMessageContent } from "./communications-message-content";

describe("adaptCommunicationsMessageContent", () => {
  it("preserves provider text while keeping rendering provider-neutral and safe", () => {
    const text = '**Heading** [Link](https://example.com) <img src="https://example.com/x.png" />';

    expect(adaptCommunicationsMessageContent(text)).toEqual({
      text,
      enableHtmlish: false,
      remoteImages: "altText",
      workspaceImages: null,
      onToggleTask: null,
    });
  });
});
