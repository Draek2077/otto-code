import { describe, expect, it } from "vitest";

import { cleanDictationText } from "./use-dictation.shared";

describe("cleanDictationText", () => {
  it("removes speech fillers and adds conservative punctuation", () => {
    expect(cleanDictationText("um can you check the auth flow")).toBe(
      "Can you check the auth flow.",
    );
  });

  it("does not rewrite technical words or existing punctuation", () => {
    expect(cleanDictationText("uh use OAuth2 with gpt-4o-mini?")).toBe(
      "Use OAuth2 with gpt-4o-mini?",
    );
  });
});
